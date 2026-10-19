// Package agent serves one machine's filesystems to the hub over the tailnet.
package agent

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// TrashDir is the trash folder at the root of each drive. The drive holding the
// user's home is the exception: its trash lives inside the home so a user-level
// agent never needs write access to "/" or "C:\".
const TrashDir = ".rfs-trash"

var homeDir, _ = os.UserHomeDir()

// trashRel returns the trash directory relative to the mount root.
func trashRel(m Mount) string {
	if homeDir != "" && (homeDir == m.Path || strings.HasPrefix(homeDir, strings.TrimSuffix(m.Path, string(filepath.Separator))+string(filepath.Separator))) {
		if rel, err := filepath.Rel(m.Path, homeDir); err == nil {
			return filepath.Join(rel, ".local", "share", "rfs", "trash")
		}
	}
	return TrashDir
}

// deniedPrefixes are never served even though they live under "/".
var deniedPrefixes = []string{"/proc", "/sys", "/dev", "/run"}

type Server struct {
	ReadOnly bool
	Mounts   func() ([]Mount, error) // injectable for tests

	mu      sync.Mutex
	cached  []Mount
	cacheAt time.Time
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/mounts", s.handleMounts)
	mux.HandleFunc("GET /v1/ls", s.handleLs)
	mux.HandleFunc("GET /v1/file", s.handleGet)
	mux.HandleFunc("HEAD /v1/file", s.handleGet)
	mux.HandleFunc("PUT /v1/file", s.handlePut)
	mux.HandleFunc("GET /v1/thumb", s.handleThumb)
	mux.HandleFunc("POST /v1/mkdir", s.handleMkdir)
	mux.HandleFunc("POST /v1/mv", s.handleMv)
	mux.HandleFunc("POST /v1/rm", s.handleRm)
	return mux
}

// Auth admits only callers that allow() approves, keyed by remote IP.
func Auth(allow func(ip string) bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip, _, _ := net.SplitHostPort(r.RemoteAddr)
		if !allow(ip) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) mounts() ([]Mount, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if time.Since(s.cacheAt) < 10*time.Second {
		return s.cached, nil
	}
	m, err := s.Mounts()
	if err != nil {
		return nil, err
	}
	sort.Slice(m, func(i, j int) bool { return len(m[i].Path) > len(m[j].Path) }) // longest prefix first
	s.cached, s.cacheAt = m, time.Now()
	return m, nil
}

// resolve maps an absolute OS path to (mount, root handle, path relative to root).
// Caller closes root. Rejects relative or unclean paths and denied prefixes;
// os.Root rejects symlink escapes at open time.
func (s *Server) resolve(p string) (Mount, *os.Root, string, error) {
	if p == "" || !filepath.IsAbs(p) || filepath.Clean(p) != p {
		return Mount{}, nil, "", errBad("path must be absolute and clean")
	}
	for _, d := range deniedPrefixes {
		if p == d || strings.HasPrefix(p, d+"/") {
			return Mount{}, nil, "", errForbidden("path not served")
		}
	}
	ms, err := s.mounts()
	if err != nil {
		return Mount{}, nil, "", err
	}
	for _, m := range ms {
		if p == m.Path || strings.HasPrefix(p, strings.TrimSuffix(m.Path, string(filepath.Separator))+string(filepath.Separator)) {
			root, err := os.OpenRoot(m.Path)
			if err != nil {
				return Mount{}, nil, "", err
			}
			rel, _ := filepath.Rel(m.Path, p)
			return m, root, rel, nil
		}
	}
	return Mount{}, nil, "", errNotFound("no such mount")
}

func (s *Server) handleMounts(w http.ResponseWriter, r *http.Request) {
	ms, err := s.mounts()
	if err != nil {
		fail(w, err)
		return
	}
	sorted := append([]Mount(nil), ms...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Path < sorted[j].Path })
	writeJSON(w, sorted)
}

// entry is one NDJSON line of a listing. Short keys: these are the hot path.
type entry struct {
	N string `json:"n"`
	D bool   `json:"d,omitempty"`
	S int64  `json:"s"`
	M int64  `json:"m"` // unix millis
}

func (s *Server) handleLs(w http.ResponseWriter, r *http.Request) {
	_, root, rel, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		fail(w, err)
		return
	}
	defer root.Close()
	f, err := root.Open(rel)
	if err != nil {
		fail(w, err)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/x-ndjson")
	enc := json.NewEncoder(w)
	fl, _ := w.(http.Flusher)
	for {
		ents, err := f.ReadDir(512)
		for _, e := range ents {
			info, ierr := e.Info()
			if ierr != nil {
				continue
			}
			enc.Encode(entry{N: e.Name(), D: e.IsDir(), S: info.Size(), M: info.ModTime().UnixMilli()})
		}
		if fl != nil {
			fl.Flush()
		}
		if err != nil { // io.EOF or a real error; either way we are done
			if !errors.Is(err, io.EOF) {
				log.Printf("ls %s: %v", rel, err)
			}
			return
		}
	}
}

func (s *Server) handleGet(w http.ResponseWriter, r *http.Request) {
	_, root, rel, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		fail(w, err)
		return
	}
	defer root.Close()
	f, err := root.Open(rel)
	if err != nil {
		fail(w, err)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		fail(w, errBad("not a file"))
		return
	}
	if r.URL.Query().Get("dl") != "" {
		w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+urlEscape(st.Name()))
	}
	http.ServeContent(w, r, st.Name(), st.ModTime(), f)
}

// handlePut appends a chunk at exactly the current end of file (offset must
// match), creating the file when offset is 0. Clients resume via HEAD.
func (s *Server) handlePut(w http.ResponseWriter, r *http.Request) {
	if s.ReadOnly {
		fail(w, errForbidden("read-only agent"))
		return
	}
	_, root, rel, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		fail(w, err)
		return
	}
	defer root.Close()
	off, _ := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
	flags := os.O_WRONLY | os.O_CREATE
	if off == 0 {
		flags |= os.O_TRUNC
	}
	f, err := root.OpenFile(rel, flags, 0o644)
	if err != nil {
		fail(w, err)
		return
	}
	defer f.Close()
	st, _ := f.Stat()
	if st.Size() != off {
		http.Error(w, fmt.Sprintf("offset %d != size %d", off, st.Size()), http.StatusConflict)
		return
	}
	if _, err := f.Seek(off, io.SeekStart); err != nil {
		fail(w, err)
		return
	}
	n, err := io.Copy(f, r.Body)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, map[string]int64{"size": off + n})
}

func (s *Server) handleMkdir(w http.ResponseWriter, r *http.Request) {
	if s.ReadOnly {
		fail(w, errForbidden("read-only agent"))
		return
	}
	_, root, rel, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		fail(w, err)
		return
	}
	defer root.Close()
	if err := root.Mkdir(rel, 0o755); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMv(w http.ResponseWriter, r *http.Request) {
	if s.ReadOnly {
		fail(w, errForbidden("read-only agent"))
		return
	}
	q := r.URL.Query()
	m1, root, from, err := s.resolve(q.Get("from"))
	if err != nil {
		fail(w, err)
		return
	}
	defer root.Close()
	m2, root2, to, err := s.resolve(q.Get("to"))
	if err != nil {
		fail(w, err)
		return
	}
	root2.Close()
	if m1.Path != m2.Path {
		fail(w, errBad("cannot move across drives"))
		return
	}
	if err := root.Rename(from, to); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleRm moves the target into the drive's trash as <ts>-<name>. Removing
// something already in the trash deletes it for real.
func (s *Server) handleRm(w http.ResponseWriter, r *http.Request) {
	if s.ReadOnly {
		fail(w, errForbidden("read-only agent"))
		return
	}
	m, root, rel, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		fail(w, err)
		return
	}
	defer root.Close()
	if rel == "." {
		fail(w, errBad("cannot remove a drive"))
		return
	}
	trash := trashRel(m)
	if strings.HasPrefix(rel, trash+string(filepath.Separator)) {
		if err := root.RemoveAll(rel); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := root.MkdirAll(trash, 0o755); err != nil {
		fail(w, err)
		return
	}
	dest := filepath.Join(trash, fmt.Sprintf("%d-%s", time.Now().Unix(), filepath.Base(rel)))
	if err := root.Rename(rel, dest); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, map[string]string{"trash": dest})
}

// --- errors -----------------------------------------------------------------

type httpErr struct {
	code int
	msg  string
}

func (e httpErr) Error() string   { return e.msg }
func errBad(m string) error       { return httpErr{http.StatusBadRequest, m} }
func errForbidden(m string) error { return httpErr{http.StatusForbidden, m} }
func errNotFound(m string) error  { return httpErr{http.StatusNotFound, m} }
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, err error) {
	var he httpErr
	switch {
	case errors.As(err, &he):
		http.Error(w, he.msg, he.code)
	case errors.Is(err, fs.ErrNotExist):
		http.Error(w, "not found", http.StatusNotFound)
	case errors.Is(err, fs.ErrPermission), strings.Contains(err.Error(), "escapes from parent"):
		http.Error(w, "forbidden", http.StatusForbidden)
	case errors.Is(err, fs.ErrExist):
		http.Error(w, "already exists", http.StatusConflict)
	default:
		log.Printf("agent: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
	}
}

func urlEscape(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '.' || c == '-' || c == '_' {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}
