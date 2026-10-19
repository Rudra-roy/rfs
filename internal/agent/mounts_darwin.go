package agent

import (
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

// filesystems that hold user data on macOS; everything else (devfs, autofs,
// system volumes mounted read-only under /System) is noise
var dataFS = map[string]bool{"apfs": true, "hfs": true, "exfat": true, "msdos": true, "ntfs": true, "smbfs": true, "nfs": true, "afpfs": true, "webdav": true}

func Mounts() ([]Mount, error) {
	n, err := syscall.Getfsstat(nil, 1 /* MNT_WAIT */)
	if err != nil {
		return nil, err
	}
	buf := make([]syscall.Statfs_t, n)
	n, err = syscall.Getfsstat(buf, 1)
	if err != nil {
		return nil, err
	}
	var out []Mount
	for _, st := range buf[:n] {
		mp := cstr(st.Mntonname[:])
		typ := cstr(st.Fstypename[:])
		if !dataFS[typ] || strings.HasPrefix(mp, "/System/") || strings.HasPrefix(mp, "/private/var/vm") || mp == "/dev" {
			continue
		}
		label := filepath.Base(mp)
		if mp == "/" {
			label = "Macintosh HD"
		}
		out = append(out, Mount{Path: mp, Label: label, FSType: typ, Total: st.Blocks * uint64(st.Bsize), Free: st.Bavail * uint64(st.Bsize)})
	}
	return out, nil
}

// WithUsage fills Total/Free for mounts given on the command line.
func WithUsage(ms []Mount) []Mount {
	out := make([]Mount, 0, len(ms))
	for _, m := range ms {
		var st syscall.Statfs_t
		if syscall.Statfs(m.Path, &st) == nil {
			m.Total, m.Free = st.Blocks*uint64(st.Bsize), st.Bavail*uint64(st.Bsize)
		}
		out = append(out, m)
	}
	return out
}

func cstr(b []int8) string {
	p := (*[1 << 16]byte)(unsafe.Pointer(&b[0]))[:len(b):len(b)]
	for i, c := range p {
		if c == 0 {
			return string(p[:i])
		}
	}
	return string(p)
}
