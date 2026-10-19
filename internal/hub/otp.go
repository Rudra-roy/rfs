package hub

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// OTP is a TOTP second factor owned by the hub, independent of the identity
// provider in front. Once enrolled, every browser must present a code once;
// a signed cookie then remembers that device for otpRemember.
type OTP struct {
	path   string // secret file
	cookie string // signing key file
	mu     sync.Mutex
	secret []byte // nil = not enrolled
	key    []byte
	last   int64 // last accepted time step, against replay
	pend   []byte
	pendAt time.Time
}

const (
	otpStep     = 30
	otpDigits   = 6
	otpRemember = 30 * 24 * time.Hour
	otpCookie   = "rfs_otp"
)

func LoadOTP(stateDir string) *OTP {
	o := &OTP{path: filepath.Join(stateDir, "otp.secret"), cookie: filepath.Join(stateDir, "cookie.key")}
	if b, err := os.ReadFile(o.path); err == nil {
		if s, err := base32.StdEncoding.DecodeString(strings.TrimSpace(string(b))); err == nil && len(s) >= 10 {
			o.secret = s
		}
	}
	if b, err := os.ReadFile(o.cookie); err == nil && len(b) >= 32 {
		o.key = b
	} else {
		o.key = make([]byte, 32)
		rand.Read(o.key)
		os.MkdirAll(stateDir, 0o700)
		os.WriteFile(o.cookie, o.key, 0o600)
	}
	return o
}

func (o *OTP) Enrolled() bool { o.mu.Lock(); defer o.mu.Unlock(); return o.secret != nil }

func code(secret []byte, step int64) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], uint64(step))
	mac := hmac.New(sha1.New, secret)
	mac.Write(msg[:])
	h := mac.Sum(nil)
	off := h[len(h)-1] & 0x0f
	v := binary.BigEndian.Uint32(h[off:off+4]) & 0x7fffffff
	return fmt.Sprintf("%0*d", otpDigits, v%1_000_000)
}

// check accepts the current step and one on either side, each step once.
func (o *OTP) check(secret []byte, c string, now time.Time) (int64, bool) {
	c = strings.ReplaceAll(strings.TrimSpace(c), " ", "")
	step := now.Unix() / otpStep
	for d := int64(-1); d <= 1; d++ {
		if subtle.ConstantTimeCompare([]byte(code(secret, step+d)), []byte(c)) == 1 {
			return step + d, true
		}
	}
	return 0, false
}

func (o *OTP) sign(email string, exp int64) string {
	payload := email + "|" + strconv.FormatInt(exp, 10)
	mac := hmac.New(sha256.New, o.key)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (o *OTP) verifyCookie(v, email string) bool {
	parts := strings.Split(v, ".")
	if len(parts) != 2 {
		return false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	sig, err2 := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || err2 != nil {
		return false
	}
	mac := hmac.New(sha256.New, o.key)
	mac.Write(payload)
	if !hmac.Equal(mac.Sum(nil), sig) {
		return false
	}
	fields := strings.Split(string(payload), "|")
	if len(fields) != 2 || fields[0] != email {
		return false
	}
	exp, _ := strconv.ParseInt(fields[1], 10, 64)
	return time.Now().Unix() < exp
}

func (o *OTP) setCookie(w http.ResponseWriter, r *http.Request, email string) {
	exp := time.Now().Add(otpRemember)
	http.SetCookie(w, &http.Cookie{Name: otpCookie, Value: o.sign(email, exp.Unix()), Path: "/", Expires: exp,
		HttpOnly: true, Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" || r.Header.Get("Cf-Visitor") != "", SameSite: http.SameSiteLaxMode})
}

// Verified reports whether this request's device has passed the second factor
// (or no second factor is enrolled).
func (o *OTP) Verified(r *http.Request) bool {
	if !o.Enrolled() {
		return true
	}
	c, err := r.Cookie(otpCookie)
	return err == nil && o.verifyCookie(c.Value, Email(r))
}

// Require gates everything under /api/ except the OTP endpoints themselves.
func (o *OTP) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") && !strings.HasPrefix(r.URL.Path, "/api/otp/") && !o.Verified(r) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"otp":true}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Routes: GET status, POST enroll (new secret, pending until confirmed),
// POST confirm {code} (persists and verifies this device), POST verify {code},
// POST disable {code}.
func (o *OTP) Routes(mux *http.ServeMux, issuer string) {
	mux.HandleFunc("GET /api/otp/status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]bool{"enrolled": o.Enrolled(), "verified": o.Verified(r)})
	})
	mux.HandleFunc("POST /api/otp/enroll", func(w http.ResponseWriter, r *http.Request) {
		if o.Enrolled() {
			http.Error(w, "already enrolled; disable first", http.StatusConflict)
			return
		}
		s := make([]byte, 20)
		rand.Read(s)
		o.mu.Lock()
		o.pend, o.pendAt = s, time.Now()
		o.mu.Unlock()
		sec := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(s)
		uri := "otpauth://totp/" + url.PathEscape(issuer+":"+Email(r)) + "?" + url.Values{"secret": {sec}, "issuer": {issuer}, "algorithm": {"SHA1"}, "digits": {"6"}, "period": {"30"}}.Encode()
		writeJSON(w, map[string]string{"secret": sec, "uri": uri})
	})
	mux.HandleFunc("POST /api/otp/confirm", func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Code string }
		json.NewDecoder(http.MaxBytesReader(w, r.Body, 512)).Decode(&body)
		o.mu.Lock()
		pend, at := o.pend, o.pendAt
		o.mu.Unlock()
		if pend == nil || time.Since(at) > 10*time.Minute {
			http.Error(w, "start enrollment again", http.StatusBadRequest)
			return
		}
		step, ok := o.check(pend, body.Code, time.Now())
		if !ok {
			http.Error(w, "wrong code", http.StatusForbidden)
			return
		}
		os.MkdirAll(filepath.Dir(o.path), 0o700)
		if err := os.WriteFile(o.path, []byte(base32.StdEncoding.EncodeToString(pend)+"\n"), 0o600); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		o.mu.Lock()
		o.secret, o.pend, o.last = pend, nil, step
		o.mu.Unlock()
		o.setCookie(w, r, Email(r))
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /api/otp/verify", func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Code string }
		json.NewDecoder(http.MaxBytesReader(w, r.Body, 512)).Decode(&body)
		if err := o.consume(body.Code); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		o.setCookie(w, r, Email(r))
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /api/otp/disable", func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Code string }
		json.NewDecoder(http.MaxBytesReader(w, r.Body, 512)).Decode(&body)
		if err := o.consume(body.Code); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		os.Remove(o.path)
		o.mu.Lock()
		o.secret = nil
		o.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	})
}

// consume validates a code against the enrolled secret and burns its time step.
func (o *OTP) consume(c string) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.secret == nil {
		return errors.New("not enrolled")
	}
	time.Sleep(300 * time.Millisecond) // flat cost per attempt
	step, ok := o.check(o.secret, c, time.Now())
	if !ok {
		return errors.New("wrong code")
	}
	if step <= o.last {
		return errors.New("code already used")
	}
	o.last = step
	return nil
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
