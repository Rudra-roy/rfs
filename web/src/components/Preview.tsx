import { useEffect, useState } from 'react'
import { fileURL, text } from '../api'
import { kind } from '../format'
import { cx } from './ui'

// Renders a file preview by kind. Shared by the details pane and Quick Look.
export function Preview({ machine, path, name, large }: { machine: string; path: string; name: string; large?: boolean }) {
  const k = kind(name), src = fileURL(machine, path)
  const [body, setBody] = useState<string>()
  const [err, setErr] = useState<string>()
  useEffect(() => {
    setBody(undefined); setErr(undefined)
    if (k === 'text' || k === 'code') text(machine, path).then(setBody).catch(e => setErr(e.message))
  }, [machine, path, k])
  const max = large ? 'max-h-[78vh]' : 'max-h-[40vh]'
  if (err) return <span role="alert" className="text-danger p-6 text-[13px]">{err}</span>
  if (k === 'image') return <img src={src} alt={name} className={cx('max-w-full object-contain animate-fade', max)} />
  if (k === 'video') return <video src={src} controls playsInline autoPlay={large} preload="metadata" className={cx('w-full bg-black', max)} />
  if (k === 'audio') return <audio src={src} controls className="w-full p-3" />
  if (k === 'pdf') return <iframe src={src} title={name} className={cx('w-full bg-white', large ? 'h-[78vh]' : 'h-[50vh]')} />
  if (k === 'text' || k === 'code') return <pre className={cx('w-full overflow-auto p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap', max)}>{body ?? '…'}</pre>
  return <span className="text-muted p-8 text-[13px]">No preview for this type</span>
}
