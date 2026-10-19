import { useEffect, useState } from 'react'
import { Download, Maximize2, Pencil, Pin, Trash2 } from 'lucide-react'
import { fileURL, mv, rm, thumbURL, zipURL, type Entry } from '../api'
import { bytes, kind, when } from '../format'
import { join } from '../route'
import { isPinned, togglePin, useLocs } from '../prefs'
import { Preview } from './Preview'
import { Button, TextInput, cx } from './ui'

type Props = { machine: string; path: string; selected: Entry[]; count: number; onChanged: () => void; onClose: () => void; onOpen: (e: Entry) => void }

// Details pane: one entry, a multi-selection summary, or the current folder.
export function Inspector(p: Props) {
  return (
    <div className="h-full overflow-auto p-4 text-[14px] flex flex-col gap-5 animate-panel">
      {p.selected.length === 1 ? <EntryView {...p} entry={p.selected[0]} />
        : p.selected.length > 1 ? <MultiView {...p} />
        : <FolderView {...p} />}
    </div>
  )
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2 text-[13px]">
      <span className="text-muted">{k}</span>
      <span className={cx('break-all', mono && 'font-mono text-[12px]')}>{v}</span>
    </div>
  )
}

function Inline({ initial, onDone, onCancel, label }: { initial: string; onDone: (v: string) => void; onCancel: () => void; label: string }) {
  const [v, setV] = useState(initial)
  return (
    <form onSubmit={e => { e.preventDefault(); if (v.trim()) onDone(v.trim()) }} className="flex gap-2 animate-pop">
      <TextInput autoFocus value={v} onChange={e => setV(e.target.value)} aria-label={label} onKeyDown={e => e.key === 'Escape' && onCancel()} onFocus={e => e.target.select()} />
      <Button type="submit" variant="solid">Save</Button>
    </form>
  )
}

const Title = ({ children, mono }: { children: string; mono?: boolean }) =>
  <h2 className={cx('font-medium break-all leading-snug', mono ? 'font-mono text-[13px] text-muted' : 'text-[15px]')}>{children}</h2>

function EntryView({ machine, path, entry, onChanged, onClose, onOpen }: Props & { entry: Entry }) {
  const full = join(path, entry.n)
  const k = kind(entry.n), popup = k === 'image' || k === 'video' || k === 'pdf'
  const [mode, setMode] = useState<'view' | 'rename' | 'confirm'>('view')
  const [err, setErr] = useState<string>()
  useEffect(() => { setMode('view'); setErr(undefined) }, [machine, full])
  const act = (f: () => Promise<unknown>, after?: () => void) => f().then(() => { onChanged(); after?.() }).catch(e => setErr(e.message))
  return (
    <>
      <Title>{entry.n}</Title>
      {!entry.d && (popup
        ? <button onClick={() => onOpen(entry)} aria-label={`Open ${entry.n} in the preview window`}
            className="press group relative rounded-md overflow-hidden bg-surface-2 border border-line hover:border-line-strong aspect-[4/3] grid place-items-center">
            {k === 'pdf'
              ? <span className="text-muted text-[13px]">PDF</span>
              : <img src={thumbURL(machine, full, entry.m)} alt="" className="size-full object-cover" onError={e => (e.currentTarget.style.display = 'none')} />}
            <span className="absolute inset-0 grid place-items-center bg-black/0 group-hover:bg-black/30 transition-colors">
              <span className="inline-flex items-center gap-2 h-9 px-3 rounded-sm bg-bg/85 border border-line-strong text-[13px] font-medium opacity-0 group-hover:opacity-100 transition-opacity"><Maximize2 className="size-4" /> Open preview</span>
            </span>
          </button>
        : <div className="rounded-md overflow-hidden bg-surface-2 border border-line grid place-items-center min-h-28"><Preview machine={machine} path={full} name={entry.n} /></div>)}
      <div className="space-y-1.5">
        {!entry.d && <Row k="Size" v={bytes(entry.s)} />}
        <Row k="Modified" v={when(entry.m)} />
        <Row k="Path" v={full} mono />
      </div>
      {mode === 'view' && (
        <div className="flex flex-wrap gap-2">
          {popup && <Button variant="solid" icon={<Maximize2 />} onClick={() => onOpen(entry)}>Open preview</Button>}
          <a href={entry.d ? zipURL(machine, full) : fileURL(machine, full, true)} download className={cx('press inline-flex items-center gap-2 h-9 px-3 rounded-sm font-medium text-[14px]', popup ? 'border border-line-strong bg-surface hover:bg-surface-2' : 'bg-accent text-accent-fg hover:bg-accent/90')}>
            <Download className="size-4" aria-hidden /> {entry.d ? 'Download zip' : 'Download'}
          </a>
          <Button icon={<Pencil />} onClick={() => setMode('rename')}>Rename</Button>
          <Button variant="danger" icon={<Trash2 />} onClick={() => setMode('confirm')}>Delete</Button>
        </div>
      )}
      {mode === 'rename' && <Inline label="New name" initial={entry.n} onCancel={() => setMode('view')} onDone={n => act(() => mv(machine, full, join(path, n)), onClose)} />}
      {mode === 'confirm' && (
        <div className="rounded-md border border-danger/30 bg-danger-dim p-3 animate-pop">
          <p className="text-[13px] mb-2">Move <span className="font-medium">{entry.n}</span> to trash?</p>
          <div className="flex gap-2">
            <Button variant="danger" size="sm" onClick={() => act(() => rm(machine, full), onClose)}>Move to trash</Button>
            <Button variant="ghost" size="sm" onClick={() => setMode('view')}>Keep</Button>
          </div>
        </div>
      )}
      {err && <p role="alert" className="text-danger text-[13px]">{err}</p>}
    </>
  )
}

function MultiView({ machine, path, selected, onChanged, onClose }: Props) {
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState<string>()
  const files = selected.filter(e => !e.d), dirs = selected.filter(e => e.d)
  const size = files.reduce((a, e) => a + e.s, 0)
  async function trashAll() {
    try { for (const e of selected) await rm(machine, join(path, e.n)); onChanged(); onClose() } catch (e) { setErr((e as Error).message) }
  }
  return (
    <>
      <Title>{`${selected.length} items selected`}</Title>
      <div className="space-y-1.5">
        {files.length > 0 && <Row k="Files" v={`${files.length}, ${bytes(size)}`} />}
        {dirs.length > 0 && <Row k="Folders" v={String(dirs.length)} />}
      </div>
      <ul className="text-[13px] text-muted space-y-0.5 max-h-48 overflow-auto">{selected.map(e => <li key={e.n} className="truncate">{e.n}</li>)}</ul>
      {!confirm
        ? <div><Button variant="danger" icon={<Trash2 />} onClick={() => setConfirm(true)}>Delete {selected.length}</Button></div>
        : <div className="rounded-md border border-danger/30 bg-danger-dim p-3 animate-pop">
            <p className="text-[13px] mb-2">Move {selected.length} items to trash?</p>
            <div className="flex gap-2"><Button variant="danger" size="sm" onClick={trashAll}>Move to trash</Button><Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Keep</Button></div>
          </div>}
      {err && <p role="alert" className="text-danger text-[13px]">{err}</p>}
    </>
  )
}

function FolderView({ machine, path, count }: Props) {
  useLocs()
  const pinned = isPinned(machine, path)
  return (
    <>
      <Title mono>{path}</Title>
      <Row k="Items" v={String(count)} />
      <div className="flex flex-wrap gap-2">
        <Button icon={<Pin />} variant={pinned ? 'solid' : 'outline'} onClick={() => togglePin(machine, path)}>{pinned ? 'Pinned' : 'Pin folder'}</Button>
        <a href={zipURL(machine, path)} download className="press inline-flex items-center gap-2 h-9 px-3 rounded-sm border border-line-strong bg-surface hover:bg-surface-2 text-[14px] font-medium"><Download className="size-4" aria-hidden /> Download zip</a>
      </div>
      <p className="text-[13px] text-muted">Select a file to preview it. Space opens Quick Look.</p>
    </>
  )
}
