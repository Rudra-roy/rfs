// Verifies WCAG contrast floors for the token pairs the UI depends on.
// Reads --color-* from src/index.css. Run: node scripts/check-palette.mjs
import { readFileSync } from 'node:fs'
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const tok = Object.fromEntries([...css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]))
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const need = [
  ['fg', 'bg', 12], ['fg', 'surface-3', 9], ['muted', 'surface', 4.5], ['faint', 'bg', 3], ['accent-fg', 'accent', 4.5],
  ...['folder', 'image', 'video', 'audio', 'document', 'code', 'archive', 'other'].map(k => [`kind-${k}`, 'surface-2', 3]),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(i => [`m${i}`, 'bg', 3]),
  ['success', 'bg', 3], ['warning', 'bg', 3], ['danger', 'bg', 3], ['info', 'bg', 3],
]
let bad = 0
for (const [a, b, min] of need) {
  if (!tok[a] || !tok[b]) { console.log(`MISSING ${a} or ${b}`); bad++; continue }
  const r = ratio(tok[a], tok[b])
  const ok = r >= min
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${a} on ${b}: ${r.toFixed(2)} (need ${min})`)
}
process.exit(bad ? 1 : 0)
