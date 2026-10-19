package agent

import (
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strings"
)

// AllowList admits callers by tailnet source IP. Inside a tailnet every source
// address is bound to a WireGuard node key, so a connection from the hub's
// tailnet IP really is the hub. Used where the agent cannot ask the local
// Tailscale daemon who is calling (Android, where the Tailscale app owns it).
type AllowList map[netip.Addr]bool

var cgnat = netip.MustParsePrefix("100.64.0.0/10")
var tailnet6 = netip.MustParsePrefix("fd7a:115c:a1e0::/48")

// ParseAllowList reads "100.x.y.z,fd7a:...". Only tailnet addresses are
// accepted: an address outside the tailnet carries no identity guarantee.
func ParseAllowList(spec string) (AllowList, error) {
	a := AllowList{}
	for _, s := range strings.Split(spec, ",") {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		ip, err := netip.ParseAddr(s)
		if err != nil {
			return nil, fmt.Errorf("-allow-from: %q is not an IP address (use the hub's tailnet IP, shown in the Tailscale app)", s)
		}
		if !cgnat.Contains(ip) && !tailnet6.Contains(ip) {
			return nil, fmt.Errorf("-allow-from: %s is not a tailnet address (100.64.0.0/10)", ip)
		}
		a[ip] = true
	}
	if len(a) == 0 {
		return nil, errors.New("-allow-from: no addresses")
	}
	return a, nil
}

func (a AllowList) Has(ip string) bool {
	p, err := netip.ParseAddr(ip)
	return err == nil && a[p.Unmap()]
}

// TailnetIP finds this device's own tailnet IPv4 from its interfaces.
func TailnetIP() (string, error) {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return "", err
	}
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok {
			if ip, ok := netip.AddrFromSlice(n.IP); ok && cgnat.Contains(ip.Unmap()) {
				return ip.Unmap().String(), nil
			}
		}
	}
	return "", errors.New("no tailnet address on any interface; is Tailscale connected?")
}
