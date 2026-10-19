import { track } from './transfers'

export type Mount = { path: string; label: string; fstype: string; total: number; free: number }
export type Machine = { name: string; alias?: string; ip: string; os: string; online: boolean; agent: boolean; locked: boolean; unlocked: boolean; lastSeen: string; mounts: Mount[] }
export const isLocked = (m?: Machine) => !!m && m.locked && !m.unlocked
// what to call a machine in the UI; URLs and colours stay on the real name
export const label = (m: { name: string; alias?: string }) => m.alias || m.name
export type Entry = { n: string; d?: boolean; s: number; m: number }

const CHUNK = 32 * 1024 * 1024 // Cloudflare caps a request body at 100 MB

async function check(r: Response): Promise<Response> {
  if (r.ok) return r
  const text = (await r.text()).trim()
  if (r.status === 401 && text.includes('"otp":true')) { dispatchEvent(new Event('rfs:otp')); throw new Error('second factor required') }
  const e = new Error(text || r.statusText) as Error & { status: number }
  e.status = r.status
  throw e
}

export const machines = (): Promise<Machine[]> => fetch('/api/machines').then(check).then(r => r.json())
export const me = (): Promise<{ email: string }> => fetch('/api/me').then(check).then(r => r.json())
const post = (url: string, body?: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(check)
export const unlock = (name: string, password: string) => post(`/api/m/${encodeURIComponent(name)}/unlock`, { password }).then(() => dispatchEvent(new Event('rfs:machines')))
export const lock = (name: string) => post(`/api/m/${encodeURIComponent(name)}/lock`).then(() => dispatchEvent(new Event('rfs:machines')))
export const otp = {
  status: (): Promise<{ enrolled: boolean; verified: boolean }> => fetch('/api/otp/status').then(check).then(r => r.json()),
  enroll: (): Promise<{ secret: string; uri: string }> => post('/api/otp/enroll').then(r => r.json()),
  confirm: (code: string) => post('/api/otp/confirm', { code }),
  verify: (code: string) => post('/api/otp/verify', { code }),
  disable: (code: string) => post('/api/otp/disable', { code }),
}
// Ends the session: the hub re-locks machines and forgets this device's 2FA, then Access clears its cookie.
export async function logout() {
  const { next } = await post('/api/logout').then(r => r.json())
  for (const k of Object.keys(localStorage)) if (k.startsWith('rfs.recent') || k.startsWith('rfs.pinned')) localStorage.removeItem(k)
  location.assign(next)
}
export const setAlias = (name: string, alias: string) =>
  fetch(`/api/machines/${encodeURIComponent(name)}/alias`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ alias }) })
    .then(check).then(() => dispatchEvent(new Event('rfs:machines')))

const q = (o: Record<string, string>) => new URLSearchParams(o).toString()
const base = (m: string) => `/api/m/${encodeURIComponent(m)}/v1`

export const fileURL = (m: string, path: string, dl = false) =>
  `${base(m)}/file?${q(dl ? { path, dl: '1' } : { path })}`

// zip of a folder, or of named entries inside it
export const zipURL = (m: string, dir: string, names: string[] = []) =>
  `${base(m)}/zip?` + new URLSearchParams([['path', dir], ...names.map(n => ['name', n] as [string, string])]).toString()

export type Hit = { machine: string; p: string; n: string; d?: boolean; s: number; m: number }
export type Coverage = { machine: string; root: string; done: boolean; error?: string }

// Streams merged search hits from every agent; onBatch gets growing arrays.
export async function search(q: string, signal: AbortSignal, onBatch: (hits: Hit[], cov: Coverage[]) => void) {
  const r = await fetch(`/api/search?${new URLSearchParams({ q })}`, { signal }).then(check)
  const reader = r.body!.getReader(), dec = new TextDecoder()
  const hits: Hit[] = [], cov: Coverage[] = []
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    buf += dec.decode(value, { stream: !done })
    const lines = buf.split('\n')
    buf = done ? '' : lines.pop()!
    for (const l of lines) {
      if (!l) continue
      const o = JSON.parse(l)
      if ('done' in o) cov.push(o); else hits.push(o)
    }
    onBatch(hits.slice(), cov.slice())
    if (done) return
  }
}

// mtime in the URL makes the immutable cache header safe
export const thumbURL = (m: string, path: string, mtime: number) =>
  `${base(m)}/thumb?${q({ path, v: String(mtime) })}`

// Streams NDJSON; onBatch gets the growing array so rows paint as they arrive.
export async function ls(m: string, path: string, signal: AbortSignal, onBatch: (e: Entry[]) => void): Promise<Entry[]> {
  const stop = track(m)
  try {
    const r = await fetch(`${base(m)}/ls?${q({ path })}`, { signal }).then(check)
    const reader = r.body!.getReader(), dec = new TextDecoder()
    const out: Entry[] = []
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      buf += dec.decode(value, { stream: !done })
      const lines = buf.split('\n')
      buf = done ? '' : lines.pop()!
      for (const l of lines) if (l) out.push(JSON.parse(l))
      onBatch(out.slice())
      if (done) return out
    }
  } finally { stop() }
}

export const mkdir = (m: string, path: string) => fetch(`${base(m)}/mkdir?${q({ path })}`, { method: 'POST' }).then(check)
export const mv = (m: string, from: string, to: string) => fetch(`${base(m)}/mv?${q({ from, to })}`, { method: 'POST' }).then(check)
export const rm = (m: string, path: string) => fetch(`${base(m)}/rm?${q({ path })}`, { method: 'POST' }).then(check)
export const text = (m: string, path: string) => fetch(fileURL(m, path), { headers: { Range: 'bytes=0-199999' } }).then(check).then(r => r.text())

// Resumable chunked upload: HEAD for current size, then sequential PUTs at that offset.
export async function upload(m: string, path: string, file: File, onProgress: (sent: number) => void, signal?: AbortSignal) {
  const stop = track(m)
  try {
    const head = await fetch(fileURL(m, path), { method: 'HEAD' })
    let off = head.ok ? Number(head.headers.get('content-length') ?? 0) : 0
    if (off > file.size) off = 0
    while (off < file.size || (file.size === 0 && off === 0)) {
      const end = Math.min(off + CHUNK, file.size)
      await putChunk(`${base(m)}/file?${q({ path, offset: String(off) })}`, file.slice(off, end), n => onProgress(off + n), signal)
      off = end
      onProgress(off)
      if (file.size === 0) break
    }
  } finally { stop() }
}

function putChunk(url: string, body: Blob, onProgress: (n: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest()
    x.open('PUT', url)
    x.upload.onprogress = e => onProgress(e.loaded)
    x.onload = () => (x.status < 300 ? res() : rej(new Error(x.responseText || x.statusText)))
    x.onerror = () => rej(new Error('network error'))
    signal?.addEventListener('abort', () => x.abort())
    x.send(body)
  })
}
