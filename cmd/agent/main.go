package main

import (
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"

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
	s := &agent.Server{ReadOnly: *readOnly, Mounts: mounts, IndexMax: *indexMax, Lock: lock}
	s.StartIndexes()
	addr := net.JoinHostPort(self.TailscaleIPs[0], *port)
	log.Printf("rfs-agent %s on %s (owner user %d, readonly=%v, password=%v)", self.HostName, addr, self.UserID, *readOnly, lock != nil)
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
