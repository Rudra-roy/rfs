// URL shape: /m/<machine>/<path>   e.g. /m/kage/media/data/photos  or  /m/pc/D:/Games
import { useEffect, useState } from 'react'
import { pushRecent } from './prefs'

export type Route = { machine: string; path: string } | { machine: null; path: '' }

const isWin = (p: string) => /^[A-Za-z]:/.test(p)

export function toURL(machine: string, path: string): string {
  const p = isWin(path) ? '/' + path.replaceAll('\\', '/') : path
  return '/m/' + encodeURIComponent(machine) + p.split('/').map(encodeURIComponent).join('/')
}

function parse(pathname: string): Route {
  const m = /^\/m\/([^/]+)(\/.*)?$/.exec(pathname)
  if (!m) return { machine: null, path: '' }
  let p = (m[2] ?? '/').split('/').map(decodeURIComponent).join('/')
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1).replaceAll('/', '\\').replace(/^([A-Za-z]:)$/, '$1\\')
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return { machine: decodeURIComponent(m[1]), path: p }
}

export function navigate(machine: string | null, path = '') {
  const go = () => {
    history.pushState(null, '', machine ? toURL(machine, path) : '/')
    dispatchEvent(new PopStateEvent('popstate'))
  }
  const d = document as Document & { startViewTransition?: (f: () => void) => void }
  d.startViewTransition ? d.startViewTransition(go) : go()
}

// Breadcrumb segments for a path: [{label, path}], first is the drive root.
export function crumbs(path: string, mountPath?: string): { label: string; path: string }[] {
  const sep = path.includes('\\') ? '\\' : '/'
  const root = mountPath && path.startsWith(mountPath) ? mountPath : sep
  const rest = path.slice(root.length).split(sep).filter(Boolean)
  const out = [{ label: root === '/' ? '/' : root.replace(/[\\/]$/, '').split(sep).pop() || root, path: root }]
  let cur = root
  for (const seg of rest) { cur = join(cur, seg); out.push({ label: seg, path: cur }) }
  return out
}

export function useRoute(): Route {
  const [r, set] = useState(() => parse(location.pathname))
  useEffect(() => {
    const f = () => set(parse(location.pathname))
    addEventListener('popstate', f)
    return () => removeEventListener('popstate', f)
  }, [])
  // every folder you view becomes a recent, however you got there
  useEffect(() => { if (r.machine) pushRecent(r.machine, r.path) }, [r.machine, r.path])
  return r
}

// Last segment of a path, for compact labels; drive roots return the root itself.
export function tail(path: string): string {
  const seg = path.split(/[\\/]/).filter(Boolean)
  return seg.length ? seg[seg.length - 1] : path
}

export function parent(path: string): string | null {
  if (path === '/' || /^[A-Za-z]:\\$/.test(path)) return null
  const sep = path.includes('\\') ? '\\' : '/'
  const i = path.lastIndexOf(sep)
  return i <= 0 ? sep : i === 2 && sep === '\\' ? path.slice(0, 3) : path.slice(0, i)
}

export function join(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.endsWith(sep) ? dir + name : dir + sep + name
}
