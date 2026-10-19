import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ChevronDown, Download, FolderArchive, File, FileArchive, FileCode2, FileText, Film, Folder, FolderPlus, FolderOpen, Image as ImageIcon, Music, Upload } from 'lucide-react'
import { fileURL, ls, mkdir, thumbURL, zipURL, type Entry } from '../api'
import { bytes, when, kind, kindColor, type Kind } from '../format'
import { navigate, join } from '../route'
import { Button, Empty, Menu, MenuItem, Skeleton, TextInput, cx } from './ui'
import type { View } from './TopBar'

export type Sort = { key: 'name' | 'size' | 'mtime'; dir: 'asc' | 'desc' }
const SORT_LABEL: Record<Sort['key'], string> = { name: 'Name', size: 'Size', mtime: 'Modified' }

export function sortEntries(rows: Entry[], hidden: boolean, sort: Sort): Entry[] {
  const dir = sort.dir === 'asc' ? 1 : -1
  const by = (a: Entry, b: Entry) => sort.key === 'name' ? collator.compare(a.n, b.n) : sort.key === 'size' ? a.s - b.s : a.m - b.m
  return rows.filter(e => hidden || !e.n.startsWith('.'))
    .sort((a, b) => Number(!!b.d) - Number(!!a.d) || dir * by(a, b) || collator.compare(a.n, b.n))
}

const cache = new Map<string, Entry[]>()
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function useListing(machine: string, path: string, nonce: number) {
  const key = `${machine}:${path}`
  const [rows, setRows] = useState<Entry[]>(() => cache.get(key) ?? [])
  const [loading, setLoading] = useState(!cache.has(key))
  const [error, setError] = useState<string>()
  useEffect(() => {
    const ac = new AbortController()
    setRows(cache.get(key) ?? []); setLoading(!cache.has(key)); setError(undefined)
    ls(machine, path, ac.signal, setRows)
      .then(all => { cache.set(key, all); setRows(all) })
      .catch(e => { if (e.name !== 'AbortError') { setError(e.message); if (e.status === 401) dispatchEvent(new Event('rfs:machines')) } })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [key, nonce])
  return { rows, loading, error }
}

const icons: Record<Kind | 'dir', typeof File> = { dir: Folder, image: ImageIcon, video: Film, audio: Music, pdf: FileText, text: FileText, code: FileCode2, archive: FileArchive, other: File }
const slot = (e: Entry) => e.d ? 'folder' : kindColor(kind(e.n))

function Icon({ e }: { e: Entry }) {
  const C = icons[e.d ? 'dir' : kind(e.n)]
  return <span data-kind={slot(e)} className="text-kind shrink-0 flex" aria-hidden><C className="size-[18px]" /></span>
}

// Strip above the list: count, sort, upload, new folder; swaps to selection actions.
export function Toolbar({ machine, path, sorted, sort, onSort, selected, onUpload, onChanged, onClear }: {
  machine: string; path: string; sorted: Entry[]; sort: Sort; onSort: (s: Sort) => void
  selected: Entry[]; onUpload: (f: FileList | null) => void; onChanged: () => void; onClear: () => void
}) {
  const visible = sorted
  const size = visible.reduce((a, e) => a + (e.d ? 0 : e.s), 0)
  const single = selected.length === 1 && !selected[0].d ? selected[0] : null
  const zipHref = selected.length > 0 && !single ? zipURL(machine, path, selected.map(e => e.n)) : null
  const [mk, setMk] = useState(false)
  const [name, setName] = useState('')
  const [err, setErr] = useState<string>()
  const input = useRef<HTMLInputElement>(null)
  const create = () => mkdir(machine, join(path, name.trim())).then(() => { setMk(false); setName(''); setErr(undefined); onChanged() }).catch(e => setErr(e.message))
  return (
    <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-line bg-bg text-[13px]">
      <span className="font-mono text-[12px] text-muted whitespace-nowrap">{visible.length} items{size > 0 && <span className="hidden sm:inline"> <span className="text-faint">·</span> {bytes(size)}</span>}</span>
      <Menu trigger={open => (
        <Button variant="ghost" size="sm" className={cx('px-2 text-muted', open && 'bg-surface-2 text-fg')} aria-haspopup="menu" aria-expanded={open}>
          <span className="hidden sm:inline">Sort:</span> {SORT_LABEL[sort.key]} {sort.dir === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}<ChevronDown className="size-3.5" />
        </Button>
      )}>
        {close => (['name', 'size', 'mtime'] as const).map(k => (
          <MenuItem key={k} active={sort.key === k} onClick={() => { close(); onSort({ key: k, dir: sort.key === k ? (sort.dir === 'asc' ? 'desc' : 'asc') : k === 'name' ? 'asc' : 'desc' }) }}>
            {SORT_LABEL[k]}{sort.key === k && <span className="ml-auto text-muted">{sort.dir === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}</span>}
          </MenuItem>
        ))}
      </Menu>
      {err && <span role="alert" className="text-danger truncate">{err}</span>}
      <div className="ml-auto flex items-center gap-1.5 min-w-0">
        {selected.length > 0 ? (
          <>
            <span className="text-[12px] text-muted whitespace-nowrap">{selected.length} selected <kbd className="hidden sm:inline font-mono text-[11px] border border-line rounded px-1 ml-1">Esc</kbd></span>
            {single && <a href={fileURL(machine, join(path, single.n), true)} download className="press inline-flex items-center gap-2 h-8 px-2.5 rounded-sm bg-accent text-accent-fg font-medium text-[13px] hover:bg-accent/90">
              <Download className="size-4" aria-hidden /> Download
            </a>}
            {zipHref && <a href={zipHref} download className="press inline-flex items-center gap-2 h-8 px-2.5 rounded-sm bg-accent text-accent-fg font-medium text-[13px] hover:bg-accent/90">
              <FolderArchive className="size-4" aria-hidden /> Download zip
            </a>}
            <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
          </>
        ) : mk ? (
          <form onSubmit={e => { e.preventDefault(); if (name.trim()) create() }} className="flex items-center gap-1.5 animate-pop">
            <TextInput autoFocus value={name} onChange={e => setName(e.target.value)} aria-label="Folder name" placeholder="Folder name" className="h-8 w-44 text-[13px]"
              onKeyDown={e => e.key === 'Escape' && setMk(false)} />
            <Button type="submit" size="sm" variant="solid">Create</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMk(false)}>Cancel</Button>
          </form>
        ) : (
          <>
            <Button size="sm" icon={<Upload />} onClick={() => input.current?.click()}>Upload</Button>
            <input ref={input} type="file" multiple hidden onChange={e => { onUpload(e.target.files); e.target.value = '' }} />
            <Button size="sm" icon={<FolderPlus />} onClick={() => setMk(true)}><span className="hidden sm:inline">New folder</span><span className="sm:hidden">Folder</span></Button>
            <a href={zipURL(machine, path)} download aria-label="Download folder as zip" title="Download folder as zip"
              className="press hidden sm:grid place-items-center size-8 rounded-sm text-muted hover:text-fg hover:bg-surface-2"><FolderArchive className="size-4" /></a>
          </>
        )}
      </div>
    </div>
  )
}

export type Selection = { names: Set<string>; focus: string | null }

type Props = {
  machine: string; path: string; sorted: Entry[]; loading: boolean; error?: string
  selection: Selection; onSelection: (s: Selection) => void; onQuickLook: (e: Entry) => void
  view: View; sort: Sort; onSort: (s: Sort) => void
  onDrop?: (files: FileList) => void
}

export function Listing(p: Props) {
  const { machine, path, sorted, loading, error, selection, onSelection, onQuickLook, view, sort, onSort } = p
  const [over, setOver] = useState(false)
  const [anchor, setAnchor] = useState<string | null>(null)
  const focusEntry = selection.focus ? sorted.find(e => e.n === selection.focus) ?? null : null
  const one = (e: Entry) => { setAnchor(e.n); onSelection({ names: new Set([e.n]), focus: e.n }) }
  const range = (to: Entry) => {
    const a = sorted.findIndex(e => e.n === anchor), b = sorted.indexOf(to)
    if (a < 0) return one(to)
    const [lo, hi] = a < b ? [a, b] : [b, a]
    onSelection({ names: new Set(sorted.slice(lo, hi + 1).map(e => e.n)), focus: to.n })
  }
  const toggle = (e: Entry) => {
    const names = new Set(selection.names); names.has(e.n) ? names.delete(e.n) : names.add(e.n)
    setAnchor(e.n); onSelection({ names, focus: e.n })
  }

  // Plain click: folders open, files select. Shift extends, Ctrl/Cmd toggles.
  function click(e: Entry, ev: React.MouseEvent) {
    if (ev.shiftKey) { ev.preventDefault(); range(e) }
    else if (ev.metaKey || ev.ctrlKey) toggle(e)
    else if (e.d) navigate(machine, join(path, e.n))
    else one(e)
  }
  function onKey(ev: React.KeyboardEvent, cols: number) {
    const i = focusEntry ? sorted.indexOf(focusEntry) : -1
    const step: Record<string, number> = { ArrowDown: cols, ArrowUp: -cols, ArrowRight: 1, ArrowLeft: -1 }
    if (ev.key in step) {
      ev.preventDefault()
      const n = sorted[Math.max(0, Math.min(sorted.length - 1, i + step[ev.key]))]
      if (n) ev.shiftKey ? range(n) : one(n)
    } else if (ev.key === 'Enter' && focusEntry) focusEntry.d ? navigate(machine, join(path, focusEntry.n)) : onQuickLook(focusEntry)
    else if (ev.key === ' ' && focusEntry && !focusEntry.d) { ev.preventDefault(); onQuickLook(focusEntry) }
    else if (ev.key === 'Escape') onSelection({ names: new Set(), focus: null })
    else if (ev.key === 'a' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); onSelection({ names: new Set(sorted.map(e => e.n)), focus: selection.focus }) }
  }
  const drop = {
    onDragOver: (e: React.DragEvent) => { if (p.onDrop) { e.preventDefault(); setOver(true) } },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(false); p.onDrop?.(e.dataTransfer.files) },
  }

  if (error) return <Empty icon={<FolderOpen />} title="Can't open this folder" body={error} />
  if (loading && sorted.length === 0) return <Skeleton />
  if (!loading && sorted.length === 0)
    return <div className="h-full" {...drop}><Empty icon={<Upload />} title="Empty folder" body="Drop files here or use Upload in the bar above." /></div>

  const common = { sorted, selected: selection.names, focus: selection.focus, click, dbl: onQuickLook, loading, machine, path, sort, onSort }
  return (
    <div className={cx('relative h-full', over && 'after:absolute after:inset-2 after:rounded-md after:border-2 after:border-dashed after:border-accent after:bg-accent-dim after:pointer-events-none')} {...drop}>
      {view === 'grid' ? <Grid {...common} onKey={onKey} /> : <Rows {...common} onKey={onKey} />}
    </div>
  )
}

type InnerProps = {
  sorted: Entry[]; selected: Set<string>; focus: string | null; click: (e: Entry, ev: React.MouseEvent) => void; dbl: (e: Entry) => void
  loading: boolean; machine: string; path: string; sort: Sort; onSort: (s: Sort) => void; onKey: (ev: React.KeyboardEvent, cols: number) => void
}

function Head({ k, sort, onSort, children, className }: { k: Sort['key']; sort: Sort; onSort: (s: Sort) => void; children: React.ReactNode; className?: string }) {
  const on = sort.key === k
  return (
    <button onClick={() => onSort({ key: k, dir: on ? (sort.dir === 'asc' ? 'desc' : 'asc') : k === 'name' ? 'asc' : 'desc' })} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cx('press inline-flex items-center gap-1 h-6 -mx-1 px-1 rounded-sm hover:text-fg', on && 'text-fg', className)}>
      {children}{on && (sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
    </button>
  )
}

function Rows({ sorted, selected, focus, click, dbl, loading, machine, path, sort, onSort, onKey }: InnerProps) {
  const box = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: sorted.length, getScrollElement: () => box.current, estimateSize: () => 36, overscan: 16 })
  useEffect(() => { if (focus) { const i = sorted.findIndex(e => e.n === focus); if (i >= 0) v.scrollToIndex(i) } }, [focus])
  return (
    <div ref={box} tabIndex={0} role="listbox" aria-label="Files" aria-multiselectable onKeyDown={e => onKey(e, 1)} className="h-full overflow-auto focus:outline-none">
      <div className="sticky top-0 z-10 grid grid-cols-[1fr_5.5rem_7rem] max-sm:grid-cols-[1fr_5rem] gap-4 px-4 h-8 items-center text-[11px] font-medium text-muted uppercase tracking-[0.06em] bg-bg border-b border-line">
        <span className="flex items-center gap-2"><Head k="name" sort={sort} onSort={onSort}>Name</Head>{loading && <span className="normal-case tracking-normal text-accent">loading…</span>}</span>
        <span className="text-right"><Head k="size" sort={sort} onSort={onSort}>Size</Head></span>
        <span className="text-right max-sm:hidden"><Head k="mtime" sort={sort} onSort={onSort}>Modified</Head></span>
      </div>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map(row => {
          const e = sorted[row.index], sel = selected.has(e.n)
          return (
            <div key={e.n} role="option" aria-selected={sel} onClick={ev => click(e, ev)} onDoubleClick={() => !e.d && dbl(e)}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: row.size, transform: `translateY(${row.start}px)` }}
              className={cx('group grid grid-cols-[1fr_5.5rem_7rem] max-sm:grid-cols-[1fr_5rem] gap-4 px-4 items-center select-none border-b border-line/60',
                sel ? 'bg-selection shadow-[inset_2px_0_0_var(--color-accent)]' : 'hover:bg-surface', focus === e.n && !sel && 'bg-surface')}>
              <span className="flex items-center gap-3 min-w-0">
                <Icon e={e} />
                <span className={cx('truncate', e.n.startsWith('.') && 'text-muted')}>{e.n}</span>
              </span>
              <span className="text-right text-muted text-[13px] tabular-nums">{e.d ? <span className="text-faint">—</span> : bytes(e.s)}</span>
              <span className="text-right text-muted text-[13px] max-sm:hidden relative">
                <span className="group-hover:invisible">{when(e.m)}</span>
                {!e.d && <a href={fileURL(machine, join(path, e.n), true)} download onClick={ev => ev.stopPropagation()} aria-label={`Download ${e.n}`}
                  className="absolute right-0 top-1/2 -translate-y-1/2 hidden group-hover:grid place-items-center size-7 rounded-sm text-muted hover:text-fg hover:bg-surface-2"><Download className="size-4" /></a>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Grid({ sorted, selected, focus, click, dbl, machine, path, onKey }: InnerProps) {
  const box = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(4)
  useEffect(() => {
    const el = box.current!
    const ro = new ResizeObserver(([en]) => setCols(Math.max(2, Math.floor(en.contentRect.width / 168))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const rowsN = Math.ceil(sorted.length / cols)
  const v = useVirtualizer({ count: rowsN, getScrollElement: () => box.current, estimateSize: () => 184, overscan: 4 })
  useEffect(() => { if (focus) { const i = sorted.findIndex(e => e.n === focus); if (i >= 0) v.scrollToIndex(Math.floor(i / cols)) } }, [focus])
  return (
    <div ref={box} tabIndex={0} role="listbox" aria-label="Files" aria-multiselectable onKeyDown={e => onKey(e, cols)} className="h-full overflow-auto p-3 focus:outline-none">
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map(row => (
          <div key={row.index} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start}px)`, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            className="grid gap-3">
            {sorted.slice(row.index * cols, row.index * cols + cols).map(e => {
              const sel = selected.has(e.n), k = e.d ? 'dir' : kind(e.n), thumb = k === 'image' || k === 'video'
              return (
                <div key={e.n} role="option" aria-selected={sel} onClick={ev => click(e, ev)} onDoubleClick={() => !e.d && dbl(e)}
                  className={cx('press group rounded-md border p-2 select-none transition-colors', sel ? 'bg-selection ring-2 ring-accent border-transparent' : 'border-transparent hover:bg-surface hover:border-line')}>
                  <div data-kind={slot(e)} className={cx('aspect-[4/3] rounded-sm grid place-items-center overflow-hidden relative', thumb ? 'bg-surface-2' : 'bg-kind-dim')}>
                    {thumb
                      ? <img src={thumbURL(machine, join(path, e.n), e.m)} alt="" loading="lazy" decoding="async"
                          className="size-full object-cover opacity-0 transition-opacity duration-300 [&.ok]:opacity-100"
                          onLoad={ev => ev.currentTarget.classList.add('ok')} onError={ev => (ev.currentTarget.style.display = 'none')} />
                      : null}
                    <span className={cx('absolute inset-0 grid place-items-center', thumb && 'group-[&:has(img.ok)]:hidden')}>
                      {(() => { const C = icons[k]; return <C className={cx('size-8', thumb ? 'text-faint' : 'text-kind')} aria-hidden /> })()}
                    </span>
                    {k === 'video' && <Film className="absolute bottom-1.5 right-1.5 size-4 text-white drop-shadow" aria-hidden />}
                  </div>
                  <div className="mt-2 px-0.5">
                    <div className={cx('truncate text-[13px]', e.n.startsWith('.') && 'text-muted')} title={e.n}>{e.n}</div>
                    <div className="text-[12px] text-muted truncate">{e.d ? 'Folder' : bytes(e.s)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
