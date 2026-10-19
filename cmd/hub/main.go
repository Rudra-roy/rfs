package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"rfs/internal/hub"
	"rfs/internal/tsl"
	"rfs/web"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:7420", "listen address")
	agentPort := flag.String("agent-port", "7421", "port agents listen on")
	devEmail := flag.String("dev-email", "", "DEV ONLY: skip Cloudflare Access and act as this email (loopback bind required)")
	demoFleet := flag.String("demo-fleet", "", "DEMO: serve this JSON fleet instead of discovering the tailnet")
	flag.Parse()
	var auth func(http.Handler) http.Handler
	if *devEmail != "" {
		if !strings.HasPrefix(*addr, "127.0.0.1:") && !strings.HasPrefix(*addr, "localhost:") {
			log.Fatal("-dev-email only allowed on a loopback address")
		}
		log.Printf("WARNING: auth disabled, every request is %s", *devEmail)
		auth = func(next http.Handler) http.Handler { return hub.AsEmail(*devEmail, next) }
	} else {
		team, aud := os.Getenv("RFS_ACCESS_TEAM"), os.Getenv("RFS_ACCESS_AUD")
		if team == "" || aud == "" {
			log.Fatal("set RFS_ACCESS_TEAM (Zero Trust team name) and RFS_ACCESS_AUD (Access application audience tag)")
		}
		auth = hub.NewVerifier("https://"+team+".cloudflareaccess.com", aud).Require
	}
	var reg *hub.Registry
	if *demoFleet != "" {
		var fleet []hub.Machine
		b, err := os.ReadFile(*demoFleet)
		if err == nil {
			err = json.Unmarshal(b, &fleet)
		}
		if err != nil {
			log.Fatalf("demo fleet: %v", err)
		}
		reg = hub.NewDemoRegistry(fleet, *agentPort)
	} else {
		reg = hub.NewRegistry(tsl.New(), *agentPort)
	}
	go reg.Run(context.Background(), 15*time.Second)

	api := http.NewServeMux()
	api.HandleFunc("GET /api/me", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"email": hub.Email(r)})
	})
	api.HandleFunc("GET /api/machines", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(reg.List())
	})
	api.Handle("/api/m/{name}/{rest...}", hub.Proxy(reg, *agentPort))
	api.Handle("/", spa())

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { fmt.Fprintln(w, "ok") })
	mux.Handle("/", auth(logged(api)))
	log.Printf("rfs-hub listening on %s", *addr)
	log.Fatal(http.ListenAndServe(*addr, mux))
}

// spa serves built assets and falls back to index.html for client routes.
func spa() http.Handler {
	dist, _ := fs.Sub(web.Dist, "dist")
	files := http.FileServerFS(dist)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p != "" {
			if f, err := dist.Open(p); err == nil {
				f.Close()
				if strings.HasPrefix(p, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFileFS(w, r, dist, "index.html")
	})
}

func logged(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			log.Printf("%s %s %s", hub.Email(r), r.Method, r.URL.RequestURI())
		}
		next.ServeHTTP(w, r)
	})
}
