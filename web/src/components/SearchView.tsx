import { useEffect, useState } from 'react'
import { File, FileArchive, FileCode2, FileSearch, FileText, Film, Folder, Image as ImageIcon, Music } from 'lucide-react'
import { search, type Coverage, type Hit } from '../api'
import { bytes, hueOf, kind, kindColor, when, type Kind } from '../format'
import { join, navigate } from '../route'
import { Empty, MachineMark, Skeleton, cx } from './ui'

const icons: Record<Kind | 'dir', typeof File> = { dir: Folder, image: ImageIcon, video: Film, audio: Music, pdf: FileText, text: FileText, code: FileCode2, archive: FileArchive, other: File }

// Results of a cross-machine filename search, streamed in as agents answer.
export function SearchView({ q }: { q: string }) {
  const [hits, setHits] = useState<Hit[]>([])
  const [cov, setCov] = useState<Coverage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  useEffect(() => {
    const ac = new AbortController()
    setHits([]); setCov([]); setLoading(true); setError(undefined)
    search(q, ac.signal, (h, c) => { setHits(h); setCov(c) })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message) })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [q])
  const partial = cov.filter(c => !c.done)
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="h-10 shrink-0 flex items-center gap-3 px-4 border-b border-line text-[13px]">
        <span className="font-medium">Results for “{q}”</span>
        <span className="font-mono text-[12px] text-muted">{hits.length}{loading ? '…' : ''} {hits.length === 1 ? 'hit' : 'hits'}</span>
        {!loading && cov.length > 0 && (
          <span className="ml-auto text-[12px] text-muted truncate">
            {partial.length === 0 ? `all ${cov.length} drives fully searched` : `${partial.length} of ${cov.length} drives only partly searched (time or result cap)`}
          </span>
        )}
      </div>
      {error ? <Empty icon={<FileSearch />} title="Search failed" body={error} />
        : loading && hits.length === 0 ? <Skeleton />
        : !loading && hits.length === 0 ? <Empty icon={<FileSearch />} title="Nothing matched" body="Names are matched case-insensitively. Searches cover every drive of every machine that is running an agent." />
        : (
          <ul role="list" className="flex-1 min-h-0 overflow-auto">
            {hits.slice(0, 500).map(h => {
              const k = h.d ? 'dir' : kind(h.n), C = icons[k]
              return (
                <li key={h.machine + h.p + h.n}>
                  <button onClick={() => (h.d ? navigate(h.machine, join(h.p, h.n)) : navigate(h.machine, h.p, { select: h.n }))}
                    className="w-full text-left grid grid-cols-[auto_1fr_5.5rem_7rem] max-sm:grid-cols-[auto_1fr] gap-4 px-4 h-12 items-center border-b border-line/60 hover:bg-surface">
                    <span data-kind={h.d ? 'folder' : kindColor(kind(h.n))} className="text-kind" aria-hidden><C className="size-[18px]" /></span>
                    <span className="min-w-0">
                      <span className="block truncate">{h.n}</span>
                      <span className="flex items-center gap-1.5 text-[12px] text-muted min-w-0">
                        <MachineMark name={h.machine} hue={hueOf(h.machine)} size="sm" />
                        <span className="font-mono truncate">{h.machine}:{h.p}</span>
                      </span>
                    </span>
                    <span className="text-right text-muted text-[13px] tabular-nums max-sm:hidden">{h.d ? '—' : bytes(h.s)}</span>
                    <span className="text-right text-muted text-[13px] max-sm:hidden">{when(h.m)}</span>
                  </button>
                </li>
              )
            })}
            {hits.length > 500 && <li className={cx('px-4 h-10 flex items-center text-[12px] text-muted')}>Showing the first 500 hits. Narrow the query to see the rest.</li>}
          </ul>
        )}
    </div>
  )
}
