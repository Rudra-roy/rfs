package hub

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Unlocks remembers, per user and machine, the token an agent issued for a
// correct access password. Tokens live only in hub memory; a hub restart means
// unlocking again.
type Unlocks struct {
	mu sync.Mutex
	m  map[string]unlockEntry // email\x00machine
}

type unlockEntry struct {
	token string
	exp   time.Time
}

func NewUnlocks() *Unlocks { return &Unlocks{m: map[string]unlockEntry{}} }

func key(email, machine string) string { return email + "\x00" + machine }

// Token returns the live token for (email, machine) or "".
func (u *Unlocks) Token(email, machine string) string {
	u.mu.Lock()
	defer u.mu.Unlock()
	e, ok := u.m[key(email, machine)]
	if !ok || time.Now().After(e.exp) {
		delete(u.m, key(email, machine))
		return ""
	}
	return e.token
}

func (u *Unlocks) set(email, machine, token string, ttl time.Duration) {
	u.mu.Lock()
	u.m[key(email, machine)] = unlockEntry{token, time.Now().Add(ttl)}
	u.mu.Unlock()
}

func (u *Unlocks) drop(email, machine string) {
	u.mu.Lock()
	delete(u.m, key(email, machine))
	u.mu.Unlock()
}

// Handler serves POST /api/m/{name}/unlock (body {"password"}) and POST /api/m/{name}/lock.
func (u *Unlocks) Handler(reg *Registry, agentPort string) http.Handler {
	client := &http.Client{Timeout: 20 * time.Second} // agents back off on bad passwords
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		m, ok := reg.Lookup(name)
		if !ok || !m.Agent {
			http.Error(w, "machine offline or no agent", http.StatusBadGateway)
			return
		}
		email := Email(r)
		if strings.HasSuffix(r.URL.Path, "/lock") {
			if tok := u.Token(email, name); tok != "" {
				req, _ := http.NewRequestWithContext(r.Context(), "POST", "http://"+m.Addr(agentPort)+"/v1/lock", nil)
				req.Header.Set("X-Rfs-Token", tok)
				if resp, err := client.Do(req); err == nil {
					resp.Body.Close()
				}
			}
			u.drop(email, name)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4096))
		if err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		req, _ := http.NewRequestWithContext(r.Context(), "POST", "http://"+m.Addr(agentPort)+"/v1/unlock", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			http.Error(w, "agent unreachable", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			msg, _ := io.ReadAll(resp.Body)
			http.Error(w, strings.TrimSpace(string(msg)), resp.StatusCode)
			return
		}
		var out struct {
			Token string
			TTL   int64
		}
		if json.NewDecoder(resp.Body).Decode(&out) != nil || out.Token == "" {
			http.Error(w, "bad agent reply", http.StatusBadGateway)
			return
		}
		u.set(email, name, out.Token, time.Duration(out.TTL)*time.Second)
		w.WriteHeader(http.StatusNoContent)
	})
}
