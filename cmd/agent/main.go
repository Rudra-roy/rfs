package main

import (
	"flag"
	"log"
	"net"
	"net/http"

	"rfs/internal/agent"
	"rfs/internal/tsl"
)

func main() {
	port := flag.String("port", "7421", "port on the tailnet IP")
	readOnly := flag.Bool("readonly", false, "refuse all writes")
	only := flag.String("mounts", "", "expose only these directories instead of every drive: /path:Label,/other:Other")
	flag.Parse()

	ts := tsl.New()
	st, err := ts.Status()
	if err != nil || len(st.Self.TailscaleIPs) == 0 {
		log.Fatalf("tailscale not running or no IP: %v", err)
	}
	self := st.Self
	allow := func(ip string) bool {
		w, err := ts.WhoIs(ip)
		return err == nil && w.UserProfile.ID == self.UserID
	}
	mounts := agent.Mounts
	if *only != "" {
		fixed, err := agent.ParseMounts(*only)
		if err != nil {
			log.Fatal(err)
		}
		mounts = func() ([]agent.Mount, error) { return agent.WithUsage(fixed), nil }
	}
	s := &agent.Server{ReadOnly: *readOnly, Mounts: mounts}
	addr := net.JoinHostPort(self.TailscaleIPs[0], *port)
	log.Printf("rfs-agent %s on %s (owner user %d, readonly=%v)", self.HostName, addr, self.UserID, *readOnly)
	log.Fatal(http.ListenAndServe(addr, agent.Auth(allow, s.Handler())))
}
