package agent

import (
	"archive/zip"
	"io"
	"io/fs"
	"log"
	"net/http"
	"path"
	"path/filepath"
	"strings"
)

// already-compressed formats are stored, everything else deflated
var storedExt = map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true, ".avif": true, ".heic": true,
	".mp4": true, ".mkv": true, ".mov": true, ".webm": true, ".m4v": true, ".mp3": true, ".m4a": true, ".aac": true, ".ogg": true, ".opus": true, ".flac": true,
	".zip": true, ".gz": true, ".tgz": true, ".bz2": true, ".xz": true, ".7z": true, ".rar": true, ".zst": true, ".pdf": true, ".iso": true, ".img": true}

// handleZip streams a zip of a directory, or of the named entries inside it
// (?name=a&name=b), straight to the response. Nothing is buffered on disk.
func (s *Server) handleZip(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	m, root, rel, err := s.resolve(q.Get("path"))
	if err != nil {
		fail(w, err)
		return
	}
	defer root.Close()
	st, err := root.Stat(rel)
	if err != nil {
		fail(w, err)
		return
	}
	if !st.IsDir() {
		fail(w, errBad("zip needs a directory"))
		return
	}
	names := q["name"]
	for _, n := range names {
		if n == "" || n == "." || n == ".." || n != filepath.Base(n) {
			fail(w, errBad("bad name"))
			return
		}
	}
	base := filepath.Base(q.Get("path"))
	if rel == "." {
		base = m.Label
	}
	if len(names) == 1 {
		base = strings.TrimSuffix(names[0], filepath.Ext(names[0]))
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+urlEscape(base+".zip"))
	zw := zip.NewWriter(w)
	fsys := root.FS()
	trash := trashRel(m)
	add := func(p string, d fs.DirEntry) error {
		if p == trash || strings.HasPrefix(p, trash+"/") {
			return fs.SkipDir
		}
		info, err := d.Info()
		if err != nil {
			return nil // vanished mid-walk; skip
		}
		name := p
		if rel != "." {
			name, _ = filepath.Rel(rel, p)
		}
		name = filepath.ToSlash(name)
		if d.IsDir() {
			if name != "." {
				hdr := &zip.FileHeader{Name: name + "/", Modified: info.ModTime()}
				zw.CreateHeader(hdr)
			}
			return nil
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		f, err := fsys.Open(p)
		if err != nil {
			log.Printf("zip: skipping %s: %v", p, err) // omitted, not written as an empty entry
			return nil
		}
		defer f.Close()
		hdr, _ := zip.FileInfoHeader(info)
		hdr.Name = name
		hdr.Method = zip.Deflate
		if storedExt[strings.ToLower(path.Ext(name))] {
			hdr.Method = zip.Store
		}
		out, err := zw.CreateHeader(hdr)
		if err != nil {
			return err
		}
		_, err = io.Copy(out, f)
		return err
	}
	walk := func(start string) error {
		return fs.WalkDir(fsys, start, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			return add(p, d)
		})
	}
	if len(names) == 0 {
		err = walk(rel)
	} else {
		for _, n := range names {
			p := n
			if rel != "." {
				p = path.Join(filepath.ToSlash(rel), n)
			}
			if err = walk(p); err != nil {
				break
			}
		}
	}
	if err != nil {
		// headers are gone; the best we can do is cut the stream short
		return
	}
	zw.Close()
}
