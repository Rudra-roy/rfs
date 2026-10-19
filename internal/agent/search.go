package agent

import (
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// directories that are never worth walking for a filename search
var skipDirs = map[string]bool{"node_modules": true, ".git": true, ".cache": true, "__pycache__": true, ".venv": true, "venv": true,
	"site-packages": true, ".npm": true, ".cargo": true, ".rustup": true, ".gradle": true, ".m2": true, "proc": true, "sys": true, "dev": true, "run": true}

// handleSearch walks a directory breadth-first for names containing q
// (case-insensitive) and streams hits as NDJSON. Breadth-first means shallow
// matches come out first and a time budget still covers every top-level area.
// Stops at ?limit (default 200) or ?budget ms (default 3000); ends with
// {"done":true|false,"visited":n}.
// ponytail: a live walk, not an index; add an fsnotify-backed index when a
// drive is too big to walk in the budget.
func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	needle := strings.ToLower(strings.TrimSpace(q.Get("q")))
	if len(needle) < 2 {
		fail(w, errBad("q must be at least 2 characters"))
		return
	}
	m, root, rel, err := s.resolve(q.Get("path"))
	if err != nil {
		fail(w, err)
		return
	}
	defer root.Close()
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 2000 {
		limit = 200
	}
	budget, _ := strconv.Atoi(q.Get("budget"))
	if budget <= 0 || budget > 20000 {
		budget = 3000
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(budget)*time.Millisecond)
	defer cancel()

	w.Header().Set("Content-Type", "application/x-ndjson")
	enc := json.NewEncoder(w)
	fl, _ := w.(http.Flusher)
	type hit struct {
		P string `json:"p"` // absolute path of the containing folder
		N string `json:"n"`
		D bool   `json:"d,omitempty"`
		S int64  `json:"s"`
		M int64  `json:"m"`
	}
	trash := filepath.ToSlash(trashRel(m))
	fsys := root.FS()
	queue := []string{filepath.ToSlash(rel)}
	found, visited := 0, 0
	done := true
walk:
	for len(queue) > 0 {
		dir := queue[0]
		queue = queue[1:]
		ents, err := fs.ReadDir(fsys, dir)
		if err != nil {
			continue
		}
		for _, d := range ents {
			if ctx.Err() != nil {
				done = false
				break walk
			}
			visited++
			if visited%4096 == 0 && fl != nil {
				fl.Flush() // keep the connection alive during long walks
			}
			name := d.Name()
			p := name
			if dir != "." {
				p = path.Join(dir, name)
			}
			if d.IsDir() && !skipDirs[name] && p != trash {
				queue = append(queue, p)
			}
			if !strings.Contains(strings.ToLower(name), needle) {
				continue
			}
			info, ierr := d.Info()
			if ierr != nil {
				continue
			}
			enc.Encode(hit{P: filepath.Join(m.Path, filepath.FromSlash(dir)), N: name, D: d.IsDir(), S: info.Size(), M: info.ModTime().UnixMilli()})
			found++
			if found >= limit {
				done = false
				break walk
			}
		}
	}
	enc.Encode(map[string]any{"done": done, "visited": visited})
}
