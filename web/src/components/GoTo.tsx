import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock, FileSearch, HardDrive, Pin, Search, Terminal } from 'lucide-react'
import type { Machine } from '../api'
import { hueOf } from '../format'
import { navigate, navigateSearch, tail } from '../route'
import { useLocs } from '../prefs'
import { MachineMark, cx } from './ui'

type Item = { key: string; icon: 'drive' | 'pin' | 'recent' | 'literal' | 'search'; label: string; sub: string; machine: string; path: string }

// Client-side jump box: machines, drives, pinned and recent folders, or a literal machine:/path.
// Focus it from anywhere with Ctrl/Cmd-K or '/'.
export function GoTo({ machines, onPick, autoFocus }: { machines: Machine[]; onPick?: () => void; autoFocus?: boolean }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const { recent, pinned } = useLocs()
  const live = machines.filter(m => m.agent)

  useEffect(() => {
    const f = () => { input.current?.focus(); input.current?.select() }
    addEventListener('rfs:goto', f)
    return () => removeEventListener('rfs:goto', f)
  }, [])

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase()
    const all: Item[] = [
      ...pinned.map(p => ({ key: 'p' + p.machine + p.path, icon: 'pin' as const, label: tail(p.path), sub: `${p.machine}:${p.path}`, machine: p.machine, path: p.path })),
      ...recent.map(r => ({ key: 'r' + r.machine + r.path, icon: 'recent' as const, label: tail(r.path), sub: `${r.machine}:${r.path}`, machine: r.machine, path: r.path })),
      ...live.flatMap(m => m.mounts.map(d => ({ key: 'd' + m.name + d.path, icon: 'drive' as const, label: d.label, sub: `${m.name}:${d.path}`, machine: m.name, path: d.path }))),
    ]
    const seen = new Set<string>()
    const uniq = all.filter(i => { const k = i.machine + i.path; if (seen.has(k)) return false; seen.add(k); return true })
    const hits = needle ? uniq.filter(i => (i.label + ' ' + i.sub).toLowerCase().includes(needle)) : uniq
    const lit = /^([^:]+):(.+)$/.exec(q.trim())
    if (lit) {
      const m = live.find(x => x.name === lit[1].toLowerCase()) ?? live.find(x => x.name.startsWith(lit[1].toLowerCase()))
      if (m) hits.unshift({ key: 'lit', icon: 'literal', label: lit[2], sub: `open on ${m.name}`, machine: m.name, path: lit[2] })
    }
    const out = hits.slice(0, 7)
    if (needle.length >= 2 && !lit) out.push({ key: 'search', icon: 'search', label: `Search files for “${q.trim()}”`, sub: 'every drive, every machine', machine: '', path: q.trim() })
    return out
  }, [q, recent, pinned, live])

  useEffect(() => setIdx(0), [q])

  function go(i: Item) {
    setQ(''); setOpen(false); input.current?.blur(); onPick?.()
    if (i.icon === 'search') return navigateSearch(i.path)
    const p = i.path.length > 1 && /[\\/]$/.test(i.path) ? i.path.slice(0, -1) : i.path
    navigate(i.machine, p)
  }
  const Ico = ({ k }: { k: Item['icon'] }) => k === 'pin' ? <Pin className="size-3.5" /> : k === 'recent' ? <Clock className="size-3.5" /> : k === 'literal' ? <Terminal className="size-3.5" /> : k === 'search' ? <FileSearch className="size-3.5" /> : <HardDrive className="size-3.5" />

  return (
    <div className="relative">
      <div className={cx('flex items-center gap-2 h-9 px-2.5 rounded-sm bg-surface-2 border transition-colors', open ? 'border-accent/60' : 'border-line')}>
        <Search className="size-4 text-muted shrink-0" aria-hidden />
        <input ref={input} value={q} autoFocus={autoFocus} aria-label="Go to" placeholder="Go to…" spellCheck={false} autoComplete="off"
          onChange={e => setQ(e.target.value)} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(items.length - 1, i + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)) }
            else if (e.key === 'Enter' && items[idx]) go(items[idx])
            else if (e.key === 'Escape') { setQ(''); setOpen(false); input.current?.blur() }
          }}
          className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-faint text-[14px]" />
        <kbd className="hidden lg:inline text-[11px] text-faint font-mono border border-line rounded px-1 leading-5">⌘K</kbd>
      </div>
      {open && items.length > 0 && (
        <ul role="listbox" aria-label="Locations" className="absolute left-0 right-0 top-full mt-1.5 z-40 rounded-md bg-surface-3 shadow-pop p-1 animate-pop">
          {items.map((i, n) => (
            <li key={i.key} role="option" aria-selected={n === idx} onMouseDown={e => { e.preventDefault(); go(i) }} onMouseEnter={() => setIdx(n)}
              className={cx('flex items-center gap-2.5 h-9 px-2 rounded-sm cursor-default text-[13px]', n === idx ? 'bg-accent-dim' : '')}>
              <span className="text-muted"><Ico k={i.icon} /></span>
              {i.machine && <MachineMark name={i.machine} hue={hueOf(i.machine)} size="sm" />}
              <span className="truncate">{i.label}</span>
              <span className="ml-auto truncate text-faint font-mono text-[11px] max-w-[55%]">{i.sub}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
