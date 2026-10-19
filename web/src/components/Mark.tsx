// Brand mark: a 1U faceplate with three bays and a lit LED. Same drawing as public/favicon.svg.
export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden>
      <defs>
        <linearGradient id="mk-plate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2b353f" /><stop offset="1" stopColor="#18212b" /></linearGradient>
        <linearGradient id="mk-unit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#394552" /><stop offset="1" stopColor="#222b35" /></linearGradient>
        <radialGradient id="mk-glow"><stop offset="0" stopColor="#f0b13b" stopOpacity="0.9" /><stop offset="1" stopColor="#f0b13b" stopOpacity="0" /></radialGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#mk-plate)" />
      <rect x="2.5" y="2.5" width="59" height="59" rx="13.5" fill="none" stroke="#fff" strokeOpacity="0.08" />
      <rect x="9" y="12" width="4" height="40" rx="1.5" fill="#0f1821" opacity="0.9" /><rect x="51" y="12" width="4" height="40" rx="1.5" fill="#0f1821" opacity="0.9" />
      {[14, 27.5, 41].map(y => <g key={y}><rect x="15" y={y} width="34" height="9" rx="2.5" fill="url(#mk-unit)" /><rect x="19" y={y + 3.5} width="14" height="2" rx="1" fill="#0f1821" opacity="0.8" /></g>)}
      <circle cx="43.5" cy="18.5" r="7" fill="url(#mk-glow)" /><circle cx="43.5" cy="18.5" r="2.4" fill="#f0b13b" />
      <circle cx="43.5" cy="32" r="2.4" fill="#5ac0ab" opacity="0.9" /><circle cx="43.5" cy="45.5" r="2.4" fill="#5d6675" opacity="0.7" />
    </svg>
  )
}
