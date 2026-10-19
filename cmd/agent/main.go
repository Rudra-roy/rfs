package main

import (
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"golang.org/x/term"

	"rfs/internal/agent"
	"rfs/internal/tsl"
)

func main() {
	port := flag.String("port", "7421", "port on the tailnet IP")
	readOnly := flag.Bool("readonly", false, "refuse all writes")
	only := flag.String("mounts", "", "expose only these directories instead of every drive: /path:Label,/other:Other")
	indexMax := flag.Int("index-max", 5_000_000, "filename index entry cap per drive; 0 disables indexing")
	passFile := flag.String("passfile", agent.DefaultPassFile(), "access password hash file; absent = no password")
	setPass := flag.Bool("set-password", false, "prompt for a new access password, write it to -passfile, and exit (empty removes it)")
	allowFrom := flag.String("allow-from", "", "tailnet IPs allowed to call this agent, comma-separated (the hub's). Required where the Tailscale daemon is not reachable, as on Android")
	listen := flag.String("listen", "", "listen address; default is this device's tailnet IP and -port")
	flag.Parse()
	if *setPass {
		if err := setPassword(*passFile); err != nil {
			log.Fatal(err)
		}
		return
	}
	lock, err := agent.LoadLock(*passFile)
	if err != nil {
		log.Fatal(err)
	}

	var acl agent.AllowList
	if *allowFrom != "" {
		if acl, err = agent.ParseAllowList(*allowFrom); err != nil {
			log.Fatal(err)
		}
	}
	ts := tsl.New()
	st, tsErr := ts.Status()
	var allow func(ip string) bool
	var bindIP, who string
	switch {
	case tsErr == nil && len(st.Self.TailscaleIPs) > 0:
		// the Tailscale daemon tells us who each caller is
		self := st.Self
		bindIP, who = self.TailscaleIPs[0], fmt.Sprintf("%s, owner user %d", self.HostName, self.UserID)
		allow = func(ip string) bool {
			if acl != nil && acl.Has(ip) {
				return true
			}
			w, err := ts.WhoIs(ip)
			return err == nil && w.UserProfile.ID == self.UserID
		}
	case acl != nil:
		// no daemon (Android): trust only the listed tailnet addresses
		ip, err := agent.TailnetIP()
		if err != nil && *listen == "" {
			log.Fatalf("%v (or pass -listen)", err)
		}
		bindIP, who, allow = ip, fmt.Sprintf("allow-from %s", *allowFrom), acl.Has
	default:
		log.Fatalf("cannot reach the Tailscale daemon (%v). On Android, pass -allow-from <hub tailnet IP>", tsErr)
	}
	if agent.IsAndroid() {
		agent.IndexFloor = 2 * time.Hour // a phone's battery matters more than index freshness
	}
	mounts := agent.Mounts
	if *only != "" {
		fixed, err := agent.ParseMounts(*only)
		if err != nil {
			log.Fatal(err)
		}
		mounts = func() ([]agent.Mount, error) { return agent.WithUsage(fixed), nil }
	}
	s := &agent.Server{ReadOnly: *readOnly, Mounts: mounts, IndexMax: *indexMax, Lock: lock}
	s.StartIndexes()
	addr := *listen
	if addr == "" {
		addr = net.JoinHostPort(bindIP, *port)
	}
	log.Printf("rfs-agent on %s (%s, readonly=%v, password=%v)", addr, who, *readOnly, lock != nil)
	log.Fatal(http.ListenAndServe(addr, agent.Auth(allow, s.Handler())))
}

// setPassword prompts twice with echo off and writes the hash file.
func setPassword(path string) error {
	read := func(prompt string) (string, error) {
		fmt.Fprint(os.Stderr, prompt)
		if term.IsTerminal(int(os.Stdin.Fd())) {
			b, err := term.ReadPassword(int(os.Stdin.Fd()))
			fmt.Fprintln(os.Stderr)
			return string(b), err
		}
		var s string
		_, err := fmt.Fscanln(os.Stdin, &s) // piped: one line, no echo concerns
		return s, err
	}
	pw, err := read("Access password for this machine (empty to remove): ")
	if err != nil && pw == "" {
		pw = ""
	}
	if pw != "" {
		again, _ := read("Repeat: ")
		if again != pw {
			return errors.New("passwords do not match")
		}
	}
	if err := agent.SetPassword(path, pw); err != nil {
		return err
	}
	if pw == "" {
		fmt.Fprintln(os.Stderr, "access password removed; restart rfs-agent")
	} else {
		fmt.Fprintf(os.Stderr, "access password set in %s; restart rfs-agent\n", path)
	}
	return nil
}
