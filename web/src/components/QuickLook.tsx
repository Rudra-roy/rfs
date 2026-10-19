import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react'
import { fileURL, type Entry } from '../api'
import { bytes, when } from '../format'
import { join } from '../route'
import { Preview } from './Preview'
import { IconButton } from './ui'

// Space on a file opens this. Left/Right step through the folder's files, Esc closes.
export function QuickLook({ machine, dir, files, index, onIndex, onClose }: { machine: string; dir: string; files: Entry[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const e = files[index]
  const latest = useRef({ index, files, onIndex, onClose })
  latest.current = { index, files, onIndex, onClose }
  useEffect(() => { // attach once; read the latest props through the ref so re-renders never drop keys
    const prev = document.activeElement as HTMLElement | null
    box.current?.focus()
    const onKey = (ev: KeyboardEvent) => {
      const { index, files, onIndex, onClose } = latest.current
      if (ev.key === 'Escape' || ev.key === ' ') { ev.preventDefault(); onClose() }
      else if (ev.key === 'ArrowRight') onIndex(Math.min(files.length - 1, index + 1))
      else if (ev.key === 'ArrowLeft') onIndex(Math.max(0, index - 1))
    }
    const id = setTimeout(() => document.addEventListener('keydown', onKey), 0) // skip the keypress that opened us
    document.body.style.overflow = 'hidden'
    return () => { clearTimeout(id); document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus() }
  }, [])
  if (!e) return null
  const full = join(dir, e.n)
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 sm:p-10">
      <div className="absolute inset-0 bg-black/70 animate-fade" onClick={onClose} aria-hidden />
      <div ref={box} tabIndex={-1} role="dialog" aria-modal aria-label="Quick Look"
        className="relative w-full max-w-6xl max-h-full flex flex-col rounded-lg bg-surface-3 shadow-pop animate-pop focus:outline-none overflow-hidden">
        <div className="flex items-center gap-2 h-12 px-3 border-b border-line shrink-0">
          <span className="font-medium truncate">{e.n}</span>
          <span className="text-muted text-[13px] shrink-0 tabular-nums">{bytes(e.s)}, {when(e.m)}</span>
          <span className="ml-auto font-mono text-[12px] text-faint shrink-0">{index + 1} / {files.length}</span>
          <a href={fileURL(machine, full, true)} download aria-label="Download" className="press grid place-items-center size-9 rounded-sm text-muted hover:text-fg hover:bg-surface-2"><Download className="size-[18px]" /></a>
          <IconButton label="Close" onClick={onClose}><X /></IconButton>
        </div>
        <div className="flex-1 min-h-0 grid place-items-center overflow-auto bg-bg/40 p-3">
          <Preview key={full} machine={machine} path={full} name={e.n} large />
        </div>
        {files.length > 1 && (
          <>
            <IconButton label="Previous file" onClick={() => onIndex(Math.max(0, index - 1))} disabled={index === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-surface/80 shadow-pop"><ChevronLeft /></IconButton>
            <IconButton label="Next file" onClick={() => onIndex(Math.min(files.length - 1, index + 1))} disabled={index === files.length - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-surface/80 shadow-pop"><ChevronRight /></IconButton>
          </>
        )}
      </div>
    </div>
  )
}
