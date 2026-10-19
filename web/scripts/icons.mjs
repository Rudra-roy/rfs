// Renders PNG app icons and the social preview from favicon.svg with headless Chromium.
// Run from web/: node scripts/icons.mjs
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8')
const b = await chromium.launch()
const icon = async (px, out) => {
  const p = await b.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 })
  await p.setContent(`<body style="margin:0;background:#0f1821">${svg.replace('width="64" height="64"', `width="${px}" height="${px}"`)}</body>`)
  await p.screenshot({ path: new URL(`../public/${out}`, import.meta.url).pathname, omitBackground: false })
  await p.close()
}
await icon(180, 'apple-touch-icon.png')
await icon(512, 'icon-512.png')
const og = await b.newPage({ viewport: { width: 1200, height: 630 } })
await og.setContent(`<!doctype html><html><head><style>
  @font-face{font-family:Plex;src:url(file://${process.cwd()}/node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2) format('woff2');font-weight:600}
  @font-face{font-family:PlexMono;src:url(file://${process.cwd()}/node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2) format('woff2')}
  body{margin:0;width:1200px;height:630px;background:radial-gradient(900px 500px at 15% 0%, #2f2416, #0f1821 70%);color:#ede9e1;font-family:Plex,system-ui;display:flex;align-items:center;padding:0 96px;box-sizing:border-box;gap:56px}
  .mark{width:200px;height:200px;flex:none;filter:drop-shadow(0 20px 40px rgba(0,0,0,.6))}
  h1{font-size:84px;margin:0;letter-spacing:-0.03em;line-height:1}
  h1 span{color:#f0b13b}
  p{font-size:30px;margin:18px 0 0;color:#99a6b4}
  .eyebrow{font-family:PlexMono;font-size:18px;letter-spacing:.14em;text-transform:uppercase;color:#5d6675;margin-bottom:22px}
  .rack{position:absolute;right:96px;bottom:72px;display:flex;flex-direction:column;gap:8px}
  .u{width:300px;height:30px;border-radius:8px;background:linear-gradient(180deg,#2b353f,#18212b);border:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:flex-end;padding-right:14px;box-sizing:border-box;gap:6px}
  .c{width:12px;height:8px;border-radius:2px;background:#0f1821;box-shadow:inset 0 1px 1px rgba(0,0,0,.7)}
  .c.l{background:#5ac0ab;box-shadow:0 0 6px rgba(90,192,171,.6)}
  .c.m{background:#f99549;box-shadow:0 0 6px rgba(249,149,73,.6)}
</style></head><body>
  <div class="mark">${svg.replace('width="64" height="64"', 'width="200" height="200"')}</div>
  <div><div class="eyebrow">rfs</div><h1>Every drive,<br>every machine<span>.</span></h1><p>Your own rack, from anywhere.</p></div>
  <div class="rack">
    <div class="u"><i class="c l"></i><i class="c l"></i><i class="c l"></i><i class="c l"></i><i class="c l"></i><i class="c l"></i><i class="c l"></i><i class="c"></i><i class="c"></i><i class="c"></i></div>
    <div class="u"><i class="c l"></i><i class="c l"></i><i class="c l"></i><i class="c l"></i><i class="c l"></i><i class="c l"></i><i class="c l"></i><i class="c l"></i><i class="c m"></i><i class="c"></i></div>
    <div class="u"><i class="c l"></i><i class="c l"></i><i class="c l"></i><i class="c l"></i><i class="c"></i><i class="c"></i><i class="c"></i><i class="c"></i><i class="c"></i><i class="c"></i></div>
  </div>
</body></html>`)
await og.waitForTimeout(300)
await og.screenshot({ path: new URL('../public/og.png', import.meta.url).pathname })
await b.close()
console.log('icons written')
