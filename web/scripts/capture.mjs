// Captures README screenshots and a demo GIF from the demo fleet (scripts/demo/run.sh).
// Run from web/: node scripts/capture.mjs   → writes docs/screenshots/*.png and docs/demo.gif at the repo root
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, readdirSync } from 'node:fs'
const BASE = 'http://127.0.0.1:7440', OUT = new URL('../../docs/', import.meta.url).pathname
mkdirSync(OUT + 'screenshots', { recursive: true })
const b = await chromium.launch()
const settle = (p, ms = 600) => p.waitForTimeout(ms)
const shot = async (p, name) => { await settle(p); await p.screenshot({ path: `${OUT}screenshots/${name}.png` }) }

// ---- stills ----
{
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await p.goto(BASE + '/'); await p.waitForSelector('.bay'); await shot(p, 'landing')
  await p.goto(BASE + '/m/atlas/tmp/rfs-demo/Vault/Documents'); await p.getByRole('option', { name: /^notes\.txt\s/ }).click(); await shot(p, 'browser')
  await p.goto(BASE + '/m/atlas/tmp/rfs-demo/Media/Photos'); await p.getByRole('button', { name: 'Grid view' }).click(); await p.waitForTimeout(2500); await shot(p, 'grid')
  await p.getByRole('option', { name: /^fractal\.png\s/ }).click(); await p.getByRole('listbox', { name: 'Files' }).press('Space'); await p.waitForTimeout(800); await shot(p, 'quicklook')
  await p.keyboard.press('Escape'); await p.getByRole('button', { name: 'List view' }).click()
  await p.goto(BASE + '/m/nimbus/tmp/rfs-demo/Backups'); await p.getByRole('option', { name: /^disk-image\.img\s/ }).click()
  await p.getByRole('option', { name: /^vault-2026-03\.tar\.gz\s/ }).click({ modifiers: ['Shift'] }); await shot(p, 'multiselect')
  await p.close()
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await m.goto(BASE + '/'); await m.waitForSelector('.bay'); await shot(m, 'mobile-landing')
  await m.goto(BASE + '/m/atlas/tmp/rfs-demo/Media/Photos'); await m.getByRole('button', { name: 'Grid view' }).click(); await m.waitForTimeout(2500); await shot(m, 'mobile-grid')
  await m.getByRole('option', { name: /^IMG_4105\.jpg\s/ }).click(); await shot(m, 'mobile-sheet')
  await m.close()
}

// ---- motion: one scripted tour, recorded to webm then converted to gif ----
const vdir = '/tmp/rfs-demo-video'; rmSync(vdir, { recursive: true, force: true })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: vdir, size: { width: 1280, height: 800 } } })
const p = await ctx.newPage()
const pause = ms => p.waitForTimeout(ms)
await p.goto(BASE + '/'); await p.waitForSelector('.bay'); await pause(1800)
await p.getByRole('main').getByRole('button', { name: /^Media/ }).hover(); await pause(500)
await p.getByRole('main').getByRole('button', { name: /^Media/ }).click(); await pause(1200)
await p.getByRole('option', { name: /^Photos\s/ }).click(); await pause(900)
await p.getByRole('button', { name: 'Grid view' }).click(); await pause(2200)
await p.getByRole('option', { name: /^IMG_4103\.jpg\s/ }).click(); await pause(700)
await p.getByRole('listbox', { name: 'Files' }).press('Space'); await pause(1400)
await p.keyboard.press('ArrowRight'); await pause(1000); await p.keyboard.press('ArrowRight'); await pause(1000)
await p.keyboard.press('Escape'); await pause(600)
await p.getByRole('button', { name: 'List view' }).click(); await pause(800)
await p.keyboard.press('/'); await pause(500); await p.keyboard.type('vault', { delay: 90 }); await pause(700); await p.keyboard.press('Enter'); await pause(1000)
await p.getByRole('option', { name: /^Documents\s/ }).click(); await pause(900)
await p.getByRole('option', { name: /^notes\.txt\s/ }).click(); await pause(1200)
await p.getByRole('option', { name: /^config\.yaml\s/ }).click({ modifiers: ['Shift'] }); await pause(1200)
await p.keyboard.press('Escape'); await pause(400)
await p.getByRole('button', { name: 'Hide sidebar' }).click(); await pause(900)
await p.getByRole('button', { name: 'Show sidebar' }).click(); await pause(1200)
await ctx.close(); await b.close()
const webm = vdir + '/' + readdirSync(vdir).find(f => f.endsWith('.webm'))
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', webm, '-vf', 'fps=12,scale=1024:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=160:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', '-loop', '0', OUT + 'demo.gif'])
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', webm, '-vf', 'fps=24,scale=1280:-2', '-c:v', 'libx264', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT + 'demo.mp4'])
console.log('captured', readdirSync(OUT + 'screenshots').join(', '), 'and demo.gif/demo.mp4')
