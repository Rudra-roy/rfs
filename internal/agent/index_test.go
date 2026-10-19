package agent

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIndex(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	os.MkdirAll(filepath.Join(dir, "a", "deep", "node_modules", "x"), 0o755)
	os.WriteFile(filepath.Join(dir, "Report.pdf"), []byte("1"), 0o644)
	os.WriteFile(filepath.Join(dir, "a", "deep", "report-final.PDF"), []byte("22"), 0o644)
	os.WriteFile(filepath.Join(dir, "a", "deep", "node_modules", "x", "report.js"), nil, 0o644) // skipped dir
	x := NewIndex(dir, 1000)
	x.Rebuild()
	if !x.Ready() || x.Len() != 5 { // Report.pdf, a, deep, node_modules, report-final.PDF
		t.Fatalf("ready=%v len=%d", x.Ready(), x.Len())
	}
	hits, done := x.Search(".", "REPORT", 10)
	if !done || len(hits) != 2 || hits[0].Name != "Report.pdf" || hits[1].Name != "report-final.PDF" || hits[1].Dir != filepath.Join(dir, "a", "deep") {
		t.Fatalf("search: %+v done=%v", hits, done)
	}
	if h, _ := x.Search("a", "report", 10); len(h) != 1 {
		t.Fatalf("scoped search: %+v", h)
	}
	if h, done := x.Search(".", "report", 1); len(h) != 1 || done {
		t.Fatalf("limit: %+v %v", h, done)
	}
	// write-through refresh
	os.WriteFile(filepath.Join(dir, "a", "Report2.txt"), nil, 0o644)
	x.Refresh("a")
	if h, _ := x.Search(".", "report2", 10); len(h) != 1 || h[0].Dir != filepath.Join(dir, "a") {
		t.Fatalf("after refresh: %+v", h)
	}
	os.Remove(filepath.Join(dir, "Report.pdf"))
	x.Refresh(".")
	if h, _ := x.Search(".", "report.pdf", 10); len(h) != 0 {
		t.Fatalf("tombstone: %+v", h)
	}
	// persistence round trip
	y := NewIndex(dir, 1000)
	if err := y.load(); err != nil {
		t.Fatal(err)
	}
	if h, _ := y.Search(".", "final", 10); len(h) != 1 {
		t.Fatalf("loaded: %+v", h)
	}
	// cap
	z := NewIndex(dir, 2)
	z.Rebuild()
	if z.Ready() {
		t.Fatal("over-cap index marked ready")
	}
}

func TestContainsFold(t *testing.T) {
	for _, c := range []struct {
		h, n string
		want bool
	}{{"Hello.TXT", "txt", true}, {"Hello", "HELLO", true}, {"abc", "abcd", false}, {"ÄÖ", "äö", false}, {"x", "", true}} {
		if got := containsFold([]byte(c.h), []byte(c.n)); got != c.want {
			t.Errorf("%q in %q = %v", c.n, c.h, got)
		}
	}
}
