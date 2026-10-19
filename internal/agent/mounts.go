package agent

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Mount is one filesystem the agent exposes.
type Mount struct {
	Path   string `json:"path"`  // mount point, e.g. / or D:\
	Label  string `json:"label"` // short name for the UI
	FSType string `json:"fstype"`
	Total  uint64 `json:"total"`
	Free   uint64 `json:"free"`
}

// ParseMounts reads "-mounts /a:Label,/b:Other". Labels default to the base name.
func ParseMounts(spec string) ([]Mount, error) {
	var out []Mount
	for _, part := range strings.Split(spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		path, label := part, ""
		if i := strings.LastIndex(part, ":"); i > 1 { // > 1 keeps "C:\\" whole
			path, label = part[:i], part[i+1:]
		}
		path = filepath.Clean(path)
		if !filepath.IsAbs(path) {
			return nil, fmt.Errorf("-mounts: %q is not absolute", path)
		}
		if st, err := os.Stat(path); err != nil || !st.IsDir() {
			return nil, fmt.Errorf("-mounts: %q is not a directory", path)
		}
		if label == "" {
			label = filepath.Base(path)
		}
		out = append(out, Mount{Path: path, Label: label, FSType: "dir"})
	}
	if len(out) == 0 {
		return nil, errors.New("-mounts: nothing to expose")
	}
	return out, nil
}
