import { useEffect, useState, useSyncExternalStore } from 'react'

// Tiny persisted preference hook. View mode and hidden-files survive reloads.
export function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    const raw = localStorage.getItem('rfs.' + key)
    return raw === null ? initial : (JSON.parse(raw) as T)
  })
  return [v, (n: T) => { setV(n); localStorage.setItem('rfs.' + key, JSON.stringify(n)) }]
}

// Reactive media query, for rendering a component in exactly one place per breakpoint.
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const f = () => setOn(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [query])
  return on
}

// ---- Recent and pinned locations, per browser, in localStorage ----------------
export type Loc = { machine: string; path: string; t: number }
const load = (k: string): Loc[] => { try { return JSON.parse(localStorage.getItem(k) ?? '[]') } catch { return [] } }
let recent = load('rfs.recent'), pinned = load('rfs.pinned')
let snap = { recent, pinned }
const subs = new Set<() => void>()
function commit() {
  localStorage.setItem('rfs.recent', JSON.stringify(recent)); localStorage.setItem('rfs.pinned', JSON.stringify(pinned))
  snap = { recent, pinned }; subs.forEach(f => f())
}
const same = (a: Loc, b: { machine: string; path: string }) => a.machine === b.machine && a.path === b.path
export function pushRecent(machine: string, path: string) {
  recent = [{ machine, path, t: Date.now() }, ...recent.filter(r => !same(r, { machine, path }))].slice(0, 20); commit()
}
export function togglePin(machine: string, path: string) {
  pinned = pinned.some(p => same(p, { machine, path })) ? pinned.filter(p => !same(p, { machine, path })) : [...pinned, { machine, path, t: Date.now() }]; commit()
}
export const isPinned = (machine: string, path: string) => pinned.some(p => same(p, { machine, path }))
export function forgetMachine(name: string) { recent = recent.filter(r => r.machine !== name); commit() }
export function useLocs() {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f) } }, () => snap)
}
