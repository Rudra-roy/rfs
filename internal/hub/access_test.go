package hub

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestVerify(t *testing.T) {
	priv, _ := rsa.GenerateKey(rand.Reader, 2048)
	jwks := map[string]any{"keys": []map[string]string{{
		"kid": "k1", "kty": "RSA",
		"n": base64.RawURLEncoding.EncodeToString(priv.N.Bytes()),
		"e": base64.RawURLEncoding.EncodeToString([]byte{1, 0, 1}),
	}}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/cdn-cgi/access/certs" {
			http.NotFound(w, r)
			return
		}
		json.NewEncoder(w).Encode(jwks)
	}))
	defer srv.Close()

	sign := func(kid string, c map[string]any) string {
		seg := func(v any) string { b, _ := json.Marshal(v); return base64.RawURLEncoding.EncodeToString(b) }
		h := seg(map[string]string{"alg": "RS256", "kid": kid})
		p := seg(c)
		sum := sha256.Sum256([]byte(h + "." + p))
		sig, _ := rsa.SignPKCS1v15(rand.Reader, priv, crypto.SHA256, sum[:])
		return h + "." + p + "." + base64.RawURLEncoding.EncodeToString(sig)
	}
	good := map[string]any{"iss": srv.URL, "aud": []string{"aud1"}, "exp": time.Now().Add(time.Hour).Unix(), "email": "me@example.com"}
	with := func(k string, val any) map[string]any {
		m := map[string]any{}
		for kk, vv := range good {
			m[kk] = vv
		}
		m[k] = val
		return m
	}
	v := NewVerifier(srv.URL, "aud1")

	if e, err := v.Verify(sign("k1", good)); err != nil || e != "me@example.com" {
		t.Fatalf("good token: %v %q", err, e)
	}
	if _, err := v.Verify(sign("k1", with("aud", "other"))); err == nil {
		t.Fatal("wrong aud accepted")
	}
	if _, err := v.Verify(sign("k1", with("exp", time.Now().Add(-time.Second).Unix()))); err == nil {
		t.Fatal("expired accepted")
	}
	if _, err := v.Verify(sign("k1", with("iss", "https://evil"))); err == nil {
		t.Fatal("wrong issuer accepted")
	}
	tok := sign("k1", good)
	if _, err := v.Verify(tok[:len(tok)-2] + "AA"); err == nil {
		t.Fatal("tampered signature accepted")
	}
	if _, err := v.Verify(""); err == nil {
		t.Fatal("empty accepted")
	}
	// Access middleware wires email into ctx.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Cf-Access-Jwt-Assertion", tok)
	v.Require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, Email(r)) })).ServeHTTP(rec, req)
	if rec.Body.String() != "me@example.com" {
		t.Fatalf("middleware: %q", rec.Body.String())
	}
}
