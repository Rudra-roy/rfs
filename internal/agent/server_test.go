package agent

import (
	"archive/zip"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var servers = map[*httptest.Server]*Server{}

func srvOf(t *testing.T, srv *httptest.Server) *Server {
	s, ok := servers[srv]
	if !ok {
		t.Fatal("unknown test server")
	}
	return s
}

func newTest(t *testing.T) (string, *httptest.Server) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "hello.txt"), []byte("0123456789abcdefghij"), 0o644)
	os.Mkdir(filepath.Join(dir, "sub"), 0o755)
	os.Symlink("/etc", filepath.Join(dir, "escape"))
	s := &Server{Mounts: func() ([]Mount, error) { return []Mount{{Path: dir, Label: "t"}}, nil }}
	srv := httptest.NewServer(s.Handler())
	servers[srv] = s
	t.Cleanup(srv.Close)
	return dir, srv
}

func do(t *testing.T, method, url string, body string, hdr ...string) (*http.Response, string) {
	req, _ := http.NewRequest(method, url, strings.NewReader(body))
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	return resp, string(b)
}

func TestTraversalAndDenied(t *testing.T) {
	dir, srv := newTest(t)
	cases := map[string]int{
		"../../etc/passwd":            400, // relative
		dir + "/sub/../../etc/passwd": 400, // unclean
		dir + "/escape/passwd":        403, // symlink escape, caught by os.Root
		"/proc/self/environ":          403, // denied prefix
		filepath.Dir(dir) + "/other":  404, // outside every mount
		dir + "/missing":              404,
	}
	for p, want := range cases {
		resp, _ := do(t, "GET", srv.URL+"/v1/file?path="+p, "")
		if resp.StatusCode != want {
			t.Errorf("%s: got %d want %d", p, resp.StatusCode, want)
		}
	}
}

func TestRange(t *testing.T) {
	dir, srv := newTest(t)
	resp, body := do(t, "GET", srv.URL+"/v1/file?path="+dir+"/hello.txt", "", "Range", "bytes=10-19")
	if resp.StatusCode != 206 || body != "abcdefghij" {
		t.Fatalf("range: %d %q", resp.StatusCode, body)
	}
	resp, _ = do(t, "GET", srv.URL+"/v1/file?path="+dir+"/hello.txt&dl=1", "")
	if cd := resp.Header.Get("Content-Disposition"); !strings.Contains(cd, "hello.txt") {
		t.Fatalf("disposition: %q", cd)
	}
}

func TestThumb(t *testing.T) {
	dir, srv := newTest(t)
	img := image.NewRGBA(image.Rect(0, 0, 1200, 800))
	f, _ := os.Create(filepath.Join(dir, "big.png"))
	png.Encode(f, img)
	f.Close()
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	resp, body := do(t, "GET", srv.URL+"/v1/thumb?path="+dir+"/big.png", "")
	if resp.StatusCode != 200 {
		t.Fatalf("thumb: %d %s", resp.StatusCode, body)
	}
	cfg, err := jpeg.DecodeConfig(strings.NewReader(body))
	if err != nil || cfg.Width != 480 || cfg.Height != 320 {
		t.Fatalf("thumb size %+v %v", cfg, err)
	}
	if r, _ := do(t, "GET", srv.URL+"/v1/thumb?path="+dir+"/hello.txt", ""); r.StatusCode != 404 {
		t.Fatalf("text thumb: %d", r.StatusCode)
	}
}

func TestParseMounts(t *testing.T) {
	dir := t.TempDir()
	ms, err := ParseMounts(dir + ":Vault, " + dir)
	if err != nil || len(ms) != 2 || ms[0].Label != "Vault" || ms[1].Label != filepath.Base(dir) {
		t.Fatalf("parse: %+v %v", ms, err)
	}
	if _, err := ParseMounts("relative/path"); err == nil {
		t.Fatal("relative accepted")
	}
	if _, err := ParseMounts(dir + "/missing"); err == nil {
		t.Fatal("missing dir accepted")
	}
}

func TestZip(t *testing.T) {
	dir, srv := newTest(t)
	os.WriteFile(filepath.Join(dir, "sub", "deep.txt"), []byte("deep"), 0o644)
	resp, body := do(t, "GET", srv.URL+"/v1/zip?path="+dir, "")
	if resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("Content-Disposition"), ".zip") {
		t.Fatalf("zip: %d %q", resp.StatusCode, resp.Header.Get("Content-Disposition"))
	}
	zr, err := zip.NewReader(strings.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		got[f.Name] = string(b)
	}
	if got["hello.txt"] != "0123456789abcdefghij" || got["sub/deep.txt"] != "deep" {
		t.Fatalf("zip contents: %v", got)
	}
	// subset by name
	_, body = do(t, "GET", srv.URL+"/v1/zip?path="+dir+"&name=hello.txt", "")
	zr, _ = zip.NewReader(strings.NewReader(body), int64(len(body)))
	if len(zr.File) != 1 || zr.File[0].Name != "hello.txt" {
		t.Fatalf("subset: %v", zr.File)
	}
	if r, _ := do(t, "GET", srv.URL+"/v1/zip?path="+dir+"&name=../etc", ""); r.StatusCode != 400 {
		t.Fatalf("bad name accepted: %d", r.StatusCode)
	}
	if r, _ := do(t, "GET", srv.URL+"/v1/zip?path="+dir+"/hello.txt", ""); r.StatusCode != 400 {
		t.Fatalf("zip of file accepted: %d", r.StatusCode)
	}
}

func TestSearch(t *testing.T) {
	dir, srv := newTest(t)
	os.WriteFile(filepath.Join(dir, "sub", "Hello-World.md"), []byte("x"), 0o644)
	_, body := do(t, "GET", srv.URL+"/v1/search?path="+dir+"&q=hello", "")
	if !strings.Contains(body, `"n":"hello.txt"`) || !strings.Contains(body, `"n":"Hello-World.md"`) || !strings.Contains(body, `"done":true`) {
		t.Fatalf("search: %s", body)
	}
	if strings.Contains(body, `"n":"sub"`) {
		t.Fatalf("non-matching dir returned: %s", body)
	}
	_, body = do(t, "GET", srv.URL+"/v1/search?path="+dir+"&q=hello&limit=1", "")
	if strings.Count(body, `"n":`) != 1 || !strings.Contains(body, `"done":false`) {
		t.Fatalf("limit: %s", body)
	}
	if r, _ := do(t, "GET", srv.URL+"/v1/search?path="+dir+"&q=h", ""); r.StatusCode != 400 {
		t.Fatalf("short q accepted: %d", r.StatusCode)
	}
}

func TestSearchIndexedPlusFresh(t *testing.T) {
	dir, srv := newTest(t)
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	// build the index synchronously, then create a file the index has not seen
	s := srvOf(t, srv)
	x := NewIndex(dir, 1000)
	x.Rebuild()
	x.mu.Lock()
	x.builtAt = time.Now().Add(-10 * time.Minute) // an older index gets the live top-up walk
	x.mu.Unlock()
	s.mu.Lock()
	s.indexes = map[string]*Index{dir: x}
	s.mu.Unlock()
	os.WriteFile(filepath.Join(dir, "sub", "hello-later.txt"), []byte("x"), 0o644)
	_, body := do(t, "GET", srv.URL+"/v1/search?path="+dir+"&q=hello", "")
	if strings.Count(body, `"n":"hello.txt"`) != 1 || strings.Count(body, `"n":"hello-later.txt"`) != 1 {
		t.Fatalf("hybrid search: %s", body)
	}
	if !strings.Contains(body, `"indexed":true`) || !strings.Contains(body, `"done":true`) {
		t.Fatalf("tail: %s", body)
	}
}

func TestLs(t *testing.T) {
	dir, srv := newTest(t)
	_, body := do(t, "GET", srv.URL+"/v1/ls?path="+dir, "")
	if !strings.Contains(body, `"n":"hello.txt"`) || !strings.Contains(body, `"n":"sub","d":true`) {
		t.Fatalf("ls: %s", body)
	}
}

func TestTrashRelHome(t *testing.T) {
	home := t.TempDir()
	homeDir = home
	t.Cleanup(func() { homeDir, _ = os.UserHomeDir() })
	if got := trashRel(Mount{Path: filepath.Dir(home)}); got != filepath.Join(filepath.Base(home), ".local", "share", "rfs", "trash") {
		t.Fatalf("home mount trash: %q", got)
	}
	if got := trashRel(Mount{Path: filepath.Join(home, "elsewhere")}); got != TrashDir {
		t.Fatalf("other mount trash: %q", got)
	}
}

func TestUploadMoveTrash(t *testing.T) {
	dir, srv := newTest(t)
	u := srv.URL + "/v1/file?path=" + dir + "/up.bin"
	if r, b := do(t, "PUT", u+"&offset=0", "hello"); r.StatusCode != 200 || !strings.Contains(b, `"size":5`) {
		t.Fatalf("put0: %d %s", r.StatusCode, b)
	}
	if r, _ := do(t, "PUT", u+"&offset=3", "xx"); r.StatusCode != 409 {
		t.Fatalf("bad offset accepted: %d", r.StatusCode)
	}
	if r, b := do(t, "PUT", u+"&offset=5", " world"); r.StatusCode != 200 || !strings.Contains(b, `"size":11`) {
		t.Fatalf("put5: %d %s", r.StatusCode, b)
	}
	if r, _ := do(t, "HEAD", u, ""); r.ContentLength != 11 {
		t.Fatalf("head size %d", r.ContentLength)
	}
	if r, _ := do(t, "POST", srv.URL+"/v1/mv?from="+dir+"/up.bin&to="+dir+"/sub/moved.bin", ""); r.StatusCode != 204 {
		t.Fatalf("mv: %d", r.StatusCode)
	}
	if r, _ := do(t, "POST", srv.URL+"/v1/rm?path="+dir+"/sub/moved.bin", ""); r.StatusCode != 200 {
		t.Fatalf("rm: %d", r.StatusCode)
	}
	m, _ := filepath.Glob(filepath.Join(dir, TrashDir, "*-moved.bin"))
	if len(m) != 1 {
		t.Fatalf("not in trash: %v", m)
	}
	if b, _ := os.ReadFile(m[0]); string(b) != "hello world" {
		t.Fatalf("content %q", b)
	}
	rel, _ := filepath.Rel(dir, m[0])
	if r, _ := do(t, "POST", srv.URL+"/v1/rm?path="+dir+"/"+rel, ""); r.StatusCode != 204 {
		t.Fatalf("rm from trash: %d", r.StatusCode)
	}
	if _, err := os.Stat(m[0]); err == nil {
		t.Fatal("still in trash after permanent delete")
	}
	if r, _ := do(t, "POST", srv.URL+"/v1/rm?path="+dir, ""); r.StatusCode != 400 {
		t.Fatalf("rm mount root: %d", r.StatusCode)
	}
	ro := &Server{ReadOnly: true, Mounts: func() ([]Mount, error) { return []Mount{{Path: dir}}, nil }}
	rs := httptest.NewServer(ro.Handler())
	defer rs.Close()
	if r, _ := do(t, "PUT", rs.URL+"/v1/file?path="+dir+"/x&offset=0", "x"); r.StatusCode != 403 {
		t.Fatalf("readonly put: %d", r.StatusCode)
	}
}
