import { useEffect, useRef, useState } from 'react'
import { ChevronUp, Upload } from 'lucide-react'
import { bytes } from '../format'
import { clearUploads, useUploads } from '../uploads'
import { Button, cx } from './ui'

// Bottom status strip for transfers; expands to per-file rows. Hides itself a few seconds after everything finishes.
export function Tray() {
  const ups = useUploads()
  const [open, setOpen] = useState(false)
  const sample = useRef({ t: 0, sent: 0, rate: 0 })
  const total = ups.reduce((a, u) => a + u.size, 0), sent = ups.reduce((a, u) => a + Math.min(u.sent, u.size), 0)
  const active = ups.filter(u => !u.done && !u.err), failed = ups.filter(u => u.err)
  const allDone = ups.length > 0 && active.length === 0

  useEffect(() => { // rolling transfer rate
    const now = performance.now(), s = sample.current
    if (s.t && now - s.t > 800) { s.rate = (sent - s.sent) / ((now - s.t) / 1000); s.t = now; s.sent = sent }
    else if (!s.t) { s.t = now; s.sent = sent }
  }, [sent])
  useEffect(() => {
    if (!allDone) return
    const id = setTimeout(() => { clearUploads(); setOpen(false); sample.current = { t: 0, sent: 0, rate: 0 } }, failed.length ? 15000 : 4000)
    return () => clearTimeout(id)
  }, [allDone, failed.length, ups.length])

  if (ups.length === 0) return null
  const pct = total ? (sent / total) * 100 : 100
  const rate = sample.current.rate
  const label = allDone
    ? failed.length ? `${failed.length} ${failed.length === 1 ? 'upload' : 'uploads'} failed` : `Uploaded ${ups.length} ${ups.length === 1 ? 'file' : 'files'}`
    : `Uploading ${active.length} ${active.length === 1 ? 'file' : 'files'}${rate > 0 ? `, ${bytes(rate)}/s` : ''}, ${bytes(Math.max(0, total - sent))} left`

  return (
    <section role="region" aria-label="Transfers" className="shrink-0 border-t border-line bg-surface relative animate-sheet">
      <span className={cx('absolute top-0 left-0 h-0.5 transition-[width] duration-300', failed.length ? 'bg-danger' : allDone ? 'bg-success' : 'bg-accent')} style={{ width: `${pct}%` }} aria-hidden />
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full h-9 px-3 flex items-center gap-2.5 text-[13px] hover:bg-surface-2">
        <Upload className={cx('size-4', allDone ? 'text-success' : 'text-accent')} aria-hidden />
        <span className="truncate">{label}</span>
        <span className="ml-auto font-mono text-[12px] text-muted">{Math.round(pct)}%</span>
        <ChevronUp className={cx('size-4 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="max-h-60 overflow-auto border-t border-line px-3 py-2 animate-fade">
          <ul className="space-y-2">
            {ups.map(u => (
              <li key={u.id} className="text-[13px]">
                <div className="flex justify-between gap-3 mb-1">
                  <span className="truncate">{u.name} <span className="text-faint font-mono text-[11px]">{u.machine}:{u.dir}</span></span>
                  <span className={cx('shrink-0 tabular-nums', u.err ? 'text-danger' : u.done ? 'text-success' : 'text-muted')}>{u.err ?? (u.done ? 'Done' : `${bytes(u.sent)} / ${bytes(u.size)}`)}</span>
                </div>
                <span className="block h-1 rounded-full bg-surface-3 overflow-hidden">
                  <span className={cx('block h-full rounded-full transition-[width] duration-200', u.err ? 'bg-danger' : u.done ? 'bg-success' : 'bg-accent')} style={{ width: `${u.size ? Math.min(100, (u.sent / u.size) * 100) : 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
          {allDone && <div className="mt-2 flex justify-end"><Button size="sm" variant="ghost" onClick={clearUploads}>Clear</Button></div>}
        </div>
      )}
    </section>
  )
}
