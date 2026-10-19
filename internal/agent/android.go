package agent

import (
	"errors"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"syscall"
)

// IsAndroid reports whether the agent runs on Android (for example in Termux).
func IsAndroid() bool {
	if os.Getenv("ANDROID_ROOT") != "" {
		return true
	}
	_, err := os.Stat("/system/build.prop")
	return err == nil
}

var sdCard = regexp.MustCompile(`^[0-9A-F]{4}-[0-9A-F]{4}$`)

// androidMounts lists the phone's shared storage and any SD cards under storage
// (normally /storage). Termux needs `termux-setup-storage` before these are readable.
func androidMounts(storage string) ([]Mount, error) {
	var out []Mount
	add := func(p, label string) {
		var st syscall.Statfs_t
		if syscall.Statfs(p, &st) != nil {
			return
		}
		if _, err := os.ReadDir(p); err != nil {
			log.Printf("%s is not readable (%v); run termux-setup-storage and allow file access", p, err)
			return
		}
		out = append(out, Mount{Path: p, Label: label, FSType: "android", Total: st.Blocks * uint64(st.Bsize), Free: st.Bavail * uint64(st.Bsize)})
	}
	add(filepath.Join(storage, "emulated", "0"), "Phone")
	if ents, err := os.ReadDir(storage); err == nil {
		for _, e := range ents {
			if sdCard.MatchString(e.Name()) {
				add(filepath.Join(storage, e.Name()), "SD card")
			}
		}
	}
	if len(out) == 0 {
		return nil, errors.New("no readable phone storage; run termux-setup-storage")
	}
	return out, nil
}
