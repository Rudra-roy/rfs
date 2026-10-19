package agent

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Lock is the per-machine access password. The hash lives in a file the agent
// owns; the hub never sees it. A correct password yields a short-lived token the
// hub attaches to every proxied request; everything but the drive list and the
// unlock call requires it.
type Lock struct {
	iter  int
	salt  []byte
	hash  []byte
	ttl   time.Duration
	mu    sync.Mutex
	toks  map[string]time.Time // token -> expiry
	fails map[string]int       // remote ip -> consecutive failures
}

const (
	pbkdfIter  = 600_000
	tokenTTL   = 12 * time.Hour
	HeaderTok  = "X-Rfs-Token"
	HeaderLock = "X-Rfs-Locked"
)

// DefaultPassFile is where -set-password writes and the agent reads.
func DefaultPassFile() string {
	if p := os.Getenv("RFS_PASSFILE"); p != "" {
		return p
	}
	d, err := os.UserConfigDir()
	if err != nil {
		d = "/etc"
	}
	return filepath.Join(d, "rfs", "agent.pass")
}

func derive(pw string, salt []byte, iter int) []byte {
	k, _ := pbkdf2.Key(sha256.New, pw, salt, iter, 32)
	return k
}

// SetPassword writes the hash file (mode 600). An empty password removes it.
func SetPassword(path, pw string) error {
	if pw == "" {
		err := os.Remove(path)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if len(pw) < 8 {
		return errors.New("password must be at least 8 characters")
	}
	salt := make([]byte, 16)
	rand.Read(salt)
	line := fmt.Sprintf("pbkdf2-sha256$%d$%s$%s\n", pbkdfIter, base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(derive(pw, salt, pbkdfIter)))
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(line), 0o600)
}

// LoadLock reads the hash file; (nil, nil) when there is none, meaning no password.
func LoadLock(path string) (*Lock, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	parts := strings.Split(strings.TrimSpace(string(b)), "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return nil, fmt.Errorf("%s: unrecognised format", path)
	}
	iter, err := strconv.Atoi(parts[1])
	salt, err2 := base64.RawStdEncoding.DecodeString(parts[2])
	hash, err3 := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil || err2 != nil || err3 != nil || iter < 1000 || len(hash) != 32 {
		return nil, fmt.Errorf("%s: corrupt", path)
	}
	return &Lock{iter: iter, salt: salt, hash: hash, ttl: tokenTTL, toks: map[string]time.Time{}, fails: map[string]int{}}, nil
}

func (l *Lock) verify(pw string) bool {
	return subtle.ConstantTimeCompare(derive(pw, l.salt, l.iter), l.hash) == 1
}

func (l *Lock) issue() string {
	b := make([]byte, 32)
	rand.Read(b)
	t := base64.RawURLEncoding.EncodeToString(b)
	l.mu.Lock()
	l.toks[t] = time.Now().Add(l.ttl)
	for k, exp := range l.toks { // opportunistic sweep
		if time.Now().After(exp) {
			delete(l.toks, k)
		}
	}
	l.mu.Unlock()
	return t
}

func (l *Lock) valid(t string) bool {
	if t == "" {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	exp, ok := l.toks[t]
	return ok && time.Now().Before(exp)
}

func (l *Lock) revoke(t string) { l.mu.Lock(); delete(l.toks, t); l.mu.Unlock() }

// Middleware admits the drive list and the unlock call freely; everything else
// needs a valid token. Failed unlocks back off per caller.
func (l *Lock) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "GET" && r.URL.Path == "/v1/mounts":
			w.Header().Set(HeaderLock, "1")
			next.ServeHTTP(w, r)
		case r.Method == "POST" && r.URL.Path == "/v1/unlock":
			l.handleUnlock(w, r)
		case r.Method == "POST" && r.URL.Path == "/v1/lock":
			l.revoke(r.Header.Get(HeaderTok))
			w.WriteHeader(http.StatusNoContent)
		case l.valid(r.Header.Get(HeaderTok)):
			next.ServeHTTP(w, r)
		default:
			http.Error(w, "locked", http.StatusUnauthorized)
		}
	})
}

func (l *Lock) handleUnlock(w http.ResponseWriter, r *http.Request) {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	var body struct{ Password string }
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	l.mu.Lock()
	n := l.fails[ip]
	l.mu.Unlock()
	if n > 0 {
		time.Sleep(time.Duration(min(n, 10)) * time.Second) // ponytail: linear backoff per caller; the only caller is the hub over the tailnet
	}
	if !l.verify(body.Password) {
		l.mu.Lock()
		l.fails[ip]++
		l.mu.Unlock()
		http.Error(w, "wrong password", http.StatusForbidden)
		return
	}
	l.mu.Lock()
	delete(l.fails, ip)
	l.mu.Unlock()
	writeJSON(w, map[string]any{"token": l.issue(), "ttl": int64(l.ttl.Seconds())})
}
