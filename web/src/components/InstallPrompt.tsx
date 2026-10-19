import { useEffect, useState } from 'react'
import { Download, Share, SquarePlus, X } from 'lucide-react'
import { Mark } from './Mark'
import { Button, IconButton } from './ui'

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const KEY = 'rfs.install.dismissed'
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const snoozed = () => Date.now() - Number(localStorage.getItem(KEY) ?? 0) < 14 * 864e5

// A strip under the top bar on phones: one-tap install where the browser allows
// it (Android Chrome, Edge, Samsung), instructions on iOS Safari. Hidden once
// installed, and for two weeks after "Not now".
export function InstallPrompt() {
  const [evt, setEvt] = useState<BIP | null>(null)
  const [ios, setIos] = useState(false)
  const [hidden, setHidden] = useState(() => standalone() || snoozed())
  useEffect(() => {
    if (hidden) return
    const onBip = (e: Event) => { e.preventDefault(); setEvt(e as BIP) }
    const onInstalled = () => setHidden(true)
    addEventListener('beforeinstallprompt', onBip)
    addEventListener('appinstalled', onInstalled)
    if (isIOS() && matchMedia('(pointer: coarse)').matches) setIos(true)
    return () => { removeEventListener('beforeinstallprompt', onBip); removeEventListener('appinstalled', onInstalled) }
  }, [hidden])
  if (hidden || (!evt && !ios)) return null
  const dismiss = () => { localStorage.setItem(KEY, String(Date.now())); setHidden(true) }
  const install = async () => { await evt!.prompt(); const { outcome } = await evt!.userChoice; if (outcome === 'accepted') setHidden(true); setEvt(null) }
  return (
    <div role="region" aria-label="Install the app" className="shrink-0 flex items-center gap-3 px-3 py-2.5 border-b border-line bg-surface animate-fade">
      <Mark size={36} />
      <div className="min-w-0 flex-1 text-[13px] leading-snug">
        <div className="font-medium text-[14px]">Install files on this phone</div>
        {evt
          ? <div className="text-muted">Opens full screen from your home screen.</div>
          : <div className="text-muted flex flex-wrap items-center gap-1">Tap <Share className="size-3.5 inline" aria-label="Share" /> then <span className="inline-flex items-center gap-0.5 text-fg"><SquarePlus className="size-3.5" aria-hidden /> Add to Home Screen</span></div>}
      </div>
      {evt && <Button size="sm" variant="solid" icon={<Download />} onClick={install}>Install</Button>}
      <IconButton label="Not now" onClick={dismiss} className="size-8 shrink-0"><X /></IconButton>
    </div>
  )
}
