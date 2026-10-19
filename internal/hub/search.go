package hub

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// Search fans a filename query out to every drive of every agent and streams the
// merged hits as NDJSON, each tagged with the machine. Ends with a {"done"} line
// per drive so the UI can show what was and was not fully covered.
func Search(reg *Registry, agentPort string) http.Handler {
	client := &http.Client{Timeout: 15 * time.Second}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("q")
		if len(q) < 2 {
			http.Error(w, "q must be at least 2 characters", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/x-ndjson")
		fl, _ := w.(http.Flusher)
		var mu sync.Mutex
		emit := func(line []byte) {
			mu.Lock()
			w.Write(line)
			w.Write([]byte{'\n'})
			if fl != nil {
				fl.Flush()
			}
			mu.Unlock()
		}
		ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
		defer cancel()
		var wg sync.WaitGroup
		for _, m := range reg.List() {
			if !m.Agent {
				continue
			}
			for _, d := range m.Mounts {
				wg.Add(1)
				go func(m Machine, root string) {
					defer wg.Done()
					u := "http://" + m.Addr(agentPort) + "/v1/search?" + url.Values{"q": {q}, "path": {root}, "limit": {"100"}, "budget": {"4000"}}.Encode()
					req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
					resp, err := client.Do(req)
					tail := map[string]any{"machine": m.Name, "root": root, "done": false}
					if err != nil {
						tail["error"] = err.Error()
						b, _ := json.Marshal(tail)
						emit(b)
						return
					}
					defer resp.Body.Close()
					sc := bufio.NewScanner(resp.Body)
					sc.Buffer(make([]byte, 64<<10), 1<<20)
					for sc.Scan() {
						var obj map[string]any
						if json.Unmarshal(sc.Bytes(), &obj) != nil {
							continue
						}
						if _, isTail := obj["done"]; isTail {
							tail["done"] = obj["done"]
							continue
						}
						obj["machine"] = m.Name
						b, _ := json.Marshal(obj)
						emit(b)
					}
					b, _ := json.Marshal(tail)
					emit(b)
				}(m, d.Path)
			}
		}
		wg.Wait()
	})
}
