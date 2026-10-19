package hub

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"rfs/internal/agent"
)

func fakeAgent(t *testing.T, hits string) (ip, port string) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/mounts" {
			fmt.Fprint(w, `[{"path":"/","label":"root"}]`)
			return
		}
		fmt.Fprint(w, hits)
	}))
	t.Cleanup(srv.Close)
	h, p, _ := net.SplitHostPort(strings.TrimPrefix(srv.URL, "http://"))
	return h, p
}

func TestSearchFanOut(t *testing.T) {
	ip1, p1 := fakeAgent(t, "{\"p\":\"/a\",\"n\":\"report.pdf\",\"s\":1,\"m\":2}\n{\"done\":true}\n")
	ip2, p2 := fakeAgent(t, "{\"p\":\"/b\",\"n\":\"Report-final.pdf\",\"s\":3,\"m\":4}\n{\"done\":false}\n")
	reg := NewDemoRegistry([]Machine{
		{Name: "alpha", IP: ip1, Port: p1, Agent: true, Mounts: []agent.Mount{{Path: "/", Label: "root"}}},
		{Name: "beta", IP: ip2, Port: p2, Agent: true, Mounts: []agent.Mount{{Path: "/", Label: "root"}}},
	}, "7421")
	rec := httptest.NewRecorder()
	Search(reg, "7421", nil).ServeHTTP(rec, httptest.NewRequest("GET", "/api/search?q=report", nil))
	body, _ := io.ReadAll(rec.Body)
	out := string(body)
	for _, want := range []string{`"machine":"alpha"`, `"n":"report.pdf"`, `"machine":"beta"`, `"n":"Report-final.pdf"`, `"done":true`, `"done":false`} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %s in %s", want, out)
		}
	}
	rec = httptest.NewRecorder()
	Search(reg, "7421", nil).ServeHTTP(rec, httptest.NewRequest("GET", "/api/search?q=r", nil))
	if rec.Code != 400 {
		t.Fatalf("short query: %d", rec.Code)
	}
}

func TestAuditLine(t *testing.T) {
	path := t.TempDir() + "/audit.log"
	a, err := OpenAudit(path)
	if err != nil {
		t.Fatal(err)
	}
	h := AsEmail("me@example.com", a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { // same order as main: auth outside, audit inside
		w.WriteHeader(206)
		w.Write([]byte("0123456789"))
	})))
	req := httptest.NewRequest("GET", "/api/m/alpha/v1/file?path=/x/y.mp4", nil)
	req.SetPathValue("name", "alpha")
	h.ServeHTTP(httptest.NewRecorder(), req)
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/assets/app.js", nil)) // not audited
	b, _ := io.ReadAll(mustOpen(t, path))
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	if len(lines) != 1 {
		t.Fatalf("want 1 line, got %d: %s", len(lines), b)
	}
	for _, want := range []string{`"user":"me@example.com"`, `"machine":"alpha"`, `"file":"/x/y.mp4"`, `"status":206`, `"bytes":10`} {
		if !strings.Contains(lines[0], want) {
			t.Fatalf("missing %s in %s", want, lines[0])
		}
	}
}

func mustOpen(t *testing.T, p string) io.Reader {
	f, err := http.Dir("/").Open(p)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func TestAliases(t *testing.T) {
	dir := t.TempDir()
	a := LoadAliases(dir)
	reg := NewDemoRegistry([]Machine{{Name: "alpha"}}, "7421")
	h := a.Handler(reg)
	put := func(name, body string) int {
		req := httptest.NewRequest("PUT", "/api/machines/"+name+"/alias", strings.NewReader(body))
		req.SetPathValue("name", name)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	if c := put("alpha", `{"alias":"Lab box"}`); c != 204 {
		t.Fatalf("set: %d", c)
	}
	if LoadAliases(dir).Get("alpha") != "Lab box" {
		t.Fatal("alias not persisted")
	}
	if c := put("nope", `{"alias":"x"}`); c != 404 {
		t.Fatalf("unknown machine: %d", c)
	}
	if c := put("alpha", `{"alias":"`+strings.Repeat("x", 41)+`"}`); c != 400 {
		t.Fatalf("too long accepted: %d", c)
	}
	if c := put("alpha", `{"alias":""}`); c != 204 || a.Get("alpha") != "" {
		t.Fatalf("clear: %d %q", c, a.Get("alpha"))
	}
	if ms := a.Apply([]Machine{{Name: "alpha"}}); ms[0].Alias != "" {
		t.Fatal("apply after clear")
	}
}
