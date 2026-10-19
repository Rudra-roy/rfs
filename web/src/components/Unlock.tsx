import { useState } from 'react'
import { KeyRound, Lock } from 'lucide-react'
import { label, unlock, type Machine } from '../api'
import { hueOf } from '../format'
import { Button, MachineMark, TextInput } from './ui'

// Shown in place of a machine's files until its access password has been entered.
export function Unlock({ machine, onDone }: { machine: Machine; onDone?: () => void }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(undefined)
    unlock(machine.name, pw).then(() => { setPw(''); onDone?.() }).catch(e => setErr(e.message)).finally(() => setBusy(false))
  }
  return (
    <div className="flex-1 grid place-items-center p-6 animate-fade">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-pop">
        <div className="flex items-center gap-3 mb-4">
          <MachineMark name={label(machine)} hue={hueOf(machine.name)} size="lg" />
          <div className="min-w-0">
            <h2 className="font-medium text-[16px] leading-tight truncate">{label(machine)}</h2>
            <p className="text-muted text-[13px] flex items-center gap-1.5"><Lock className="size-3.5" aria-hidden /> Access password required</p>
          </div>
        </div>
        <label className="block text-[13px] text-muted mb-1.5" htmlFor="unlock-pw">Password for this machine</label>
        <TextInput id="unlock-pw" type="password" autoFocus autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} disabled={busy} />
        {err && <p role="alert" className="text-danger text-[13px] mt-2">{err}</p>}
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-[12px] text-faint">Checked by the machine itself. Stays open for 12 hours.</span>
          <Button type="submit" variant="solid" icon={<KeyRound />} disabled={busy || !pw}>{busy ? 'Checking…' : 'Unlock'}</Button>
        </div>
      </form>
    </div>
  )
}
