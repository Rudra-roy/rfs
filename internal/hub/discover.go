package hub

import (
	"context"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"rfs/internal/agent"
	"rfs/internal/tsl"
)

// Machine is one tailnet node owned by us, with or without a running agent.
type Machine struct {
	Name     string        `json:"name"` // lowercase hostname, used in URLs
	IP       string        `json:"ip"`
	Port     string        `json:"port,omitempty"` // agent port override (demo fleets); empty = default
	OS       string        `json:"os"`
	Online   bool          `json:"online"` // tailscale says reachable
	Agent    bool          `json:"agent"`  // agent answered on the last poll
	LastSeen time.Time     `json:"lastSeen"`
	Mounts   []agent.Mount `json:"mounts"`
}

type Registry struct {
	ts     *tsl.Client
	port   string
	client *http.Client

	mu       sync.RWMutex
	machines map[string]*Machine
	static   bool // demo fleet: never poll the tailnet, only refresh agent mounts
}

// NewDemoRegistry serves a fixed fleet from JSON. Machines with an "ip" are real
// agents and get their mounts polled; the rest are shown as listed. For screenshots
// and demos without exposing a real tailnet.
func NewDemoRegistry(fleet []Machine, agentPort string) *Registry {
	r := NewRegistry(nil, agentPort)
	r.static = true
	for i := range fleet {
		m := fleet[i]
		m.Name = strings.ToLower(m.Name)
		if m.Mounts == nil {
			m.Mounts = []agent.Mount{}
		}
		r.machines[m.Name] = &m
	}
	return r
}

// Addr is the agent address for a machine.
func (m Machine) Addr(defaultPort string) string {
	port := m.Port
	if port == "" {
		port = defaultPort
	}
	return net.JoinHostPort(m.IP, port)
}

func NewRegistry(ts *tsl.Client, agentPort string) *Registry {
	return &Registry{ts: ts, port: agentPort, machines: map[string]*Machine{},
		client: &http.Client{Timeout: 3 * time.Second}}
}

// Run polls forever; call in a goroutine.
func (r *Registry) Run(ctx context.Context, every time.Duration) {
	for {
		r.poll()
		select {
		case <-ctx.Done():
			return
		case <-time.After(every):
		}
	}
}

func (r *Registry) poll() {
	if r.static {
		r.pollStatic()
		return
	}
	st, err := r.ts.Status()
	if err != nil {
		log.Printf("discover: %v", err)
		return
	}
	nodes := append([]tsl.Node{st.Self}, func() (out []tsl.Node) {
		for _, p := range st.Peer {
			if p.UserID == st.Self.UserID && p.OS != "android" && p.OS != "iOS" {
				out = append(out, p)
			}
		}
		return
	}()...)
	var wg sync.WaitGroup
	for _, n := range nodes {
		if len(n.TailscaleIPs) == 0 {
			continue
		}
		wg.Add(1)
		go func(n tsl.Node) {
			defer wg.Done()
			name := strings.ToLower(n.HostName)
			ip := n.TailscaleIPs[0]
			var mounts []agent.Mount
			ok := false
			if n.Online {
				if resp, err := r.client.Get("http://" + net.JoinHostPort(ip, r.port) + "/v1/mounts"); err == nil {
					ok = resp.StatusCode == 200 && json.NewDecoder(resp.Body).Decode(&mounts) == nil
					resp.Body.Close()
				}
			}
			r.mu.Lock()
			m, exists := r.machines[name]
			if !exists {
				m = &Machine{Name: name, Mounts: []agent.Mount{}}
				r.machines[name] = m
			}
			m.IP, m.OS, m.Online, m.Agent = ip, n.OS, n.Online, ok
			if ok {
				m.Mounts, m.LastSeen = mounts, time.Now()
			}
			r.mu.Unlock()
		}(n)
	}
	wg.Wait()
}

func (r *Registry) pollStatic() {
	r.mu.RLock()
	var targets []*Machine
	for _, m := range r.machines {
		if m.IP != "" {
			targets = append(targets, m)
		}
	}
	r.mu.RUnlock()
	for _, m := range targets {
		var mounts []agent.Mount
		ok := false
		if resp, err := r.client.Get("http://" + m.Addr(r.port) + "/v1/mounts"); err == nil {
			ok = resp.StatusCode == 200 && json.NewDecoder(resp.Body).Decode(&mounts) == nil
			resp.Body.Close()
		}
		r.mu.Lock()
		m.Online, m.Agent = ok, ok
		if ok {
			m.Mounts, m.LastSeen = mounts, time.Now()
		}
		r.mu.Unlock()
	}
}

func (r *Registry) List() []Machine {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Machine, 0, len(r.machines))
	for _, m := range r.machines {
		out = append(out, *m)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Agent != out[j].Agent {
			return out[i].Agent
		}
		return out[i].Name < out[j].Name
	})
	return out
}

func (r *Registry) Lookup(name string) (Machine, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	m, ok := r.machines[name]
	if !ok {
		return Machine{}, false
	}
	return *m, true
}
