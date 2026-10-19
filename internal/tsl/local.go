// Package tsl is a tiny client for the Tailscale LocalAPI over its unix socket.
// Only what rfs needs: who am I, who are my peers, who is this caller.
package tsl

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"runtime"
	"sync"
	"time"
)

type Node struct {
	HostName, DNSName, OS string
	TailscaleIPs          []string
	Online                bool
	UserID                int64
}

type Status struct {
	Self Node
	Peer map[string]Node
}

type WhoIs struct {
	Node        struct{ Name string }
	UserProfile struct {
		ID        int64
		LoginName string
	}
}

type Client struct {
	http *http.Client
	mu   sync.Mutex
	who  map[string]whoEntry
}

type whoEntry struct {
	w   *WhoIs
	err error
	at  time.Time
}

func New() *Client {
	sock := "/var/run/tailscale/tailscaled.sock"
	if v := os.Getenv("RFS_TAILSCALE_SOCKET"); v != "" { // tests, unusual installs
		sock = v
	}
	var dial func(ctx context.Context, _, _ string) (net.Conn, error)
	if runtime.GOOS == "windows" {
		dial = func(ctx context.Context, _, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "tcp", "127.0.0.1:41112") // tailscaled TCP LocalAPI on Windows
		}
	} else {
		dial = func(ctx context.Context, _, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "unix", sock)
		}
	}
	return &Client{http: &http.Client{Transport: &http.Transport{DialContext: dial}, Timeout: 5 * time.Second}, who: map[string]whoEntry{}}
}

func (c *Client) get(path string, v any) error {
	resp, err := c.http.Get("http://local-tailscaled.sock/localapi/v0/" + path)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("localapi %s: %s", path, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

func (c *Client) Status() (*Status, error) {
	var s Status
	return &s, c.get("status", &s)
}

// WhoIs resolves a remote ip to its tailnet identity, cached for a minute.
func (c *Client) WhoIs(ip string) (*WhoIs, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.who[ip]; ok && time.Since(e.at) < time.Minute {
		return e.w, e.err
	}
	var w WhoIs
	err := c.get("whois?addr="+net.JoinHostPort(ip, "0"), &w)
	c.who[ip] = whoEntry{&w, err, time.Now()}
	return &w, err
}
