// App-wide upload queue, so navigating away never hides progress.
import { useSyncExternalStore } from 'react'

export type Up = { id: number; name: string; machine: string; dir: string; sent: number; size: number; err?: string; done: boolean }
let list: Up[] = []
let seq = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach(f => f())

export function addUpload(name: string, machine: string, dir: string, size: number): Up {
  const u: Up = { id: ++seq, name, machine, dir, sent: 0, size, done: false }
  list = [...list, u]; emit(); return u
}
export function patchUpload(id: number, patch: Partial<Up>) { list = list.map(u => (u.id === id ? { ...u, ...patch } : u)); emit() }
export function clearUploads() { list = list.filter(u => !u.done && !u.err); emit() }
export function useUploads(): Up[] { return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f) } }, () => list) }
