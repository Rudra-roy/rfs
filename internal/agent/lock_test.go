package agent

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLock(t *testing.T) {
	dir := t.TempDir()
	pf := filepath.Join(dir, "agent.pass")
	if err := SetPassword(pf, "short"); err == nil {
		t.Fatal("short password accepted")
	}
	if err := SetPassword(pf, "correct horse battery"); err != nil {
		t.Fatal(err)
	}
	if st, _ := os.Stat(pf); st.Mode().Perm() != 0o600 {
		t.Fatalf("pass file mode %v", st.Mode().Perm())
	}
	l, err := LoadLock(pf)
	if err != nil || l == nil {
		t.Fatalf("load: %v", err)
	}
	l.ttl = time.Second
	s := &Server{Mounts: func() ([]Mount, error) { return []Mount{{Path: dir, Label: "t"}}, nil }, Lock: l}
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()

	r, _ := do(t, "GET", srv.URL+"/v1/mounts", "")
	if r.StatusCode != 200 || r.Header.Get(HeaderLock) != "1" {
		t.Fatalf("mounts should be open and flagged locked: %d %q", r.StatusCode, r.Header.Get(HeaderLock))
	}
	if r, _ := do(t, "GET", srv.URL+"/v1/ls?path="+dir, ""); r.StatusCode != 401 {
		t.Fatalf("ls without token: %d", r.StatusCode)
	}
	if r, _ := do(t, "POST", srv.URL+"/v1/unlock", `{"password":"nope"}`); r.StatusCode != 403 {
		t.Fatalf("wrong password: %d", r.StatusCode)
	}
	r, body := do(t, "POST", srv.URL+"/v1/unlock", `{"password":"correct horse battery"}`)
	if r.StatusCode != 200 || !strings.Contains(body, `"token"`) {
		t.Fatalf("unlock: %d %s", r.StatusCode, body)
	}
	tok := strings.Split(strings.Split(body, `"token":"`)[1], `"`)[0]
	if r, _ := do(t, "GET", srv.URL+"/v1/ls?path="+dir, "", HeaderTok, tok); r.StatusCode != 200 {
		t.Fatalf("ls with token: %d", r.StatusCode)
	}
	if r, _ := do(t, "POST", srv.URL+"/v1/lock", "", HeaderTok, tok); r.StatusCode != 204 {
		t.Fatalf("lock: %d", r.StatusCode)
	}
	if r, _ := do(t, "GET", srv.URL+"/v1/ls?path="+dir, "", HeaderTok, tok); r.StatusCode != 401 {
		t.Fatalf("revoked token accepted: %d", r.StatusCode)
	}
	_, body = do(t, "POST", srv.URL+"/v1/unlock", `{"password":"correct horse battery"}`)
	tok = strings.Split(strings.Split(body, `"token":"`)[1], `"`)[0]
	time.Sleep(1100 * time.Millisecond)
	if r, _ := do(t, "GET", srv.URL+"/v1/ls?path="+dir, "", HeaderTok, tok); r.StatusCode != 401 {
		t.Fatalf("expired token accepted: %d", r.StatusCode)
	}
	if err := SetPassword(pf, ""); err != nil {
		t.Fatal(err)
	}
	if l, _ := LoadLock(pf); l != nil {
		t.Fatal("password not removed")
	}
	_ = http.StatusOK
}
