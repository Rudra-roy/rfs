package agent

import (
	"bufio"
	"crypto/sha1"
	"encoding/gob"
	"encoding/hex"
	"errors"
	"io/fs"
	"log"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Index is a flat, compact filename index for one drive: every entry is a
// small record pointing into one shared name buffer. Built by a background
// walk, persisted to the cache dir, refreshed per folder on writes through the
// agent, rebuilt every rebuildEvery. Search is a linear scan with ASCII case
// folding; a few million entries scan in well under 100 ms.
type Index struct {
	Mount string
	Max   int // entry cap; the index is abandoned above this

	mu      sync.RWMutex
	dirs    []string // dir paths relative to Mount, slash-separated, "." for root
	dirID   map[string]uint32
	ents    []ent
	names   []byte
	builtAt time.Time
	took    time.Duration // last rebuild duration; drives the rebuild interval
	ready   bool
	gaveUp  bool // over the cap: stop trying
	dead    int  // tombstones since last compaction

	rebuilding bool
	pending    map[string]bool      // folders touched during a rebuild, replayed after the swap
	touchedAt  map[string]time.Time // per-folder debounce
	timers     map[string]*time.Timer
}

const indexVersion = 2 // bump when ent or indexFile changes; mismatched caches are rebuilt

type ent struct {
	Off   uint32
	Len   uint16 // 0 = tombstone
	Dir   uint32
	IsDir bool
	Size  int64
	Mtime int64
}

const rebuildEvery = 6 * time.Hour // ceiling; cheap drives rebuild far more often

// interval between rebuilds: 60x the last build time, between 15 minutes and 6 hours,
// so a 10 s drive refreshes every 15 min and a 5 min drive every 5 h
func (x *Index) interval() time.Duration {
	x.mu.RLock()
	took := x.took
	x.mu.RUnlock()
	d := 60 * took
	return max(15*time.Minute, min(rebuildEvery, d))
}

var indexDirsSkip = skipDirs // same list the live walk uses

// top-level system directories of an OS drive: never worth indexing for a
// personal file search, and the bulk of a root filesystem's entry count
var systemTop = map[string]bool{"usr": true, "var": true, "snap": true, "boot": true, "lib": true, "lib32": true, "lib64": true, "libx32": true,
	"bin": true, "sbin": true, "lost+found": true, "Windows": true, "Program Files": true, "Program Files (x86)": true, "ProgramData": true, "$Recycle.Bin": true, "System Volume Information": true}

func NewIndex(mount string, max int) *Index {
	return &Index{Mount: mount, Max: max, dirID: map[string]uint32{}, pending: map[string]bool{}, touchedAt: map[string]time.Time{}, timers: map[string]*time.Timer{}}
}

func (x *Index) Ready() bool { x.mu.RLock(); defer x.mu.RUnlock(); return x.ready }
func (x *Index) BuiltAt() time.Time {
	x.mu.RLock()
	defer x.mu.RUnlock()
	return x.builtAt
}
func (x *Index) Len() int { x.mu.RLock(); defer x.mu.RUnlock(); return len(x.ents) - x.dead }

// Start loads a persisted index if fresh enough, then keeps rebuilding in the background.
func (x *Index) Start() {
	go func() {
		if err := x.load(); err == nil && time.Since(x.BuiltAt()) < rebuildEvery {
			log.Printf("index %s: loaded %d entries from cache", x.Mount, x.Len())
		} else {
			x.Rebuild()
		}
		for {
			time.Sleep(max(time.Minute, x.interval()-time.Since(x.BuiltAt())))
			if !x.Rebuild() {
				return // over the cap or unreadable: leave searches to the live walk
			}
		}
	}()
}

// Rebuild walks the whole drive into a fresh index and swaps it in. Returns
// false when the drive cannot be indexed (unreadable, or over the entry cap).
func (x *Index) Rebuild() bool {
	start := time.Now()
	x.mu.Lock()
	x.rebuilding = true
	x.pending = map[string]bool{}
	x.mu.Unlock()
	defer func() { x.mu.Lock(); x.rebuilding = false; x.mu.Unlock() }()
	root, err := os.OpenRoot(x.Mount)
	if err != nil {
		log.Printf("index %s: %v", x.Mount, err)
		x.mu.Lock()
		x.gaveUp, x.builtAt = true, time.Now()
		x.mu.Unlock()
		return false
	}
	defer root.Close()
	fsys := root.FS()
	trash := filepath.ToSlash(trashRel(Mount{Path: x.Mount}))
	n := &Index{Mount: x.Mount, Max: x.Max, dirID: map[string]uint32{}}
	queue := []string{"."}
	n.dirs = append(n.dirs, ".")
	n.dirID["."] = 0
	visited := 0
	var rootDev uint64
	haveDev := false
	if st, err := fs.Stat(fsys, "."); err == nil {
		rootDev, haveDev = deviceOf(st)
	}
	for len(queue) > 0 && len(n.ents) < n.Max {
		dir := queue[0]
		queue = queue[1:]
		ents, err := fs.ReadDir(fsys, dir)
		if err != nil {
			continue
		}
		did := n.dirID[dir]
		for _, d := range ents {
			name := d.Name()
			p := name
			if dir != "." {
				p = path.Join(dir, name)
			}
			info, ierr := d.Info()
			if ierr != nil {
				continue
			}
			if d.IsDir() && !indexDirsSkip[name] && p != trash && !(dir == "." && systemTop[name]) {
				descend := true
				if haveDev { // another filesystem (bind mount, other drive) has its own index
					if dev, ok := deviceOf(info); ok && dev != rootDev {
						descend = false
					}
				}
				if descend {
					n.dirID[p] = uint32(len(n.dirs))
					n.dirs = append(n.dirs, p)
					queue = append(queue, p)
				}
			}
			n.add(did, name, d.IsDir(), info.Size(), info.ModTime().UnixMilli())
			visited++
			if visited%20000 == 0 {
				time.Sleep(5 * time.Millisecond) // stay out of the way of real IO
			}
		}
	}
	if len(n.ents) >= n.Max {
		log.Printf("index %s: more than %d entries, giving up (raise -index-max; ~70 bytes per entry resident, double during a rebuild)", x.Mount, x.Max)
		x.mu.Lock()
		x.gaveUp, x.builtAt, x.took = true, time.Now(), time.Since(start)
		x.mu.Unlock()
		return false
	}
	n.builtAt = time.Now()
	x.mu.Lock()
	replay := x.pending
	x.pending = map[string]bool{}
	x.dirs, x.dirID, x.ents, x.names, x.builtAt, x.ready, x.dead = n.dirs, n.dirID, n.ents, n.names, n.builtAt, true, 0
	x.took = time.Since(start)
	x.mu.Unlock()
	for rel := range replay { // writes that landed mid-walk
		x.Refresh(rel)
	}
	log.Printf("index %s: %d entries in %s", x.Mount, len(n.ents), time.Since(start).Round(time.Millisecond))
	if err := x.save(); err != nil {
		log.Printf("index %s: save: %v", x.Mount, err)
	}
	return true
}

// Touch schedules a Refresh of rel, coalescing bursts into one refresh per
// folder per two seconds.
func (x *Index) Touch(rel string) {
	rel = filepath.ToSlash(filepath.Clean(rel))
	if rel == "" || rel == "/" {
		rel = "."
	}
	for _, seg := range strings.Split(rel, "/") {
		if indexDirsSkip[seg] {
			return
		}
	}
	if top := strings.SplitN(rel, "/", 2)[0]; rel != "." && systemTop[top] {
		return
	}
	x.mu.Lock()
	defer x.mu.Unlock()
	if x.rebuilding {
		x.pending[rel] = true
	}
	if t, ok := x.timers[rel]; ok {
		t.Reset(2 * time.Second)
		return
	}
	x.timers[rel] = time.AfterFunc(2*time.Second, func() {
		x.mu.Lock()
		delete(x.timers, rel)
		x.mu.Unlock()
		x.Refresh(rel)
	})
}

// DropTree tombstones a folder and everything under it (after a rename or trash).
func (x *Index) DropTree(rel string) {
	rel = filepath.ToSlash(filepath.Clean(rel))
	x.mu.Lock()
	defer x.mu.Unlock()
	if !x.ready {
		return
	}
	prefix := rel + "/"
	under := map[uint32]bool{}
	for p, id := range x.dirID {
		if p == rel || strings.HasPrefix(p, prefix) {
			under[id] = true
		}
	}
	for i := range x.ents {
		if x.ents[i].Len != 0 && under[x.ents[i].Dir] {
			x.ents[i].Len = 0
			x.dead++
		}
	}
	x.compactLocked()
}

// compactLocked drops tombstones once they are a large share of the index. Caller holds x.mu.
func (x *Index) compactLocked() {
	if x.dead < 100_000 || x.dead < len(x.ents)/2 {
		return
	}
	live := make([]ent, 0, len(x.ents)-x.dead)
	names := make([]byte, 0, len(x.names))
	for _, e := range x.ents {
		if e.Len == 0 {
			continue
		}
		n := x.names[e.Off : e.Off+uint32(e.Len)]
		e.Off = uint32(len(names))
		names = append(names, n...)
		live = append(live, e)
	}
	x.ents, x.names, x.dead = live, names, 0
}

func (x *Index) add(dir uint32, name string, isDir bool, size, mtime int64) {
	x.ents = append(x.ents, ent{Off: uint32(len(x.names)), Len: uint16(min(len(name), 65535)), Dir: dir, IsDir: isDir, Size: size, Mtime: mtime})
	x.names = append(x.names, name...)
}

// Refresh re-lists one folder (relative to Mount) after a write through the agent.
// Entries for that folder are tombstoned and re-added; new subfolders get ids.
func (x *Index) Refresh(rel string) {
	rel = filepath.ToSlash(filepath.Clean(rel))
	if rel == "" || rel == "/" {
		rel = "."
	}
	root, err := os.OpenRoot(x.Mount)
	if err != nil {
		return
	}
	defer root.Close()
	ents, err := fs.ReadDir(root.FS(), rel)
	x.mu.Lock()
	defer x.mu.Unlock()
	if !x.ready {
		return
	}
	did, ok := x.dirID[rel]
	if !ok {
		did = uint32(len(x.dirs))
		x.dirs = append(x.dirs, rel)
		x.dirID[rel] = did
	}
	for i := range x.ents {
		if x.ents[i].Dir == did && x.ents[i].Len != 0 {
			x.ents[i].Len = 0
			x.dead++
		}
	}
	if err != nil {
		return // folder gone; its entries are already tombstoned
	}
	for _, d := range ents {
		info, ierr := d.Info()
		if ierr != nil {
			continue
		}
		x.add(did, d.Name(), d.IsDir(), info.Size(), info.ModTime().UnixMilli())
		if d.IsDir() {
			p := d.Name()
			if rel != "." {
				p = path.Join(rel, p)
			}
			if _, ok := x.dirID[p]; !ok {
				x.dirID[p] = uint32(len(x.dirs))
				x.dirs = append(x.dirs, p)
			}
		}
	}
	x.compactLocked()
}

// Hit is one search result: the folder (absolute) and the entry's stats.
type Hit struct {
	Dir   string
	Name  string
	IsDir bool
	Size  int64
	Mtime int64
	depth int
}

// Search returns up to limit entries under rel whose name contains needle
// (ASCII case-insensitive), shallowest first. Exhaustive: the whole index is
// scanned, so the done flag is true unless limit was hit.
func (x *Index) Search(rel, needle string, limit int) (hits []Hit, done bool) {
	x.mu.RLock()
	defer x.mu.RUnlock()
	rel = filepath.ToSlash(filepath.Clean(rel))
	nd := []byte(strings.ToLower(needle))
	prefix := rel + "/"
	type cand struct {
		i     int
		depth int
	}
	var cands []cand // indexes only; hits are built for the survivors
	for i, e := range x.ents {
		if e.Len == 0 {
			continue
		}
		if !containsFold(x.names[e.Off:e.Off+uint32(e.Len)], nd) {
			continue
		}
		dir := x.dirs[e.Dir]
		if rel != "." && dir != rel && !strings.HasPrefix(dir, prefix) {
			continue
		}
		depth := 0
		if dir != "." {
			depth = strings.Count(dir, "/") + 1
		}
		cands = append(cands, cand{i, depth})
	}
	sort.SliceStable(cands, func(a, b int) bool {
		if cands[a].depth != cands[b].depth {
			return cands[a].depth < cands[b].depth
		}
		ea, eb := x.ents[cands[a].i], x.ents[cands[b].i]
		return string(x.names[ea.Off:ea.Off+uint32(ea.Len)]) < string(x.names[eb.Off:eb.Off+uint32(eb.Len)])
	})
	done = len(cands) <= limit
	if !done {
		cands = cands[:limit]
	}
	for _, c := range cands {
		e := x.ents[c.i]
		hits = append(hits, Hit{Dir: filepath.Join(x.Mount, filepath.FromSlash(x.dirs[e.Dir])), Name: string(x.names[e.Off : e.Off+uint32(e.Len)]), IsDir: e.IsDir, Size: e.Size, Mtime: e.Mtime, depth: c.depth})
	}
	return hits, done
}

// containsFold is bytes.Contains with ASCII case folding and no allocation.
func containsFold(hay, needle []byte) bool {
	if len(needle) == 0 {
		return true
	}
	if len(hay) < len(needle) {
		return false
	}
	first := fold(needle[0])
	for i := 0; i+len(needle) <= len(hay); i++ {
		if fold(hay[i]) != first {
			continue
		}
		ok := true
		for j := 1; j < len(needle); j++ {
			if fold(hay[i+j]) != fold(needle[j]) {
				ok = false
				break
			}
		}
		if ok {
			return true
		}
	}
	return false
}

func fold(c byte) byte {
	if c >= 'A' && c <= 'Z' {
		return c + 32
	}
	return c
}

// ---- persistence ------------------------------------------------------------

type indexFile struct {
	Version int
	Mount   string
	Dirs    []string
	Ents    []ent
	Names   []byte
	BuiltAt time.Time
	Took    time.Duration
}

func (x *Index) cachePath() string {
	sum := sha1.Sum([]byte(x.Mount))
	return filepath.Join(thumbCacheDir(), "..", "index-"+hex.EncodeToString(sum[:8])+".gob")
}

// save streams the index to disk under the read lock, so Refresh cannot
// mutate the arrays mid-encode. Writers wait a few seconds; searches do not.
func (x *Index) save() error {
	p := x.cachePath()
	os.MkdirAll(filepath.Dir(p), 0o755)
	fh, err := os.OpenFile(p+".tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	bw := bufio.NewWriterSize(fh, 1<<20)
	x.mu.RLock()
	f := indexFile{Version: indexVersion, Mount: x.Mount, Dirs: x.dirs, Ents: x.ents, Names: x.names, BuiltAt: x.builtAt, Took: x.took}
	err = gob.NewEncoder(bw).Encode(&f)
	x.mu.RUnlock()
	if err == nil {
		err = bw.Flush()
	}
	if cerr := fh.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(p + ".tmp")
		return err
	}
	return os.Rename(p+".tmp", p)
}

func (x *Index) load() error {
	fh, err := os.Open(x.cachePath())
	if err != nil {
		return err
	}
	defer fh.Close()
	var f indexFile
	if err := gob.NewDecoder(bufio.NewReaderSize(fh, 1<<20)).Decode(&f); err != nil {
		return err
	}
	if f.Version != indexVersion || f.Mount != x.Mount || len(f.Ents) > x.Max {
		return errors.New("stale cache")
	}
	for _, e := range f.Ents { // a corrupt file must not become an out-of-range slice at search time
		if int(e.Dir) >= len(f.Dirs) || int(e.Off)+int(e.Len) > len(f.Names) {
			return errors.New("corrupt cache")
		}
	}
	ids := make(map[string]uint32, len(f.Dirs))
	for i, d := range f.Dirs {
		ids[d] = uint32(i)
	}
	x.mu.Lock()
	x.dirs, x.dirID, x.ents, x.names, x.builtAt, x.took, x.ready = f.Dirs, ids, f.Ents, f.Names, f.BuiltAt, f.Took, true
	x.mu.Unlock()
	return nil
}
