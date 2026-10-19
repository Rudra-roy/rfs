// Which machines have bytes in flight right now. Drives the amber LED pulse.
import { useSyncExternalStore } from 'react'

const counts = new Map<string, number>()
const subs = new Set<() => void>()

function bump(m: string, d: number) {
  counts.set(m, Math.max(0, (counts.get(m) ?? 0) + d))
  subs.forEach(f => f())
}

export function track(machine: string): () => void {
  bump(machine, 1)
  let done = false
  return () => { if (!done) { done = true; bump(machine, -1) } }
}

export function useBusy(machine: string): boolean {
  return useSyncExternalStore(
    f => { subs.add(f); return () => { subs.delete(f) } },
    () => (counts.get(machine) ?? 0) > 0,
  )
}
