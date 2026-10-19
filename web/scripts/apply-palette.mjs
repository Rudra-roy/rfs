// Writes a token JSON ({bg, surface, ..., heroB}) into the @theme block of src/index.css.
// Usage: node scripts/apply-palette.mjs tokens.json
import { readFileSync, writeFileSync } from 'node:fs'
const t = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const file = new URL('../src/index.css', import.meta.url)
let css = readFileSync(file, 'utf8')
const map = {
  bg: 'bg', surface: 'surface', surface2: 'surface-2', surface3: 'surface-3', line: 'line', lineStrong: 'line-strong',
  fg: 'fg', muted: 'muted', faint: 'faint',
  accent: 'accent', accentFg: 'accent-fg', accentDim: 'accent-dim',
  success: 'success', warning: 'warning', danger: 'danger', info: 'info',
  successDim: 'success-dim', warningDim: 'warning-dim', dangerDim: 'danger-dim', infoDim: 'info-dim',
  folder: 'kind-folder', image: 'kind-image', video: 'kind-video', audio: 'kind-audio', document: 'kind-document', code: 'kind-code', archive: 'kind-archive', other: 'kind-other',
  m1: 'm1', m2: 'm2', m3: 'm3', m4: 'm4', m5: 'm5', m6: 'm6', m7: 'm7', m8: 'm8',
  driveLow: 'drive-low', driveMid: 'drive-mid', driveHigh: 'drive-high',
  selection: 'selection', focus: 'focus', heroA: 'hero-a', heroB: 'hero-b',
  // legacy aliases still referenced nowhere but kept defined
  accent_legacy: 'amber', danger_legacy: 'ember', accentDim_legacy: 'amber-dim', dangerDim_legacy: 'ember-dim',
}
t.accent_legacy = t.accent; t.danger_legacy = t.danger; t.accentDim_legacy = t.accentDim; t.dangerDim_legacy = t.dangerDim
let n = 0
for (const [k, name] of Object.entries(map)) {
  if (!t[k]) { console.error('missing token', k); process.exitCode = 1; continue }
  const re = new RegExp(`(--color-${name}:\\s*)[^;]+;`)
  if (!re.test(css)) { console.error('no css var for', name); process.exitCode = 1; continue }
  css = css.replace(re, `$1${t[k]};`)
  n++
}
writeFileSync(file, css)
console.log(`applied ${n} tokens`)
