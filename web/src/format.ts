export function bytes(n: number): string {
  if (n < 1000) return `${n} B`
  const u = ['kB', 'MB', 'GB', 'TB']
  let i = -1
  do { n /= 1000; i++ } while (n >= 1000 && i < u.length - 1)
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${u[i]}`
}

export function when(ms: number): string {
  const d = new Date(ms), now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

export function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 172800) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

export function ext(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

export type Kind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'code' | 'archive' | 'other'
const K: Record<string, Kind> = {}
const add = (k: Kind, exts: string) => exts.split(' ').forEach(e => (K[e] = k))
add('image', 'jpg jpeg png gif webp avif svg bmp heic tiff')
add('video', 'mp4 webm mov m4v mkv avi')
add('audio', 'mp3 flac wav ogg m4a aac opus')
add('pdf', 'pdf')
add('text', 'txt md csv log ini cfg conf doc docx xls xlsx ppt pptx odt rtf')
add('code', 'py go ts tsx js jsx sh c h cpp rs json yaml yml toml xml html css sql java kt swift rb php lua')
add('archive', 'zip tar gz tgz bz2 xz 7z rar iso dmg deb rpm')
export function kind(name: string): Kind { return K[ext(name)] ?? 'other' }

// Color slot for a kind (pdf and text share the document hue).
export type KindColor = 'folder' | 'image' | 'video' | 'audio' | 'document' | 'code' | 'archive' | 'other'
export const kindColor = (k: Kind): KindColor => k === 'pdf' || k === 'text' ? 'document' : k

// Stable identity hue index 1..8 for a machine name.
export function hueOf(name: string): number {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return (h % 8) + 1
}
