import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

const cx = (...c: Array<string | false | undefined | null>) => c.filter(Boolean).join(' ')

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'solid' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  icon?: ReactNode
}

export function Button({ variant = 'outline', size = 'md', icon, className, children, ...rest }: BtnProps) {
  return (
    <button {...rest}
      className={cx('press inline-flex items-center gap-2 rounded-sm font-medium whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3 text-[14px]',
        variant === 'solid' && 'bg-accent text-accent-fg hover:bg-accent/90',
        variant === 'outline' && 'border border-line-strong bg-surface hover:bg-surface-2',
        variant === 'ghost' && 'text-muted hover:text-fg hover:bg-surface-2',
        variant === 'danger' && 'border border-danger/40 text-danger hover:bg-danger-dim',
        className)}>
      {icon && <span className="shrink-0 [&>svg]:size-4" aria-hidden>{icon}</span>}
      {children}
    </button>
  )
}

export function IconButton({ label, active, className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button {...rest} aria-label={label} title={label} aria-pressed={active}
      className={cx('press grid place-items-center size-9 rounded-sm [&>svg]:size-[18px] disabled:opacity-40 disabled:pointer-events-none',
        active ? 'bg-accent-dim text-accent' : 'text-muted hover:text-fg hover:bg-surface-2', className)}>
      {children}
    </button>
  )
}

export function TextInput({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} spellCheck={false}
    className={cx('h-9 px-3 rounded-sm bg-surface border border-line-strong placeholder:text-faint focus:border-accent/60 focus:outline-none transition-colors w-full min-w-0', className)} />
}

// Simple anchored menu: closes on outside click, Escape, or selection.
export function Menu({ trigger, children, align = 'start' }: { trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen(o => !o)}>{trigger(open)}</div>
      {open && (
        <div role="menu" className={cx('absolute top-full mt-1.5 z-40 min-w-56 max-h-[60vh] overflow-auto rounded-md bg-surface-2 shadow-pop p-1 animate-pop', align === 'end' ? 'right-0' : 'left-0')}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ onClick, active, children, className }: { onClick: () => void; active?: boolean; children: ReactNode; className?: string }) {
  return (
    <button role="menuitem" onClick={onClick}
      className={cx('press w-full text-left flex items-center gap-2.5 px-2.5 h-9 rounded-sm text-[14px]', active ? 'bg-accent-dim text-fg' : 'hover:bg-surface-3', className)}>
      {children}
    </button>
  )
}

// Overlay panel: left drawer on any size, or bottom sheet. Escape and backdrop close it.
export function Overlay({ open, onClose, side, label, children }: { open: boolean; onClose: () => void; side: 'left' | 'bottom'; label: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/55 animate-fade" onClick={onClose} aria-hidden />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal aria-label={label}
        className={cx('absolute bg-surface focus:outline-none flex flex-col',
          side === 'left' ? 'inset-y-0 left-0 w-[82vw] max-w-80 border-r border-line animate-drawer' :
            'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-lg shadow-sheet animate-sheet pb-[env(safe-area-inset-bottom)]')}>
        {side === 'bottom' && <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-surface-3" aria-hidden />}
        <div className="flex items-center justify-between px-4 h-12 shrink-0">
          <span className="text-[13px] font-medium text-muted">{label}</span>
          <IconButton label="Close" onClick={onClose}><X /></IconButton>
        </div>
        <div className="min-h-0 overflow-auto flex-1">{children}</div>
      </div>
    </div>
  )
}

export function Led({ busy, state }: { busy?: boolean; state: 'agent' | 'online' | 'offline' }) {
  const c = state === 'agent' ? 'bg-success shadow-[0_0_8px_var(--color-success)]' : state === 'online' ? 'bg-muted/60' : 'bg-danger/70'
  return <span aria-hidden className={cx('inline-block size-2 rounded-full shrink-0', c, busy && 'animate-led')} />
}

// Identity chip: the machine's initial on its own hue. Status lives in the Led, never here.
export function MachineMark({ name, hue, size = 'md' }: { name: string; hue: number; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span aria-hidden data-hue={hue}
      className={cx('grid place-items-center shrink-0 rounded-sm font-semibold bg-hue-dim text-hue select-none',
        size === 'sm' ? 'size-5 text-[11px]' : size === 'lg' ? 'size-9 text-[16px] rounded-md' : 'size-6 text-[12px]')}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function Skeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-busy aria-label="Loading" className="px-3 py-2 space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid grid-cols-[1fr_5rem_6rem] gap-4 items-center h-8">
          <div className="skeleton h-3.5 rounded-sm" style={{ width: `${40 + ((i * 37) % 45)}%` }} />
          <div className="skeleton h-3 rounded-sm w-12 justify-self-end" />
          <div className="skeleton h-3 rounded-sm w-16 justify-self-end" />
        </div>
      ))}
    </div>
  )
}

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div role="status" className="h-full grid place-items-center p-8 animate-fade">
      <div className="max-w-sm text-center">
        {icon && <div className="mx-auto mb-3 size-11 rounded-md bg-surface-2 grid place-items-center text-muted [&>svg]:size-5" aria-hidden>{icon}</div>}
        <p className="font-medium">{title}</p>
        {body && <p className="text-muted text-[14px] mt-1">{body}</p>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  )
}

export { cx }
