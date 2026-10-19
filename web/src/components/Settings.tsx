import { KeyRound, Lock } from 'lucide-react'
import { label, type Machine } from '../api'
import { hueOf } from '../format'
import { OtpSettings } from './Otp'
import { MachineMark } from './ui'

export function Settings({ machines }: { machines: Machine[] }) {
  const live = machines.filter(m => m.agent)
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-8 py-8 sm:py-12 space-y-6 animate-rise">
        <div>
          <h1 className="text-[26px] sm:text-[32px] font-medium tracking-tight">Security</h1>
          <p className="text-muted mt-1">Three layers: your sign-in at the edge, a code from your phone for each device, and a password per machine checked by the machine itself.</p>
        </div>
        <OtpSettings />
        <section aria-labelledby="pw-h" className="rounded-lg border border-line bg-surface p-5">
          <div className="flex items-start gap-3">
            <span className="grid place-items-center size-10 rounded-md bg-surface-2 text-muted shrink-0"><KeyRound className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 id="pw-h" className="font-medium text-[16px]">Access passwords per machine</h2>
              <p className="text-muted text-[13px] mt-0.5">Set on the machine, never stored on the hub. Unlocking lasts 12 hours per machine. Run this on a machine to set or change it, then restart the agent:</p>
              <pre className="mt-2 rounded-sm bg-bg border border-line p-3 font-mono text-[12px] overflow-auto">rfs-agent -set-password && systemctl --user restart rfs-agent</pre>
              <ul className="mt-3 divide-y divide-line">
                {live.map(m => (
                  <li key={m.name} className="flex items-center gap-2.5 h-10 text-[14px]">
                    <MachineMark name={label(m)} hue={hueOf(m.name)} size="sm" />
                    <span className="truncate">{label(m)}</span>
                    <span className="ml-auto text-[13px] flex items-center gap-1.5">
                      {m.locked ? <><Lock className="size-3.5 text-success" aria-hidden /> <span className="text-muted">{m.unlocked ? 'password set, unlocked' : 'password set'}</span></> : <span className="text-faint">no password</span>}
                    </span>
                  </li>
                ))}
                {live.length === 0 && <li className="h-10 flex items-center text-[13px] text-muted">No machine is running an agent.</li>}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
