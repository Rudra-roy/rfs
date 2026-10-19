import { useEffect, useState } from 'react'
import { LogOut, ShieldCheck } from 'lucide-react'
import { logout, me } from '../api'
import { navigateTo } from '../route'
import { Menu, MenuItem, cx } from './ui'

// Who is signed in, and the way out.
export function Account() {
  const [email, setEmail] = useState<string>()
  const [busy, setBusy] = useState(false)
  useEffect(() => { me().then(r => setEmail(r.email)).catch(() => {}) }, [])
  const initial = (email ?? '?').slice(0, 1).toUpperCase()
  return (
    <Menu align="end" trigger={open => (
      <button aria-label={email ? `Account: ${email}` : 'Account'} aria-haspopup="menu" aria-expanded={open}
        className={cx('press grid place-items-center size-9 rounded-full', open ? 'bg-surface-2' : 'hover:bg-surface-2')}>
        <span className="grid place-items-center size-7 rounded-full bg-accent-dim text-accent text-[13px] font-semibold">{initial}</span>
      </button>
    )}>
      {close => (
        <>
          <div className="px-2.5 py-2 border-b border-line mb-1">
            <div className="text-[12px] text-muted">Signed in as</div>
            <div className="text-[13px] font-medium truncate max-w-64">{email ?? '…'}</div>
          </div>
          <MenuItem onClick={() => { close(); navigateTo('/settings') }}><ShieldCheck className="size-4 text-muted" /> Security settings</MenuItem>
          <MenuItem onClick={() => { setBusy(true); logout().catch(() => setBusy(false)) }} className="text-danger">
            <LogOut className="size-4" /> {busy ? 'Signing out…' : 'Sign out'}
          </MenuItem>
          <p className="px-2.5 pt-1 pb-1.5 text-[11px] text-faint max-w-64">Signing out locks your machines again and asks for your two-step code next time on this device.</p>
        </>
      )}
    </Menu>
  )
}
