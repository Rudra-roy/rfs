package agent

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAndroidMounts(t *testing.T) {
	st := t.TempDir()
	os.MkdirAll(filepath.Join(st, "emulated", "0", "DCIM"), 0o755)
	os.MkdirAll(filepath.Join(st, "1A2B-3C4D"), 0o755)
	os.MkdirAll(filepath.Join(st, "self"), 0o755) // not a card
	ms, err := androidMounts(st)
	if err != nil || len(ms) != 2 || ms[0].Label != "Phone" || ms[1].Label != "SD card" || ms[1].Path != filepath.Join(st, "1A2B-3C4D") {
		t.Fatalf("%+v %v", ms, err)
	}
	if _, err := androidMounts(t.TempDir()); err == nil {
		t.Fatal("empty storage accepted")
	}
}

func TestAllowList(t *testing.T) {
	a, err := ParseAllowList("100.82.89.98, fd7a:115c:a1e0::1")
	if err != nil {
		t.Fatal(err)
	}
	if !a.Has("100.82.89.98") || !a.Has("fd7a:115c:a1e0::1") || a.Has("100.82.89.99") || a.Has("::ffff:192.168.1.5") {
		t.Fatal("membership")
	}
	if !a.Has("::ffff:100.82.89.98") {
		t.Fatal("v4-mapped form of an allowed address rejected")
	}
	for _, bad := range []string{"192.168.1.10", "hub.example.ts.net", ""} {
		if _, err := ParseAllowList(bad); err == nil {
			t.Fatalf("%q accepted", bad)
		}
	}
}
