package agent

import (
	"bufio"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
)

// pseudo filesystems and container noise we never expose.
var skipFS = map[string]bool{
	"proc": true, "sysfs": true, "devtmpfs": true, "devpts": true, "tmpfs": true, "overlay": true,
	"squashfs": true, "cgroup": true, "cgroup2": true, "nsfs": true, "autofs": true, "binfmt_misc": true,
	"debugfs": true, "tracefs": true, "securityfs": true, "pstore": true, "efivarfs": true, "bpf": true,
	"mqueue": true, "hugetlbfs": true, "configfs": true, "fusectl": true, "rpc_pipefs": true, "ramfs": true,
	"fuse.portal": true, "fuse.gvfsd-fuse": true, "fuse.snapfuse": true,
}

func Mounts() ([]Mount, error) {
	if IsAndroid() {
		return androidMounts("/storage")
	}
	f, err := os.Open("/proc/self/mountinfo")
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []Mount
	seen := map[string]bool{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		// mountinfo: id parent major:minor root mountpoint opts [optional...] - fstype source superopts
		fs := strings.Fields(sc.Text())
		sep := slices.Index(fs, "-")
		if sep < 5 || sep+2 >= len(fs) {
			continue
		}
		root, mp, typ, dev := fs[3], unescape(fs[4]), fs[sep+1], fs[sep+2]
		if root != "/" { // bind mount of a subdirectory; its parent fs is already listed
			continue
		}
		if skipFS[typ] || seen[mp] || strings.HasPrefix(mp, "/var/lib/docker/") || strings.HasPrefix(mp, "/snap/") || mp == "/boot/efi" {
			continue
		}
		if !strings.HasPrefix(dev, "/dev/") && typ != "zfs" && typ != "nfs" && typ != "nfs4" && typ != "cifs" {
			continue
		}
		var st syscall.Statfs_t
		if syscall.Statfs(mp, &st) != nil {
			continue
		}
		seen[mp] = true
		out = append(out, Mount{Path: mp, Label: label(mp), FSType: typ,
			Total: st.Blocks * uint64(st.Bsize), Free: st.Bavail * uint64(st.Bsize)})
	}
	return out, sc.Err()
}

func label(mp string) string {
	if mp == "/" {
		return "root"
	}
	return filepath.Base(mp)
}

// mountinfo escapes spaces as \040 etc.
func unescape(s string) string {
	return strings.NewReplacer(`\040`, " ", `\011`, "\t", `\012`, "\n", `\134`, `\`).Replace(s)
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
