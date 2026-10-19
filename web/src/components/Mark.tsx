import { useId } from 'react'

// Brand mark: an amber faceplate with three bays cut out in the app's background
// ink and one lit LED. Same drawing as public/favicon.svg.
export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}p`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f8c766" /><stop offset="1" stopColor="#e59c22" /></linearGradient>
        <radialGradient id={`${id}l`}><stop offset="0" stopColor="#ffe2a3" /><stop offset=".45" stopColor="#ffcf6b" stopOpacity=".9" /><stop offset="1" stopColor="#ffcf6b" stopOpacity="0" /></radialGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="15" fill={`url(#${id}p)`} />
      <rect x="2.5" y="2.5" width="59" height="59" rx="14.5" fill="none" stroke="#fff" strokeOpacity=".28" />
      {[15.5, 27.5, 39.5].map(y => (
        <g key={y}>
          <rect x="13" y={y} width="38" height="9" rx="2.75" fill="#0f1821" />
          <rect x="17" y={y + 3.5} width="13" height="2" rx="1" fill="#99a6b4" fillOpacity=".45" />
        </g>
      ))}
      <circle cx="44.5" cy="20" r="4.5" fill={`url(#${id}l)`} />
      <circle cx="44.5" cy="20" r="2" fill="#fff4d6" />
      <circle cx="44.5" cy="32" r="2" fill="#f0b13b" fillOpacity=".38" />
      <circle cx="44.5" cy="44" r="2" fill="#f0b13b" fillOpacity=".38" />
    </svg>
  )
}
