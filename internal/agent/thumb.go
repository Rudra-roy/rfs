package agent

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const thumbSize = 480

var imageExt = map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true}
var videoExt = map[string]bool{".mp4": true, ".webm": true, ".mov": true, ".m4v": true, ".mkv": true, ".avi": true}

// one decode per core at most; grid scrolling must not take the machine down
var thumbSem = make(chan struct{}, max(1, runtime.NumCPU()/2))

func thumbCacheDir() string {
	d, err := os.UserCacheDir()
	if err != nil {
		d = os.TempDir()
	}
	return filepath.Join(d, "rfs", "thumbs")
}

// handleThumb serves a JPEG preview (<= 480px) of an image or video, cached on
// disk by path+mtime+size. The client adds &v=<mtime> so browsers cache forever.
func (s *Server) handleThumb(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	_, root, rel, err := s.resolve(p)
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
	ext := strings.ToLower(filepath.Ext(rel))
	if st.IsDir() || !(imageExt[ext] || videoExt[ext]) {
		fail(w, errNotFound("no thumbnail"))
		return
	}
	sum := sha1.Sum([]byte(fmt.Sprintf("%s|%d|%d", p, st.ModTime().UnixNano(), st.Size())))
	cache := filepath.Join(thumbCacheDir(), hex.EncodeToString(sum[:])+".jpg")
	if _, err := os.Stat(cache); err != nil {
		thumbSem <- struct{}{}
		err = func() error {
			defer func() { <-thumbSem }()
			if _, err := os.Stat(cache); err == nil { // raced with another request
				return nil
			}
			os.MkdirAll(filepath.Dir(cache), 0o755)
			tmp := cache + ".tmp"
			defer os.Remove(tmp)
			var gerr error
			if imageExt[ext] {
				gerr = imageThumb(root, rel, tmp)
			} else {
				gerr = videoThumb(filepath.Join(root.Name(), rel), tmp)
			}
			if gerr != nil {
				return gerr
			}
			return os.Rename(tmp, cache)
		}()
		if err != nil {
			fail(w, errNotFound("thumbnail failed: "+err.Error()))
			return
		}
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, cache)
}

func imageThumb(root *os.Root, rel, out string) error {
	f, err := root.Open(rel)
	if err != nil {
		return err
	}
	defer f.Close()
	src, _, err := image.Decode(f)
	if err != nil {
		return err
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w > thumbSize || h > thumbSize {
		if w >= h {
			h, w = h*thumbSize/w, thumbSize
		} else {
			w, h = w*thumbSize/h, thumbSize
		}
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.ApproxBiLinear.Scale(dst, dst.Bounds(), src, b, draw.Src, nil) // ponytail: no EXIF rotation; add if phone photos show sideways
	o, err := os.Create(out)
	if err != nil {
		return err
	}
	defer o.Close()
	return jpeg.Encode(o, dst, &jpeg.Options{Quality: 82})
}

func videoThumb(abs, out string) error {
	ff, err := exec.LookPath("ffmpeg")
	if err != nil {
		return fmt.Errorf("ffmpeg not installed")
	}
	cmd := exec.Command(ff, "-v", "error", "-y", "-ss", "3", "-i", abs, "-frames:v", "1",
		"-vf", fmt.Sprintf("scale='min(%d,iw)':-2", thumbSize), "-q:v", "4", "-f", "image2", out)
	cmd.WaitDelay = 20 * time.Second
	if b, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("ffmpeg: %s", strings.TrimSpace(string(b)))
	}
	return nil
}
