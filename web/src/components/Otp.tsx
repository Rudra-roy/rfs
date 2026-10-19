import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { ShieldCheck, ShieldOff, Smartphone } from 'lucide-react'
import { otp } from '../api'
import { Button, TextInput, cx } from './ui'

function CodeInput({ value, onChange, disabled, id }: { value: string; onChange: (v: string) => void; disabled?: boolean; id: string }) {
  return <TextInput id={id} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} placeholder="123 456" autoFocus value={value}
    onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={disabled} className="font-mono text-[18px] tracking-[0.3em] text-center h-11" />
}

// Full-screen gate: the second factor for this device.
export function OtpGate({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string>()
  const [busy, setBusy] = useState(false)
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(undefined)
    otp.verify(code).then(onDone).catch(e => setErr(e.message)).finally(() => setBusy(false))
  }
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-bg/95 p-6 animate-fade" role="dialog" aria-modal aria-label="Two-step verification">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-pop">
        <div className="flex items-center gap-3 mb-4">
          <span className="grid place-items-center size-10 rounded-md bg-accent-dim text-accent"><ShieldCheck className="size-5" /></span>
          <div><h2 className="font-medium text-[16px] leading-tight">Two-step verification</h2><p className="text-muted text-[13px]">Enter the code from your authenticator app.</p></div>
        </div>
        <CodeInput id="otp-code" value={code} onChange={setCode} disabled={busy} />
        {err && <p role="alert" className="text-danger text-[13px] mt-2">{err}</p>}
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-[12px] text-faint">This device stays verified for 30 days.</span>
          <Button type="submit" variant="solid" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Verify'}</Button>
        </div>
      </form>
    </div>
  )
}

// Settings page: enrol, show status, disable.
export function OtpSettings() {
  const [status, setStatus] = useState<{ enrolled: boolean; verified: boolean }>()
  const [enroll, setEnroll] = useState<{ secret: string; uri: string }>()
  const [qr, setQr] = useState<string>()
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string>()
  const [mode, setMode] = useState<'view' | 'enroll' | 'disable'>('view')
  const canvas = useRef<HTMLDivElement>(null)
  const refresh = () => otp.status().then(setStatus).catch(e => setErr(e.message))
  useEffect(() => { refresh() }, [])
  useEffect(() => { if (enroll) QRCode.toDataURL(enroll.uri, { margin: 1, width: 232, color: { dark: '#ede9e1', light: '#00000000' } }).then(setQr) }, [enroll])

  const start = () => otp.enroll().then(e => { setEnroll(e); setMode('enroll'); setCode(''); setErr(undefined) }).catch(e => setErr(e.message))
  const confirm = (e: React.FormEvent) => { e.preventDefault(); otp.confirm(code).then(() => { setMode('view'); setEnroll(undefined); setCode(''); refresh() }).catch(e => setErr(e.message)) }
  const disable = (e: React.FormEvent) => { e.preventDefault(); otp.disable(code).then(() => { setMode('view'); setCode(''); refresh() }).catch(e => setErr(e.message)) }

  return (
    <section aria-labelledby="otp-h" className="rounded-lg border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className={cx('grid place-items-center size-10 rounded-md shrink-0', status?.enrolled ? 'bg-success-dim text-success' : 'bg-surface-2 text-muted')}>
          {status?.enrolled ? <ShieldCheck className="size-5" /> : <ShieldOff className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="otp-h" className="font-medium text-[16px]">Two-step verification</h2>
          <p className="text-muted text-[13px] mt-0.5">
            {status === undefined ? 'Checking…' : status.enrolled
              ? 'On. Every new browser must enter a code from your authenticator app after signing in. The hub checks it; your identity provider is not involved.'
              : 'Off. Turn it on to require a code from an authenticator app in addition to your sign-in.'}
          </p>
          {mode === 'view' && status && (
            <div className="mt-3">
              {status.enrolled
                ? <Button variant="danger" onClick={() => { setMode('disable'); setCode(''); setErr(undefined) }}>Turn off</Button>
                : <Button variant="solid" icon={<Smartphone />} onClick={start}>Set up with an authenticator app</Button>}
            </div>
          )}
          {mode === 'enroll' && enroll && (
            <form onSubmit={confirm} className="mt-4 grid sm:grid-cols-[auto_1fr] gap-5 animate-pop">
              <div ref={canvas} className="rounded-md bg-surface-2 border border-line p-2 w-fit">{qr && <img src={qr} alt="QR code for your authenticator app" width={232} height={232} />}</div>
              <div className="min-w-0">
                <ol className="text-[13px] text-muted list-decimal pl-4 space-y-1">
                  <li>Open Google Authenticator, Aegis, 1Password or any TOTP app.</li>
                  <li>Scan the code, or enter this key by hand:<br /><code className="font-mono text-[12px] text-fg break-all select-all">{enroll.secret}</code></li>
                  <li>Type the 6-digit code it shows to confirm.</li>
                </ol>
                <div className="mt-3 max-w-56"><CodeInput id="otp-confirm" value={code} onChange={setCode} /></div>
                {err && <p role="alert" className="text-danger text-[13px] mt-2">{err}</p>}
                <div className="mt-3 flex gap-2">
                  <Button type="submit" variant="solid" disabled={code.length !== 6}>Confirm and turn on</Button>
                  <Button type="button" variant="ghost" onClick={() => { setMode('view'); setEnroll(undefined) }}>Cancel</Button>
                </div>
              </div>
            </form>
          )}
          {mode === 'disable' && (
            <form onSubmit={disable} className="mt-4 animate-pop">
              <p className="text-[13px] text-muted mb-2">Enter a current code to turn two-step verification off.</p>
              <div className="max-w-56"><CodeInput id="otp-disable" value={code} onChange={setCode} /></div>
              {err && <p role="alert" className="text-danger text-[13px] mt-2">{err}</p>}
              <div className="mt-3 flex gap-2">
                <Button type="submit" variant="danger" disabled={code.length !== 6}>Turn off</Button>
                <Button type="button" variant="ghost" onClick={() => setMode('view')}>Keep on</Button>
              </div>
            </form>
          )}
          {mode === 'view' && err && <p role="alert" className="text-danger text-[13px] mt-2">{err}</p>}
        </div>
      </div>
    </section>
  )
}
