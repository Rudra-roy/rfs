package hub

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"
)

// Aliases are display names for machines, kept on the hub so every browser
// sees the same name. Keyed by the tailnet hostname, which URLs keep using.
type Aliases struct {
	mu   sync.Mutex
	path string
	m    map[string]string
}

func LoadAliases(stateDir string) *Aliases {
	a := &Aliases{path: filepath.Join(stateDir, "aliases.json"), m: map[string]string{}}
	if b, err := os.ReadFile(a.path); err == nil {
		json.Unmarshal(b, &a.m)
	}
	return a
}

func (a *Aliases) Get(name string) string { a.mu.Lock(); defer a.mu.Unlock(); return a.m[name] }

func (a *Aliases) Set(name, alias string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if alias == "" {
		delete(a.m, name)
	} else {
		a.m[name] = alias
	}
	os.MkdirAll(filepath.Dir(a.path), 0o700)
	b, _ := json.MarshalIndent(a.m, "", " ")
	if err := os.WriteFile(a.path+".tmp", b, 0o600); err != nil {
		return err
	}
	return os.Rename(a.path+".tmp", a.path)
}

// Apply fills Machine.Alias on a list.
func (a *Aliases) Apply(ms []Machine) []Machine {
	for i := range ms {
		ms[i].Alias = a.Get(ms[i].Name)
	}
	return ms
}

// Handler serves PUT /api/machines/{name}/alias with {"alias": "..."}; empty clears.
func (a *Aliases) Handler(reg *Registry) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if _, ok := reg.Lookup(name); !ok {
			http.Error(w, "unknown machine", http.StatusNotFound)
			return
		}
		var body struct{ Alias string }
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		alias := strings.TrimSpace(body.Alias)
		if utf8.RuneCountInString(alias) > 40 || strings.ContainsFunc(alias, func(c rune) bool { return !unicode.IsGraphic(c) || unicode.Is(unicode.Cf, c) }) {
			http.Error(w, "alias must be 1-40 printable characters", http.StatusBadRequest)
			return
		}
		if other, ok := reg.Lookup(strings.ToLower(alias)); ok && other.Name != name {
			http.Error(w, "that is another machine's hostname", http.StatusBadRequest)
			return
		}
		if err := a.Set(name, alias); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
