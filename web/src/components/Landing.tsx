import { useEffect, useState } from 'react'
import { Check, HardDrive, Lock, Pencil, Server, X } from 'lucide-react'
import { isLocked, label, me, setAlias, type Machine, type Mount } from '../api'
import { bytes, hueOf } from '../format'
import { navigate } from '../route'
import { Button, Empty, IconButton, Led, MachineMark, TextInput, cx } from './ui'
import { stateOf, status } from './Sidebar'

type Drive = { m: Machine; d: Mount }
const used = (d: Mount) => (d.total ? (d.total - d.free) / d.total : 0)
const toneVar = (u: number) => (u > 0.9 ? 'var(--color-drive-high)' : u > 0.7 ? 'var(--color-drive-mid)' : 'var(--color-drive-low)')

function greeting(name?: string) {
  const h = new Date().getHours()
  const g = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return name ? `${g}, ${name}.` : `${g}.`
}
function firstName(email?: string) {
  const t = (email?.split('@')[0] ?? '').split(/[._\-\d]+/).filter(Boolean)[0]
  return t ? t[0].toUpperCase() + t.slice(1) : undefined
}

export function Landing({ machines, error }: { machines: Machine[]; error?: string }) {
  const [email, setEmail] = useState<string>()
  useEffect(() => { me().then(r => setEmail(r.email)).catch(() => {}) }, [])
  if (error) return <Empty icon={<Server />} title="Can't reach the hub" body={error} action={<Button onClick={() => location.reload()}>Try again</Button>} />
  if (machines.length === 0) return <Empty icon={<Server />} title="Looking for machines" body="The hub checks the tailnet every 15 seconds." />

  const live = machines.filter(m => m.agent), rest = machines.filter(m => !m.agent)
  const drives: Drive[] = live.flatMap(m => m.mounts.map(d => ({ m, d })))
  const total = drives.reduce((a, x) => a + x.d.total, 0), free = drives.reduce((a, x) => a + x.d.free, 0)

  return (
    <div className="hero-glow min-h-full">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 pt-10 sm:pt-16 pb-16 animate-rise">
        <div className="font-mono text-[11px] tracking-[0.14em] uppercase text-faint flex flex-wrap gap-x-3 gap-y-1 mb-4">
          <span className="text-muted">Fleet</span>
          <span aria-hidden>/</span><span>{live.length} of {machines.length} units serving</span>
          <span aria-hidden>/</span><span>{drives.length} {drives.length === 1 ? 'drive' : 'drives'}</span>
        </div>
        <h1 className="text-[34px] sm:text-[48px] font-semibold tracking-[-0.025em] leading-[1.05]">{greeting(firstName(email))}</h1>
        <p className="text-muted mt-3 text-[15px] sm:text-[17px] max-w-2xl">
          {live.length === 0
            ? 'None of your machines is running an agent yet.'
            : <>{live.length} of {machines.length} machines online, {drives.length} {drives.length === 1 ? 'drive' : 'drives'}, <span className="text-fg">{bytes(free)} free</span> of {bytes(total)}.</>}
        </p>

        {drives.length > 0 && <FleetBar drives={drives} />}

        <section className="mt-14" aria-labelledby="rack">
          <div className="flex items-baseline justify-between mb-4">
            <h2 id="rack" className="text-[18px] font-medium">Rack</h2>
            <span className="text-muted text-[13px]">{live.length} {live.length === 1 ? 'unit' : 'units'} serving, {rest.length} empty</span>
          </div>
          <div className="rack3d"><div className="rack">
            {live.map(m => <Unit key={m.name} m={m} />)}
            {live.length === 0 && (
              <div className="unit p-6">
                <Empty icon={<HardDrive />} title="No agents answered" body="Install rfs-agent on a machine and it appears here within 15 seconds." />
              </div>
            )}
            {rest.length > 0 && (
              <ul className="grid sm:grid-cols-2 gap-1.5 mt-1.5">
                {rest.map(m => (
                  <li key={m.name} className="slot flex items-center gap-2.5 px-3 h-11 text-[13px]">
                    <MachineMark name={label(m)} hue={hueOf(m.name)} size="sm" />
                    <span className="truncate text-fg/80">{label(m)}</span>
                    <Led state={stateOf(m)} />
                    <span className="text-muted truncate">{m.os}, {status(m)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div></div>
        </section>
      </div>
    </div>
  )
}

// One bar for the whole fleet: a segment per drive, width by capacity, fill by use, colour by machine.
function FleetBar({ drives }: { drives: Drive[] }) {
  const total = drives.reduce((a, x) => a + x.d.total, 0) || 1
  return (
    <div className="mt-9">
      <div className="flex gap-1 h-8 sm:h-10" role="list" aria-label="Capacity by drive">
        {drives.map(({ m, d }) => (
          <button key={m.name + d.path} role="listitem" onClick={() => navigate(m.name, d.path)} data-hue={hueOf(m.name)}
            title={`${m.name}: ${d.path}, ${bytes(d.total - d.free)} used of ${bytes(d.total)}`}
            style={{ flexBasis: `${(d.total / total) * 100}%` }}
            className="press tube group relative min-w-6 grow-0 shrink rounded-sm overflow-hidden bg-hue-dim hover:brightness-110 focus-visible:outline-offset-4">
            <span className="tube-fill absolute inset-y-0 left-0 transition-[width] duration-700" style={{ width: `${used(d) * 100}%` }} />
          </button>
        ))}
      </div>
      <div className="flex gap-1 mt-2.5 text-[12px] leading-tight">
        {drives.map(({ m, d }) => (
          <div key={m.name + d.path} style={{ flexBasis: `${(d.total / total) * 100}%` }} className="min-w-6 grow-0 shrink overflow-hidden">
            <div className="truncate"><span className="text-fg/90">{d.label}</span></div>
            <div className="truncate text-muted">{bytes(d.total - d.free)} of {bytes(d.total)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// A rack unit: the machine on the left, its drive bays on the right. The name is renamable on the site.
function Unit({ m }: { m: Machine }) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState('')
  const [err, setErr] = useState<string>()
  const save = () => setAlias(m.name, v.trim()).then(() => { setEdit(false); setErr(undefined) }).catch(e => setErr(e.message))
  return (
    <div data-hue={hueOf(m.name)} data-machine={m.name} className="unit grid sm:grid-cols-[17rem_1fr] min-w-0">
      <div className="flex items-center gap-3 px-4 py-4 sm:border-r border-line/70 group/unit">
        <MachineMark name={label(m)} hue={hueOf(m.name)} size="lg" />
        <div className="min-w-0 flex-1">
          {edit ? (
            <form onSubmit={e => { e.preventDefault(); save() }} className="flex items-center gap-1 animate-pop">
              <TextInput autoFocus value={v} onChange={e => setV(e.target.value)} aria-label="Display name" placeholder={m.name} maxLength={40} className="h-8 text-[14px]"
                onKeyDown={e => e.key === 'Escape' && setEdit(false)} />
              <IconButton label="Save name" type="submit" className="size-8 text-accent"><Check /></IconButton>
              <IconButton label="Cancel" type="button" onClick={() => setEdit(false)} className="size-8"><X /></IconButton>
            </form>
          ) : (
            <div className="flex items-center gap-1 min-w-0">
              <span className="font-medium text-[16px] leading-tight truncate" title={m.alias ? `${m.alias} (${m.name})` : m.name}>{label(m)}</span>
              <IconButton label={`Rename ${label(m)}`} onClick={() => { setV(m.alias ?? ''); setEdit(true) }} className="size-7 opacity-0 group-hover/unit:opacity-100 focus-visible:opacity-100 transition-opacity"><Pencil className="!size-3.5" /></IconButton>
            </div>
          )}
          {err && <div role="alert" className="text-danger text-[12px]">{err}</div>}
          <div className="text-muted text-[13px] mt-0.5 flex items-center gap-2"><span className="led-bezel"><Led state="agent" /></span> {m.os}, {m.mounts.length} {m.mounts.length === 1 ? 'drive' : 'drives'}{isLocked(m) && <span className="inline-flex items-center gap-1"><Lock className="size-3.5" aria-hidden /> locked</span>}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 p-3 sm:justify-end items-center min-w-0">
        {m.mounts.map(d => <Bay key={d.path} d={d} onClick={() => navigate(m.name, d.path)} />)}
      </div>
    </div>
  )
}

function Bay({ d, onClick }: { d: Mount; onClick: () => void }) {
  const u = used(d), cells = Math.max(u > 0 ? 1 : 0, Math.round(u * 14))
  return (
    <button onClick={onClick} title={d.path}
      className="bay press text-left pl-3 pr-6 py-2.5 w-full sm:w-[12.5rem] min-w-0 max-w-full" style={{ '--lit': toneVar(u) } as React.CSSProperties}>
      <div className="flex justify-between gap-3 text-[13px]">
        <span className="truncate font-medium min-w-0">{d.label}</span>
        <span className="text-muted shrink-0">{bytes(d.free)} free</span>
      </div>
      <div className="flex gap-[3px] mt-2" aria-hidden>
        {Array.from({ length: 14 }, (_, i) => <span key={i} className={cx('cell', i < cells && 'lit')} />)}
      </div>
    </button>
  )
}
