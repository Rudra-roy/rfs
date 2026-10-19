import { ChevronRight, Clock, Laptop, Lock, Monitor, Pin, Server, Smartphone } from 'lucide-react'
import { isLocked, label, type Machine, type Mount } from '../api'
import { ago, bytes, hueOf } from '../format'
import { navigate, tail } from '../route'
import { useLocs } from '../prefs'
import { useBusy } from '../transfers'
import { GoTo } from './GoTo'
import { Led, MachineMark, cx } from './ui'

export const stateOf = (m: Machine) => m.agent ? 'agent' : m.online ? 'online' : 'offline'
export const usedOf = (d: Mount) => (d.total ? (d.total - d.free) / d.total : 0)
export const toneOf = (u: number) => (u > 0.9 ? 'bg-drive-high' : u > 0.7 ? 'bg-drive-mid' : 'bg-drive-low')

function OsIcon({ os }: { os: string }) {
  const C = os === 'windows' ? Monitor : os === 'android' || os === 'iOS' ? Smartphone : os === 'macOS' ? Laptop : Server
  return <C className="size-3.5" aria-hidden />
}

export function status(m: Machine): string {
  if (m.agent) return `serving ${m.mounts.length} ${m.mounts.length === 1 ? 'drive' : 'drives'}`
  if (m.online) return 'online, no agent'
  return m.lastSeen && !m.lastSeen.startsWith('0001') ? `offline, seen ${ago(m.lastSeen)}` : 'offline'
}

export function DriveBar({ m, tall }: { m: Mount; tall?: boolean }) {
  const u = usedOf(m)
  return (
    <span className={cx('block w-full rounded-full bg-surface-3 overflow-hidden', tall ? 'h-1.5' : 'h-[3px]')}>
      <span className={cx('block h-full rounded-full transition-[width] duration-700', toneOf(u))} style={{ width: `${Math.round(u * 100)}%` }} />
    </span>
  )
}

function Eyebrow({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between h-7 px-2 mt-3 mb-0.5">
      <span className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint">{children}</span>
      {right}
    </div>
  )
}

function LocRow({ machine, path, icon, time, current, onPick }: { machine: string; path: string; icon: React.ReactNode; time?: string; current: boolean; onPick?: () => void }) {
  return (
    <button onClick={() => { onPick?.(); navigate(machine, path) }} title={`${machine}:${path}`} aria-current={current ? 'location' : undefined}
      className={cx('press w-full flex items-center gap-2 h-8 px-2 rounded-sm text-[13px] text-left', current ? 'bg-accent-dim' : 'hover:bg-surface-2')}>
      <span className="text-faint shrink-0">{icon}</span>
      <MachineMark name={machine} hue={hueOf(machine)} size="sm" />
      <span className="truncate">{tail(path)}</span>
      {time && <span className="ml-auto text-[11px] text-faint font-mono shrink-0">{time}</span>}
    </button>
  )
}

// Machines and drives, with jump box, pinned and recent above the tree.
// Lives in the desktop rail and in the mobile drawer.
export function Nav({ machines, machine, path, onPick }: { machines: Machine[]; machine: string | null; path: string; onPick?: () => void }) {
  const live = machines.filter(m => m.agent), rest = machines.filter(m => !m.agent)
  const { recent, pinned } = useLocs()
  const roots = new Set(live.flatMap(m => m.mounts.map(d => m.name + d.path)))
  const isCur = (m: string, p: string) => m === machine && p === path
  const recents = recent.filter(r => !roots.has(r.machine + r.path) && !pinned.some(p => p.machine === r.machine && p.path === r.path)).slice(0, 5)
  return (
    <nav aria-label="Machines" className="p-2 pb-6 text-[14px]">
      <GoTo machines={machines} onPick={onPick} />

      {pinned.length > 0 && <>
        <Eyebrow>Pinned</Eyebrow>
        {pinned.map(p => <LocRow key={p.machine + p.path} machine={p.machine} path={p.path} icon={<Pin className="size-3.5" />} current={isCur(p.machine, p.path)} onPick={onPick} />)}
      </>}
      {recents.length > 0 && <>
        <Eyebrow>Recent</Eyebrow>
        {recents.map(r => <LocRow key={r.machine + r.path} machine={r.machine} path={r.path} icon={<Clock className="size-3.5" />} time={ago(new Date(r.t).toISOString())} current={isCur(r.machine, r.path)} onPick={onPick} />)}
      </>}

      <Eyebrow right={<span className="text-[11px] font-mono text-faint">{live.length}/{machines.length}</span>}>Machines</Eyebrow>
      {live.map(m => <MachineGroup key={m.name} m={m} current={m.name === machine} path={path} onPick={onPick} />)}
      {live.length === 0 && <p className="px-2 py-3 text-[13px] text-muted">No machine is running an agent.</p>}

      {rest.length > 0 && (
        <details className="mt-3 group">
          <summary className="list-none cursor-pointer h-8 px-2 rounded-sm flex items-center gap-1.5 text-[12px] text-muted hover:bg-surface-2 select-none">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
            Without agent <span className="font-mono text-faint">{rest.length}</span>
          </summary>
          <ul className="mt-1">
            {rest.map(m => (
              <li key={m.name} className="flex items-center gap-2 h-8 px-2 text-[13px] text-fg/70">
                <MachineMark name={label(m)} hue={hueOf(m.name)} size="sm" />
                <span className="truncate">{label(m)}</span>
                <Led state={stateOf(m)} />
                <span className="ml-auto text-faint"><OsIcon os={m.os} /></span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </nav>
  )
}

function MachineGroup({ m, current, path, onPick }: { m: Machine; current: boolean; path: string; onPick?: () => void }) {
  const busy = useBusy(m.name)
  return (
    <section className="mb-1.5 rounded-md" data-hue={hueOf(m.name)} data-machine={m.name}>
      <div className={cx('flex items-center gap-2 px-2 h-9 rounded-sm', current && 'bg-surface-2')}>
        <MachineMark name={label(m)} hue={hueOf(m.name)} size="sm" />
        <span className={cx('truncate text-[14px]', current ? 'font-medium' : 'text-fg/90')} title={m.alias ? `${m.alias} (${m.name})` : m.name}>{label(m)}</span>
        <span className="led-bezel scale-90 ml-0.5"><Led state="agent" busy={busy} /></span>
        {isLocked(m) && <Lock className="size-3.5 text-muted" aria-label="locked" />}
        <span className="ml-auto text-faint"><OsIcon os={m.os} /></span>
      </div>
      <ul className="mt-0.5">
        {m.mounts.map(d => {
          const on = current && (path === d.path || path.startsWith(d.path.endsWith('/') ? d.path : d.path + '/'))
          const u = usedOf(d)
          return (
            <li key={d.path}>
              <button onClick={() => { onPick?.(); navigate(m.name, d.path) }} title={d.path} aria-current={on ? 'location' : undefined}
                className={cx('press w-full text-left rounded-sm pl-7 pr-2 py-1.5 relative', on ? 'bg-accent-dim' : 'hover:bg-surface-2')}>
                {on && <span className="absolute left-2.5 top-2 bottom-2 w-0.5 rounded-full bg-accent" aria-hidden />}
                <span className="flex items-baseline justify-between gap-2 text-[13px] mb-1">
                  <span className={cx('truncate', on ? 'text-fg' : 'text-fg/85')}>{d.label}</span>
                  <span className="font-mono text-[11px] text-muted shrink-0">{Math.round(u * 100)}% <span className="text-faint">·</span> {bytes(d.free)}</span>
                </span>
                <DriveBar m={d} />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
