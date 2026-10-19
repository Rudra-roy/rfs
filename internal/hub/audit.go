package hub

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Audit writes one JSON line per API request: who, what, where, how big, how long.
type Audit struct {
	mu sync.Mutex
	f  *os.File
}

// OpenAudit appends to path; an empty path logs to stderr instead.
func OpenAudit(path string) (*Audit, error) {
	if path == "" {
		return &Audit{}, nil
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	return &Audit{f: f}, nil
}

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (w *statusWriter) WriteHeader(c int) { w.status = c; w.ResponseWriter.WriteHeader(c) }
func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytes += int64(n)
	return n, err
}
func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

type entry struct {
	T       string `json:"t"`
	User    string `json:"user"`
	Method  string `json:"m"`
	Path    string `json:"path"`
	Machine string `json:"machine,omitempty"`
	File    string `json:"file,omitempty"`
	Status  int    `json:"status"`
	Bytes   int64  `json:"bytes"`
	Ms      int64  `json:"ms"`
	IP      string `json:"ip,omitempty"`
}

// Wrap records every request under /api/.
func (a *Audit) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		sw := &statusWriter{ResponseWriter: w}
		start := time.Now()
		next.ServeHTTP(sw, r)
		e := entry{T: start.UTC().Format(time.RFC3339), User: Email(r), Method: r.Method, Path: r.URL.Path,
			Machine: r.PathValue("name"), File: r.URL.Query().Get("path"), Status: sw.status, Bytes: sw.bytes,
			Ms: time.Since(start).Milliseconds(), IP: r.Header.Get("Cf-Connecting-Ip")}
		if e.Status == 0 {
			e.Status = 200
		}
		a.write(e)
	})
}

func (a *Audit) write(e entry) {
	b, _ := json.Marshal(e)
	if a.f == nil {
		log.Printf("%s", b)
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.f.Write(append(b, '\n'))
}
