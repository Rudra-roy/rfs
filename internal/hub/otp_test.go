package hub

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTOTPVector(t *testing.T) {
	// RFC 6238 appendix B, SHA1, secret "12345678901234567890", T=59 -> 94287082 (8 digits); 6-digit tail is 287082
	if got := code([]byte("12345678901234567890"), 1); got != "287082" {
		t.Fatalf("rfc vector: %s", got)
	}
}

func TestOTPFlow(t *testing.T) {
	dir := t.TempDir()
	o := LoadOTP(dir)
	mux := http.NewServeMux()
	o.Routes(mux, "rfs-test")
	mux.HandleFunc("GET /api/machines", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "[]") })
	h := AsEmail("me@example.com", o.Require(mux))
	call := func(method, path, body string, cookies []*http.Cookie) (*http.Response, string) {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		for _, c := range cookies {
			req.AddCookie(c)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		b, _ := io.ReadAll(rec.Result().Body)
		return rec.Result(), string(b)
	}
	// not enrolled: api open
	if r, _ := call("GET", "/api/machines", "", nil); r.StatusCode != 200 {
		t.Fatalf("open before enrol: %d", r.StatusCode)
	}
	_, body := call("POST", "/api/otp/enroll", "", nil)
	var en struct{ Secret, URI string }
	json.Unmarshal([]byte(body), &en)
	if en.Secret == "" || !strings.HasPrefix(en.URI, "otpauth://totp/") {
		t.Fatalf("enroll: %s", body)
	}
	if r, _ := call("POST", "/api/otp/confirm", `{"code":"000000"}`, nil); r.StatusCode != 403 {
		t.Fatalf("wrong confirm code: %d", r.StatusCode)
	}
	o.mu.Lock()
	pend := o.pend
	o.mu.Unlock()
	now := time.Now()
	r, _ := call("POST", "/api/otp/confirm", `{"code":"`+code(pend, now.Unix()/otpStep)+`"}`, nil)
	if r.StatusCode != 204 || len(r.Cookies()) != 1 {
		t.Fatalf("confirm: %d cookies=%d", r.StatusCode, len(r.Cookies()))
	}
	cookie := r.Cookies()
	// enrolled: api locked without the cookie, open with it
	if r, b := call("GET", "/api/machines", "", nil); r.StatusCode != 401 || !strings.Contains(b, `"otp":true`) {
		t.Fatalf("gate: %d %s", r.StatusCode, b)
	}
	if r, _ := call("GET", "/api/machines", "", cookie); r.StatusCode != 200 {
		t.Fatalf("with cookie: %d", r.StatusCode)
	}
	// a second device verifies with a fresh code; the same step cannot be replayed
	o.mu.Lock()
	o.last = 0
	o.mu.Unlock()
	c := code(o.secret, time.Now().Unix()/otpStep)
	if r, _ := call("POST", "/api/otp/verify", `{"code":"`+c+`"}`, nil); r.StatusCode != 204 {
		t.Fatalf("verify: %d", r.StatusCode)
	}
	if r, _ := call("POST", "/api/otp/verify", `{"code":"`+c+`"}`, nil); r.StatusCode != 403 {
		t.Fatalf("replay accepted: %d", r.StatusCode)
	}
	// cookie bound to the email
	other := AsEmail("else@example.com", o.Require(mux))
	req := httptest.NewRequest("GET", "/api/machines", nil)
	req.AddCookie(cookie[0])
	rec := httptest.NewRecorder()
	other.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatalf("cookie accepted for another user: %d", rec.Code)
	}
	// survives a restart
	if !LoadOTP(dir).Enrolled() {
		t.Fatal("secret not persisted")
	}
}

func TestUnlockFlow(t *testing.T) {
	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/unlock":
			b, _ := io.ReadAll(r.Body)
			if strings.Contains(string(b), "letmein") {
				fmt.Fprint(w, `{"token":"T1","ttl":60}`)
			} else {
				http.Error(w, "wrong password", 403)
			}
		case r.Header.Get("X-Rfs-Token") == "T1":
			fmt.Fprint(w, "secret listing")
		default:
			http.Error(w, "locked", 401)
		}
	}))
	defer agent.Close()
	host := strings.TrimPrefix(agent.URL, "http://")
	ip, port := host[:strings.LastIndex(host, ":")], host[strings.LastIndex(host, ":")+1:]
	reg := NewDemoRegistry([]Machine{{Name: "alpha", IP: ip, Port: port, Agent: true}}, port)
	u := NewUnlocks()
	mux := http.NewServeMux()
	mux.Handle("POST /api/m/{name}/unlock", u.Handler(reg, port))
	mux.Handle("POST /api/m/{name}/lock", u.Handler(reg, port))
	mux.Handle("/api/m/{name}/{rest...}", Proxy(reg, port, u))
	h := AsEmail("me@example.com", mux)
	do := func(method, path, body string) (int, string) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
		b, _ := io.ReadAll(rec.Result().Body)
		return rec.Code, string(b)
	}
	if c, _ := do("GET", "/api/m/alpha/v1/ls?path=/", ""); c != 401 {
		t.Fatalf("locked passthrough: %d", c)
	}
	if c, _ := do("POST", "/api/m/alpha/unlock", `{"password":"nope"}`); c != 403 {
		t.Fatalf("wrong password: %d", c)
	}
	if c, _ := do("POST", "/api/m/alpha/unlock", `{"password":"letmein"}`); c != 204 {
		t.Fatalf("unlock: %d", c)
	}
	if c, b := do("GET", "/api/m/alpha/v1/ls?path=/", ""); c != 200 || !strings.Contains(b, "secret listing") {
		t.Fatalf("after unlock: %d %s", c, b)
	}
	if c, _ := do("POST", "/api/m/alpha/lock", ""); c != 204 {
		t.Fatalf("lock: %d", c)
	}
	if c, _ := do("GET", "/api/m/alpha/v1/ls?path=/", ""); c != 401 {
		t.Fatalf("after lock: %d", c)
	}
}
