import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Eye, EyeOff, HardDrive, LayoutGrid, List, PanelLeft, PanelRight, Pencil, Pin } from 'lucide-react'
import { Mark } from './Mark'
import type { Machine } from '../api'
import { crumbs, navigate } from '../route'
import { useBusy } from '../transfers'
import { Button, IconButton, Led, MachineMark, Menu, MenuItem, TextInput, cx } from './ui'
import { bytes, hueOf } from '../format'
import { isPinned, togglePin, useLocs, useMedia } from '../prefs'

export type View = 'list' | 'grid'

type Props = {
  machines: Machine[]; machine: string | null; path: string
  view: View; onView: (v: View) => void
  hidden: boolean; onHidden: (v: boolean) => void
  sidebar: boolean; onSidebar: () => void
  details: boolean; onDetails: () => void
}

export function TopBar({ machines, machine, path, view, onView, hidden, onHidden, sidebar, onSidebar, details, onDetails }: Props) {
  const cur = machines.find(m => m.name === machine)
  const wide = useMedia('(min-width: 40rem)')
  const mount = cur?.mounts.find(d => path === d.path || path.startsWith(d.path.endsWith('/') ? d.path : d.path + '/'))
  return (
    <header className="shrink-0 border-b border-line bg-bg sticky top-0 z-30">
      <div className="h-14 flex items-center gap-1.5 px-2 sm:px-3">
        <IconButton label={sidebar ? 'Hide sidebar' : 'Show sidebar'} active={false} onClick={onSidebar} aria-expanded={sidebar}><PanelLeft /></IconButton>
        <a href="/" onClick={e => { e.preventDefault(); navigate(null) }} aria-label="Home"
          className="press hidden sm:flex items-center gap-2 h-9 pl-1 pr-2 rounded-sm hover:bg-surface-2">
          <Mark size={26} />
          <span className="hidden xl:inline font-semibold tracking-tight text-[15px]">files</span>
        </a>
        <DriveSwitch machines={machines} current={cur} />
        {wide && cur && <Crumbs machine={cur} path={path} mount={mount?.path} />}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label={hidden ? 'Hide hidden files' : 'Show hidden files'} active={hidden} onClick={() => onHidden(!hidden)} className="hidden sm:grid">
            {hidden ? <Eye /> : <EyeOff />}
          </IconButton>
          <div className="flex rounded-sm bg-surface p-0.5 border border-line">
            <IconButton label="List view" active={view === 'list'} onClick={() => onView('list')} className="size-8"><List /></IconButton>
            <IconButton label="Grid view" active={view === 'grid'} onClick={() => onView('grid')} className="size-8"><LayoutGrid /></IconButton>
          </div>
          {cur && <IconButton label={details ? 'Hide details' : 'Show details'} active={details} onClick={onDetails} className="hidden lg:grid"><PanelRight /></IconButton>}
        </div>
      </div>
      {!wide && cur && <div className="h-10 flex items-center px-2 border-t border-line/60"><Crumbs machine={cur} path={path} mount={mount?.path} /></div>}
    </header>
  )
}

// Drives grouped by machine. The machine header opens that machine's first drive.
function DriveSwitch({ machines, current }: { machines: Machine[]; current?: Machine }) {
  const busy = useBusy(current?.name ?? '')
  const live = machines.filter(m => m.agent)
  return (
    <Menu trigger={open => (
      <Button variant="ghost" className={cx('px-2 max-w-44 sm:max-w-56', open && 'bg-surface-2 text-fg')} aria-haspopup="menu" aria-expanded={open}>
        {current ? <MachineMark name={current.name} hue={hueOf(current.name)} size="sm" /> : <HardDrive className="size-4 text-muted" />}
        <span className="truncate font-medium text-fg">{current?.name ?? 'Open a drive'}</span>
        {current && <Led state={current.agent ? 'agent' : current.online ? 'online' : 'offline'} busy={busy} />}
        <ChevronDown className={cx('size-4 text-muted transition-transform', open && 'rotate-180')} />
      </Button>
    )}>
      {close => live.length === 0
        ? <p className="px-3 py-2 text-[13px] text-muted">No machine is running an agent.</p>
        : live.map(m => (
          <div key={m.name} className="py-1">
            <MenuItem onClick={() => { close(); if (m.mounts[0]) navigate(m.name, m.mounts[0].path) }} className="h-8">
              <MachineMark name={m.name} hue={hueOf(m.name)} size="sm" />
              <span className="font-medium">{m.name}</span>
              <span className="ml-auto text-[11px] font-mono text-faint">{m.mounts.length} {m.mounts.length === 1 ? 'drive' : 'drives'}</span>
            </MenuItem>
            {m.mounts.map(d => (
              <MenuItem key={d.path} active={current?.name === m.name && false} onClick={() => { close(); navigate(m.name, d.path) }} className="pl-8">
                <HardDrive className="size-4 text-muted shrink-0" />
                <span className="truncate">{d.label}</span>
                <span className="ml-auto text-[11px] font-mono text-muted shrink-0">{bytes(d.free)} free</span>
              </MenuItem>
            ))}
          </div>
        ))}
    </Menu>
  )
}

// Breadcrumb chips that scroll horizontally; the pencil turns the whole thing into
// an editable machine:/path line; the pin bookmarks the current folder.
function Crumbs({ machine, path, mount }: { machine: Machine; path: string; mount?: string }) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const list = crumbs(path, mount)
  useLocs() // re-render when pins change
  const pinned = isPinned(machine.name, path)
  useEffect(() => { scroller.current?.scrollTo({ left: 1e6, behavior: 'smooth' }) }, [path])

  if (edit) {
    const commit = () => {
      const m = /^(?:([^:]+):)?(.*)$/.exec(v.trim())
      setEdit(false)
      if (!m) return
      const p = m[2] || '/'
      navigate(m[1] || machine.name, p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p)
    }
    return (
      <form className="flex-1 min-w-0 animate-fade" onSubmit={e => { e.preventDefault(); commit() }}>
        <TextInput autoFocus aria-label="Location" value={v} onChange={e => setV(e.target.value)} onBlur={() => setEdit(false)}
          onKeyDown={e => e.key === 'Escape' && setEdit(false)} className="font-mono text-[14px]" />
      </form>
    )
  }
  return (
    <div className="flex items-center min-w-0 flex-1 gap-0.5">
      <div ref={scroller} className="flex items-center min-w-0 overflow-x-auto scroll-fade [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {list.map((c, i) => {
          const last = i === list.length - 1
          return (
            <span key={c.path} className="flex items-center shrink-0">
              {i > 0 && <ChevronRight className="size-3.5 text-faint mx-0.5" aria-hidden />}
              <button onClick={() => !last && navigate(machine.name, c.path)} aria-current={last ? 'page' : undefined}
                className={cx('press h-8 px-2 rounded-sm text-[14px] max-w-48 truncate', last ? 'text-fg font-medium' : 'text-muted hover:text-fg hover:bg-surface-2')}>
                {c.label}
              </button>
            </span>
          )
        })}
      </div>
      <IconButton label="Edit location" onClick={() => { setV(`${machine.name}:${path}`); setEdit(true) }} className="size-8 shrink-0"><Pencil className="!size-3.5" /></IconButton>
      <IconButton label={pinned ? 'Unpin folder' : 'Pin folder'} active={pinned} onClick={() => togglePin(machine.name, path)} className="size-8 shrink-0"><Pin className="!size-3.5" /></IconButton>
    </div>
  )
}
