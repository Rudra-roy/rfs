package hub

import (
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"
)

// Proxy forwards /api/m/{name}/v1/... to that machine's agent, streaming.
func Proxy(reg *Registry, agentPort string) http.Handler {
	rp := &httputil.ReverseProxy{
		FlushInterval: -1, // NDJSON listings and video must stream
		Transport: &http.Transport{
			DialContext:         (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
			MaxIdleConnsPerHost: 16,
			IdleConnTimeout:     90 * time.Second,
		},
		Rewrite: func(pr *httputil.ProxyRequest) {
			m, _ := reg.Lookup(pr.In.PathValue("name"))
			pr.SetURL(&url.URL{Scheme: "http", Host: m.Addr(agentPort)})
			pr.Out.URL.Path = "/" + pr.In.PathValue("rest")
			pr.Out.URL.RawPath = ""
			pr.Out.Host = pr.Out.URL.Host
		},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m, ok := reg.Lookup(r.PathValue("name"))
		if !ok || !m.Agent {
			http.Error(w, "machine offline or no agent", http.StatusBadGateway)
			return
		}
		rp.ServeHTTP(w, r)
	})
}
