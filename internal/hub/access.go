// Package hub: Cloudflare Access JWT verification.
//
// Cloudflare Access puts a signed JWT in the Cf-Access-Jwt-Assertion header on
// every request that passed its login. We re-verify it so the hub is useless to
// anyone who reaches it without going through Access.
package hub

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

type ctxKey struct{}

// Email returns the verified user email stored by Verifier.Require.
func Email(r *http.Request) string {
	e, _ := r.Context().Value(ctxKey{}).(string)
	return e
}

// AsEmail stores a fixed email in ctx. Dev use only.
func AsEmail(email string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, email)))
	})
}

// Verifier checks Access tokens against the team's JWKS.
type Verifier struct {
	issuer, aud string // issuer: https://<team>.cloudflareaccess.com
	client      *http.Client

	mu      sync.Mutex
	keys    map[string]*rsa.PublicKey
	fetched time.Time
}

func NewVerifier(issuer, aud string) *Verifier {
	return &Verifier{issuer: strings.TrimRight(issuer, "/"), aud: aud, client: &http.Client{Timeout: 10 * time.Second}}
}

// Require rejects requests without a valid token and stores the email in ctx.
func (v *Verifier) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		email, err := v.Verify(r.Header.Get("Cf-Access-Jwt-Assertion"))
		if err != nil {
			http.Error(w, "forbidden: "+err.Error(), http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, email)))
	})
}

type claims struct {
	Iss   string          `json:"iss"`
	Aud   json.RawMessage `json:"aud"` // string or []string
	Exp   int64           `json:"exp"`
	Email string          `json:"email"`
}

// Verify returns the email claim of a valid RS256 token.
func (v *Verifier) Verify(tok string) (string, error) {
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		return "", errors.New("malformed token")
	}
	var hdr struct{ Alg, Kid string }
	if err := decodeSeg(parts[0], &hdr); err != nil || hdr.Alg != "RS256" {
		return "", errors.New("bad header")
	}
	var c claims
	if err := decodeSeg(parts[1], &c); err != nil {
		return "", errors.New("bad claims")
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return "", errors.New("bad signature encoding")
	}
	key, err := v.key(hdr.Kid)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, sum[:], sig); err != nil {
		return "", errors.New("signature mismatch")
	}
	if c.Iss != v.issuer {
		return "", errors.New("wrong issuer")
	}
	if !hasAud(c.Aud, v.aud) {
		return "", errors.New("wrong audience")
	}
	if time.Now().Unix() >= c.Exp {
		return "", errors.New("expired")
	}
	if c.Email == "" {
		return "", errors.New("no email")
	}
	return c.Email, nil
}

func hasAud(raw json.RawMessage, want string) bool {
	var one string
	if json.Unmarshal(raw, &one) == nil {
		return one == want
	}
	var many []string
	if json.Unmarshal(raw, &many) == nil {
		for _, a := range many {
			if a == want {
				return true
			}
		}
	}
	return false
}

func decodeSeg(s string, v any) error {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// key returns the public key for kid, refreshing the JWKS if unknown or stale.
func (v *Verifier) key(kid string) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if k, ok := v.keys[kid]; ok && time.Since(v.fetched) < 24*time.Hour {
		return k, nil
	}
	if time.Since(v.fetched) < time.Minute { // ponytail: crude refetch throttle; fine for one user
		return nil, errors.New("unknown key id")
	}
	resp, err := v.client.Get(v.issuer + "/cdn-cgi/access/certs")
	if err != nil {
		return nil, fmt.Errorf("jwks: %w", err)
	}
	defer resp.Body.Close()
	var jwks struct {
		Keys []struct{ Kid, Kty, N, E string }
	}
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, fmt.Errorf("jwks: %w", err)
	}
	v.keys = map[string]*rsa.PublicKey{}
	v.fetched = time.Now()
	for _, k := range jwks.Keys {
		if k.Kty != "RSA" {
			continue
		}
		n, err1 := base64.RawURLEncoding.DecodeString(k.N)
		e, err2 := base64.RawURLEncoding.DecodeString(k.E)
		if err1 != nil || err2 != nil {
			continue
		}
		v.keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
	}
	if k, ok := v.keys[kid]; ok {
		return k, nil
	}
	return nil, errors.New("unknown key id")
}
