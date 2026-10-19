package agent

import (
	"syscall"
	"unsafe"
)

// ponytail: untested until the Windows node is online; uses only syscall so it cross-compiles.
var (
	k32                  = syscall.NewLazyDLL("kernel32.dll")
	getLogicalDrives     = k32.NewProc("GetLogicalDriveStringsW")
	getDiskFreeSpaceEx   = k32.NewProc("GetDiskFreeSpaceExW")
	getDriveType         = k32.NewProc("GetDriveTypeW")
	getVolumeInformation = k32.NewProc("GetVolumeInformationW")
)

func Mounts() ([]Mount, error) {
	buf := make([]uint16, 512)
	n, _, err := getLogicalDrives.Call(uintptr(len(buf)), uintptr(unsafe.Pointer(&buf[0])))
	if n == 0 {
		return nil, err
	}
	var out []Mount
	for _, s := range splitNUL(buf[:n]) {
		p, _ := syscall.UTF16PtrFromString(s)
		typ, _, _ := getDriveType.Call(uintptr(unsafe.Pointer(p)))
		if typ != 3 && typ != 2 && typ != 4 { // fixed, removable, remote
			continue
		}
		var free, total uint64
		getDiskFreeSpaceEx.Call(uintptr(unsafe.Pointer(p)), uintptr(unsafe.Pointer(&free)), uintptr(unsafe.Pointer(&total)), 0)
		name := make([]uint16, 261)
		fs := make([]uint16, 261)
		getVolumeInformation.Call(uintptr(unsafe.Pointer(p)), uintptr(unsafe.Pointer(&name[0])), 261, 0, 0, 0, uintptr(unsafe.Pointer(&fs[0])), 261)
		lbl := syscall.UTF16ToString(name)
		if lbl == "" {
			lbl = s[:1]
		}
		out = append(out, Mount{Path: s, Label: lbl, FSType: syscall.UTF16ToString(fs), Total: total, Free: free})
	}
	return out, nil
}

func splitNUL(b []uint16) []string {
	var out []string
	start := 0
	for i, c := range b {
		if c == 0 {
			if i > start {
				out = append(out, syscall.UTF16ToString(b[start:i]))
			}
			start = i + 1
		}
	}
	return out
}

// WithUsage fills Total/Free for mounts given on the command line.
func WithUsage(ms []Mount) []Mount {
	out := make([]Mount, 0, len(ms))
	for _, m := range ms {
		p, _ := syscall.UTF16PtrFromString(m.Path)
		var free, total uint64
		getDiskFreeSpaceEx.Call(uintptr(unsafe.Pointer(p)), uintptr(unsafe.Pointer(&free)), uintptr(unsafe.Pointer(&total)), 0)
		m.Total, m.Free = total, free
		out = append(out, m)
	}
	return out
}
