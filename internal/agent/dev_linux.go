package agent

import (
	"io/fs"
	"syscall"
)

// deviceOf returns the filesystem device id of an entry, so walks can stay on
// one filesystem and leave bind mounts and other drives to their own index.
func deviceOf(info fs.FileInfo) (uint64, bool) {
	if st, ok := info.Sys().(*syscall.Stat_t); ok {
		return uint64(st.Dev), true
	}
	return 0, false
}
