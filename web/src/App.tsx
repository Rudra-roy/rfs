import { useCallback, useEffect, useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import { isLocked, machines as fetchMachines, upload, type Entry, type Machine } from './api'
import { join, useRoute } from './route'
import { useMedia, usePref } from './prefs'
import { TopBar, type View } from './components/TopBar'
import { Nav } from './components/Sidebar'
import { Landing } from './components/Landing'
import { SearchView } from './components/SearchView'
import { Settings } from './components/Settings'
import { Unlock } from './components/Unlock'
import { OtpGate } from './components/Otp'
import { Listing, Toolbar, sortEntries, useListing, type Selection, type Sort } from './components/Listing'
import { Inspector } from './components/Inspector'
import { QuickLook } from './components/QuickLook'
import { Tray } from './components/Tray'
import { Overlay } from './components/ui'
import { addUpload, patchUpload } from './uploads'

function useMachines() {
  const [list, setList] = useState<Machine[]>([])
  const [error, setError] = useState<string>()
  useEffect(() => {
    let live = true
    const tick = () => fetchMachines().then(m => { if (live) { setList(m); setError(undefined) } }).catch(e => live && setError(e.message))
    tick()
    const id = setInterval(tick, 15000)
    addEventListener('rfs:machines', tick)
    return () => { live = false; clearInterval(id); removeEventListener('rfs:machines', tick) }
  }, [])
  return { list, error }
}

const inField = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

export default function App() {
  const route = useRoute()
  const { list, error } = useMachines()
  const wide = useMedia('(min-width: 64rem)')
  const [view, setView] = usePref<View>('view', 'list')
  const [hidden, setHidden] = usePref<boolean>('hidden', false)
  const [sidebar, setSidebar] = usePref<boolean>('sidebar', true)
  const [details, setDetails] = usePref<boolean>('details', true)
  const [drawer, setDrawer] = useState(false)
  const [otpGate, setOtpGate] = useState(false)
  useEffect(() => { const f = () => setOtpGate(true); addEventListener('rfs:otp', f); return () => removeEventListener('rfs:otp', f) }, [])
  const cur = route.machine ? list.find(m => m.name === route.machine) : undefined
  useEffect(() => { setDrawer(false) }, [route.machine, route.path])

  // Global keys: Ctrl/Cmd-K or '/' focuses Go to; 'i' toggles details; '1'/'2' switch views.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !inField(e.target))) {
        e.preventDefault()
        if (wide) dispatchEvent(new Event('rfs:goto'))
        else { setDrawer(true); setTimeout(() => dispatchEvent(new Event('rfs:goto')), 30) } // the drawer has to mount first
      } else if (!inField(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === 'i') setDetails(!details)
        else if (e.key === '1') setView('list')
        else if (e.key === '2') setView('grid')
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [wide, details, setDetails, setView])

  const toggleSidebar = () => (wide ? setSidebar(!sidebar) : setDrawer(true))

  return (
    <div className="h-dvh flex flex-col">
      <TopBar machines={list} machine={route.machine} path={route.path} view={view} onView={setView} hidden={hidden} onHidden={setHidden}
        sidebar={wide ? sidebar : drawer} onSidebar={toggleSidebar} details={details} onDetails={() => setDetails(!details)} settings={'settings' in route && !!route.settings} />
      <div className="flex-1 min-h-0 flex">
        {wide && sidebar && (
          <aside className="w-64 shrink-0 border-r border-line overflow-auto bg-surface animate-drawer">
            <Nav machines={list} machine={route.machine} path={route.path} />
          </aside>
        )}
        <main className="vt-main flex-1 min-w-0 min-h-0 flex">
          {route.machine
            ? isLocked(cur)
              ? <Unlock key={'lock:' + cur!.name} machine={cur!} />
              : <Browser key={route.machine + route.path} machine={route.machine} path={route.path} preselect={route.select} hidden={hidden} view={view} offline={cur ? !cur.agent : false} wide={wide} details={details} onDetails={setDetails} />
            : 'q' in route && route.q !== undefined
              ? <SearchView key={route.q} q={route.q} machines={list} />
              : 'settings' in route && route.settings
                ? <Settings machines={list} />
                : <div className="flex-1 overflow-auto"><Landing machines={list} error={error} /></div>}
        </main>
      </div>
      <Tray />
      {otpGate && <OtpGate onDone={() => location.reload()} />}
      {!wide && (
        <Overlay open={drawer} onClose={() => setDrawer(false)} side="left" label="Machines">
          <Nav machines={list} machine={route.machine} path={route.path} onPick={() => setDrawer(false)} />
        </Overlay>
      )}
    </div>
  )
}

type BrowserProps = { machine: string; path: string; preselect?: string; hidden: boolean; view: View; offline: boolean; wide: boolean; details: boolean; onDetails: (v: boolean) => void }

function Browser({ machine, path, preselect, hidden, view, offline, wide, details, onDetails }: BrowserProps) {
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce(n => n + 1), [])
  const { rows, loading, error } = useListing(machine, path, nonce)
  const [sort, setSort] = usePref<Sort>('sort', { key: 'name', dir: 'asc' })
  const sorted = useMemo(() => sortEntries(rows, hidden, sort), [rows, hidden, sort])
  const [selection, setSelection] = useState<Selection>(() => ({ names: new Set(preselect ? [preselect] : []), focus: preselect ?? null }))
  const selected = useMemo(() => sorted.filter(e => selection.names.has(e.n)), [sorted, selection])
  const [sheet, setSheet] = useState(false)
  const [ql, setQl] = useState<number | null>(null)
  const files = useMemo(() => sorted.filter(e => !e.d), [sorted])

  const select = (s: Selection) => { setSelection(s); if (s.names.size > 0) { setSheet(true); onDetails(true) } }
  const clear = () => { setSelection({ names: new Set(), focus: null }); setSheet(false) }
  const quickLook = (e: Entry) => { const i = files.indexOf(e); if (i >= 0) setQl(i) }

  async function send(list: FileList | null) {
    if (!list?.length) return
    for (const f of Array.from(list)) {
      const u = addUpload(f.name, machine, path, f.size)
      try {
        await upload(machine, join(path, f.name), f, n => patchUpload(u.id, { sent: n }))
        patchUpload(u.id, { sent: f.size, done: true })
      } catch (e) {
        patchUpload(u.id, { err: (e as Error).message, done: true })
      }
      refresh()
    }
  }

  const err = offline ? `${machine} is not answering. It may be offline or the agent stopped.` : error
  const panel = <Inspector machine={machine} path={path} selected={selected} count={sorted.length} onChanged={refresh} onClose={clear} onOpen={quickLook} />
  const showPane = wide && details
  return (
    <>
      <section className="flex-1 min-w-0 min-h-0 flex flex-col relative">
        <Toolbar machine={machine} path={path} sorted={sorted} sort={sort} onSort={setSort} selected={selected} onUpload={send} onChanged={refresh} onClear={clear} />
        <div className="flex-1 min-h-0">
          <Listing machine={machine} path={path} sorted={sorted} loading={loading} error={err} selection={selection} onSelection={select} onQuickLook={quickLook}
            view={view} sort={sort} onSort={setSort} onDrop={send} />
        </div>
        {!wide && !sheet && (
          <button onClick={() => setSheet(true)} aria-label="Folder details"
            className="press fixed bottom-5 right-5 z-20 size-12 rounded-full bg-accent text-accent-fg grid place-items-center shadow-pop">
            <Info className="size-5" />
          </button>
        )}
      </section>
      {showPane
        ? <aside className="w-[22rem] shrink-0 border-l border-line bg-surface animate-panel">{panel}</aside>
        : !wide && <Overlay open={sheet} onClose={clear} side="bottom" label={selected.length ? 'File' : 'Folder'}>{panel}</Overlay>}
      {ql !== null && files[ql] && <QuickLook machine={machine} dir={path} files={files} index={ql} onIndex={i => { setQl(i); setSelection({ names: new Set([files[i].n]), focus: files[i].n }) }} onClose={() => setQl(null)} />}
    </>
  )
}
