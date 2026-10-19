import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { hostname, homedir } from 'node:os'
import { createHmac } from 'node:crypto'

// The agent runs on this machine, so fixtures are plain files on disk.
const machine = hostname().toLowerCase()
const dir = `/tmp/rfs-e2e-${Date.now()}`
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// a non-root drive of this machine, read from the hub; tests that need one skip otherwise
let drive: { label: string; path: string } | undefined
let driveCount = 0 // drives across every machine with an agent (the fleet bar shows all of them)
const shots = process.env.SHOTS // directory for design-review screenshots
const shot = async (p: Page, name: string) => { if (shots) { await p.waitForTimeout(500); await p.screenshot({ path: `${shots}/${name}.png` }) } }

test.beforeAll(async () => {
  const ms = await (await fetch('http://127.0.0.1:7430/api/machines')).json() as { name: string; mounts: { label: string; path: string }[] }[]
  const me = ms.find(m => m.name === machine)
  driveCount = ms.reduce((a, m) => a + ((m as { agent?: boolean }).agent ? m.mounts.length : 0), 0)
  // this machine may have an access password; unlock it for the dev user when the suite is given it
  if (process.env.RFS_E2E_PASSWORD)
    await fetch(`http://127.0.0.1:7430/api/m/${machine}/unlock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: process.env.RFS_E2E_PASSWORD }) })
  // a previous run may have left a display name on this machine; tests assume the hostname
  await fetch(`http://127.0.0.1:7430/api/machines/${machine}/alias`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"alias":""}' })
  drive = me?.mounts.find(d => d.path !== '/')
  mkdirSync(`${dir}/sub`, { recursive: true })
  writeFileSync(`${dir}/hello.txt`, 'hello from fixture')
  writeFileSync(`${dir}/.hidden`, 'x')
  for (const f of ['notes.md', 'main.py', 'backup.zip', 'song.mp3', 'clip.mp4', 'report.pdf']) writeFileSync(`${dir}/${f}`, '')
  // 2x2 red PNG, enough for a thumbnail
  writeFileSync(`${dir}/dot.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8DwHwyBNAAw/gP+qkD1NQAAAABJRU5ErkJggg==', 'base64'))
})

test('landing shows this machine and its drives', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Good (morning|afternoon|evening)|Still up/)
  await expect(page.getByRole('heading', { name: 'Rack' })).toBeVisible()
  await expect(page.getByRole('main').getByText(machine, { exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Capacity by drive' }).getByRole('listitem')).toHaveCount(driveCount)
  test.skip(!drive, 'needs a non-root drive')
  await page.getByRole('main').getByRole('button', { name: new RegExp('^' + esc(drive!.label)) }).click()
  await expect(page).toHaveURL(`/m/${machine}${drive!.path}`)
  await page.goBack()
  await shot(page, '01-landing')
})

test('drive switcher reaches another drive from any page', async ({ page }) => {
  test.skip(!drive, 'needs a non-root drive')
  await page.goto(`/m/${machine}${dir}`)
  await page.getByRole('button', { name: machine, exact: false }).first().click()
  await page.getByRole('menuitem', { name: new RegExp(esc(drive!.label)) }).click()
  await expect(page).toHaveURL(`/m/${machine}${drive!.path}`)
  await expect(page.getByRole('button', { name: drive!.label, exact: true })).toHaveAttribute('aria-current', 'page')
})

test('browse, breadcrumbs, location edit, preview, hidden toggle', async ({ page }) => {
  await page.goto(`/m/${machine}${dir}`)
  const opts = page.getByRole('option')
  await expect(opts).toHaveCount(9) // sub + 8 files; .hidden filtered
  await expect(opts.first()).toHaveAccessibleName(/^sub\s/) // folders first
  await page.getByRole('button', { name: 'Show hidden files' }).click()
  await expect(opts).toHaveCount(10)
  await page.getByRole('button', { name: 'Hide hidden files' }).click()

  await page.getByRole('option', { name: /^sub\s/ }).click()
  await expect(page).toHaveURL(`/m/${machine}${dir}/sub`)
  await expect(page.getByText('Empty folder')).toBeVisible()
  // breadcrumb back up
  await page.getByRole('button', { name: dir.split('/').pop()!, exact: true }).click()
  await expect(page).toHaveURL(`/m/${machine}${dir}`)

  await page.getByRole('button', { name: 'Edit location' }).click()
  const loc = page.getByLabel('Location')
  await expect(loc).toHaveValue(`${machine}:${dir}`)
  await loc.fill(`${machine}:${dir}/sub`)
  await loc.press('Enter')
  await expect(page).toHaveURL(`/m/${machine}${dir}/sub`)
  await expect(page.getByText('Empty folder')).toBeVisible()
  await shot(page, '02-listing')

  await page.goto(`/m/${machine}${dir}`)
  await page.getByRole('option', { name: /^hello\.txt\s/ }).click()
  const details = page.getByRole('complementary')
  await expect(details.locator('pre')).toHaveText('hello from fixture')
  await expect(details.getByRole('link', { name: 'Download' })).toHaveAttribute('href', /dl=1/)
  await shot(page, '03-preview')
})

test('toolbar: new folder, sort, sidebar toggle, go to', async ({ page }) => {
  await page.goto(`/m/${machine}${dir}`)
  await page.getByRole('button', { name: /New folder/ }).click()
  await page.getByLabel('Folder name').fill('made-here')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('option', { name: /^made-here\s/ })).toBeVisible()
  // sort by size descending puts the biggest file first among files (folders stay first)
  await page.getByRole('button', { name: /Sort:/ }).click()
  await page.getByRole('menuitem', { name: 'Size' }).click()
  const files = page.getByRole('option').filter({ hasNotText: /^(sub|made-here)/ })
  await expect(files.first()).toHaveAccessibleName(/^dot\.png\s/) // 73 B is the largest fixture file
  await page.getByRole('button', { name: /Sort:/ }).click()
  await page.getByRole('menuitem', { name: 'Name' }).click()
  // sidebar collapses and comes back
  await expect(page.getByRole('navigation', { name: 'Machines' })).toBeVisible()
  await page.getByRole('button', { name: 'Hide sidebar' }).click()
  await expect(page.getByRole('navigation', { name: 'Machines' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Show sidebar' }).click()
  await expect(page.getByRole('navigation', { name: 'Machines' })).toBeVisible()
  // go to: '/' focuses the box, typing a drive label and Enter navigates
  await page.keyboard.press('/')
  await expect(page.getByLabel('Go to')).toBeFocused()
  await page.keyboard.type(`${machine}:${dir}/sub`)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(`/m/${machine}${dir}/sub`)
  // recent shows the fixture folder we came from
  await expect(page.getByRole('navigation', { name: 'Machines' }).getByRole('button', { name: new RegExp(dir.split('/').pop()!) })).toBeVisible()
})

test('multi-select and quick look', async ({ page }) => {
  await page.goto(`/m/${machine}${dir}`)
  await page.getByRole('option', { name: /^dot\.png\s/ }).click()
  await page.getByRole('option', { name: /^main\.py\s/ }).click({ modifiers: ['Shift'] })
  await expect(page.getByText('3 selected')).toBeVisible()
  await expect(page.getByRole('complementary').getByRole('heading', { name: '3 items selected' })).toBeVisible()
  await page.getByRole('option', { name: /^song\.mp3\s/ }).click({ modifiers: ['ControlOrMeta'] })
  await expect(page.getByText('4 selected')).toBeVisible()
  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByText('selected')).toHaveCount(0)

  await page.getByRole('option', { name: /^hello\.txt\s/ }).click()
  await page.getByRole('listbox', { name: 'Files' }).press('Space')
  const ql = page.getByRole('dialog', { name: 'Quick Look' })
  await expect(ql).toBeVisible()
  await expect(ql.locator('pre')).toHaveText('hello from fixture')
  await page.keyboard.press('ArrowRight')
  await expect(ql).toContainText('main.py')
  await page.keyboard.press('Escape')
  await expect(ql).toHaveCount(0)
})

test('zip download and cross-machine search', async ({ page }) => {
  await page.goto(`/m/${machine}${dir}`)
  // zip of a multi-selection
  await page.getByRole('option', { name: /^hello\.txt\s/ }).click()
  await page.getByRole('option', { name: /^notes\.md\s/ }).click({ modifiers: ['ControlOrMeta'] })
  const href = await page.getByRole('link', { name: 'Download zip' }).getAttribute('href')
  const zip = await page.request.get(href!)
  expect(zip.headers()['content-type']).toBe('application/zip')
  const body = await zip.body()
  expect(body.subarray(0, 2).toString()).toBe('PK')
  expect(body.includes(Buffer.from('hello.txt'))).toBe(true)
  expect(body.includes(Buffer.from('notes.md'))).toBe(true)
  expect(body.includes(Buffer.from('dot.png'))).toBe(false)
  // folder zip from the toolbar (shown when nothing is selected)
  await page.getByRole('button', { name: 'Clear' }).click()
  const folderZip = await page.request.get((await page.getByRole('link', { name: 'Download folder as zip' }).getAttribute('href'))!)
  expect(folderZip.headers()['content-disposition']).toContain(dir.split('/').pop()! + '.zip')

  // search from the Go to box lands on the file, selected
  const needle = 'rfs-e2e'
  await page.keyboard.press('Escape')
  await page.keyboard.press('/')
  await expect(page.getByLabel('Go to')).toBeFocused()
  await page.keyboard.type(needle)
  await page.getByRole('option', { name: /Search files for/ }).click()
  await expect(page).toHaveURL(/\/search\?q=rfs-e2e/)
  await expect(page.getByText(/Results for/)).toBeVisible()
  const hit = page.getByRole('list').getByRole('button', { name: new RegExp('^' + esc(dir.split('/').pop()!)) }).first()
  await expect(hit).toBeVisible({ timeout: 15000 })
  await hit.click()
  await expect(page).toHaveURL(`/m/${machine}${dir}`)
})

test('machine alias and pop-up preview', async ({ page }) => {
  await page.goto('/')
  const unit = page.locator(`.unit[data-machine="${machine}"]`)
  await unit.hover()
  await unit.getByRole('button', { name: /^Rename / }).click()
  await page.getByLabel('Display name').fill('Lab box')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(unit.getByText('Lab box')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Machines' }).getByText('Lab box')).toBeVisible()
  // clear it again so other tests see the hostname
  await unit.hover()
  await unit.getByRole('button', { name: /^Rename / }).click()
  await page.getByLabel('Display name').fill('')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(unit.getByText(machine, { exact: true })).toBeVisible()

  await page.goto(`/m/${machine}${dir}`)
  await page.getByRole('option', { name: /^dot\.png\s/ }).click()
  await page.getByRole('complementary').getByRole('button', { name: 'Open preview' }).click()
  await expect(page.getByRole('dialog', { name: 'Quick Look' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('option', { name: /^dot\.png\s/ }).dblclick()
  await expect(page.getByRole('dialog', { name: 'Quick Look' })).toBeVisible()
  await page.keyboard.press('Escape')
})

// RFC 6238 TOTP, 6 digits, SHA1, 30 s, from a base32 secret
function totp(secretB32: string, at = Date.now()): string {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secretB32.replace(/=+$/, '')) bits += alpha.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g)!.map(b => parseInt(b, 2)))
  const step = Buffer.alloc(8); step.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const h = createHmac('sha1', key).update(step).digest()
  const off = h[h.length - 1] & 0x0f
  return String((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

test('gear toggles security settings and returns to the previous page', async ({ page }) => {
  await page.goto(`/m/${machine}${dir}`)
  await page.getByRole('button', { name: 'Security settings' }).click()
  await expect(page).toHaveURL('/settings')
  await page.getByRole('button', { name: 'Close security settings' }).click()
  await expect(page).toHaveURL(`/m/${machine}${dir}`)
  // opened directly, the second click goes home instead of leaving the site
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Close security settings' }).click()
  await expect(page).toHaveURL('/')
})

test('installable web app: manifest, service worker, install prompt', async ({ page, request, browser }) => {
  const res = await request.get('/manifest.webmanifest')
  expect(res.headers()['content-type']).toContain('application/manifest+json')
  const mf = await res.json()
  expect(mf.display).toBe('standalone')
  const sizes = mf.icons.map((i: { sizes: string; purpose?: string }) => i.sizes + ':' + (i.purpose ?? 'any'))
  expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']))
  for (const i of mf.icons) expect((await request.get(i.src)).ok()).toBe(true)
  expect((await request.get('/sw.js')).headers()['cache-control']).toBe('no-cache')
  await page.goto('/')
  await expect(page.locator('link[rel=manifest]')).toHaveAttribute('crossorigin', 'use-credentials')
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active), { timeout: 10000 }).toBe(true)

  // Android-style: the browser fires beforeinstallprompt; our button calls prompt()
  const android = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const a = await android.newPage()
  await a.goto('/')
  await a.evaluate(() => {
    const e = new Event('beforeinstallprompt') as Event & Record<string, unknown>
    e.prompt = () => { (window as unknown as Record<string, boolean>).__prompted = true; return Promise.resolve() }
    e.userChoice = Promise.resolve({ outcome: 'accepted' })
    dispatchEvent(e)
  })
  const strip = a.getByRole('region', { name: 'Install the app' })
  await expect(strip).toBeVisible()
  await shot(a, '10-install-android')
  await strip.getByRole('button', { name: 'Install' }).click()
  await expect.poll(() => a.evaluate(() => (window as unknown as Record<string, boolean>).__prompted)).toBe(true)
  await expect(strip).toHaveCount(0)
  await android.close()

  // iOS-style: no event; instructions, and "Not now" snoozes it
  const ios = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' })
  const i = await ios.newPage()
  await i.goto('/')
  const hint = i.getByRole('region', { name: 'Install the app' })
  await expect(hint).toContainText('Add to Home Screen')
  await shot(i, '11-install-ios')
  await hint.getByRole('button', { name: 'Not now' }).click()
  await expect(hint).toHaveCount(0)
  await i.reload()
  await expect(i.getByRole('heading', { name: 'Rack' })).toBeVisible()
  await expect(hint).toHaveCount(0)
  await ios.close()
})

test('account menu shows the user and signs out', async ({ page, context }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /^Account/ }).click()
  await expect(page.getByRole('menu')).toContainText('hironmoy5458@gmail.com')
  await context.addCookies([{ name: 'rfs_otp', value: 'x', url: 'http://127.0.0.1:7430' }])
  const done = page.waitForResponse(r => r.url().endsWith('/api/logout'))
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  expect((await done).status()).toBe(200)
  await expect(page).toHaveURL('/') // dev hub has no Access; production goes to /cdn-cgi/access/logout
  expect((await context.cookies()).find(c => c.name === 'rfs_otp')).toBeUndefined()
})

test('two-step verification: enrol, gate, verify, disable', async ({ page, context }) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible()
  await page.getByRole('button', { name: /Set up with an authenticator app/ }).click()
  const secret = (await page.locator('code').first().textContent())!.trim()
  await expect(page.getByAltText(/QR code/)).toBeVisible()
  await page.locator('#otp-confirm').fill(totp(secret))
  await page.getByRole('button', { name: 'Confirm and turn on' }).click()
  await expect(page.getByText(/^On\./)).toBeVisible()
  // this browser got the cookie; a fresh context is gated
  const fresh = await context.browser()!.newContext({ viewport: { width: 1280, height: 800 } })
  const p2 = await fresh.newPage()
  await p2.goto('/')
  const gate = p2.getByRole('dialog', { name: 'Two-step verification' })
  await expect(gate).toBeVisible()
  await p2.locator('#otp-code').fill('000000')
  await p2.getByRole('button', { name: 'Verify' }).click()
  await expect(gate.getByRole('alert')).toBeVisible()
  await p2.waitForTimeout(31_000) // the enrolment code's time step is burned; wait for the next
  await p2.locator('#otp-code').fill(totp(secret))
  await p2.getByRole('button', { name: 'Verify' }).click()
  await expect(p2.getByRole('heading', { name: 'Rack' })).toBeVisible({ timeout: 15000 })
  await fresh.close()
  // disable with a fresh code so later tests run ungated
  await page.waitForTimeout(31_000)
  await page.getByRole('button', { name: 'Turn off' }).click()
  await page.locator('#otp-disable').fill(totp(secret))
  await page.getByRole('button', { name: 'Turn off' }).last().click()
  await expect(page.getByText(/^Off\./)).toBeVisible()
})

test('machine access password', async ({ page }) => {
  const pw = process.env.RFS_E2E_PASSWORD
  test.skip(!pw, 'set RFS_E2E_PASSWORD to the access password of this machine')
  await page.goto(`/m/${machine}${dir}`)
  await page.getByLabel('Password for this machine').fill('definitely-wrong')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('alert')).toContainText(/wrong/i)
  await page.getByLabel('Password for this machine').fill(pw!)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await expect(page.getByRole('option', { name: /^hello\.txt\s/ })).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: /^Lock / }).click()
  await expect(page).toHaveURL('/')
})

test('grid view shows thumbnails', async ({ page }) => {
  await page.goto(`/m/${machine}${dir}`)
  await page.getByRole('button', { name: 'Grid view' }).click()
  const img = page.getByRole('option', { name: /dot\.png/ }).locator('img')
  await expect(img).toHaveClass(/ok/)
  await page.goto(`/m/${machine}${homedir()}/Pictures/Screenshots`)
  await expect(page.getByRole('option').first()).toBeVisible()
  await page.waitForTimeout(1500)
  await shot(page, '04-grid')
  await page.getByRole('button', { name: 'List view' }).click()
})

test('upload, rename, delete to trash', async ({ page }) => {
  await page.goto(`/m/${machine}${dir}/sub`)
  await expect(page.getByText('Empty folder')).toBeVisible()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await (await chooser).setFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello from playwright') })
  await expect(page.getByRole('region', { name: 'Transfers' })).toContainText('Uploaded 1 file')
  await expect(page.getByRole('option', { name: /^note\.txt\s/ })).toBeVisible()
  expect(readFileSync(`${dir}/sub/note.txt`, 'utf8')).toBe('hello from playwright')
  await shot(page, '05-upload')

  await page.getByRole('option', { name: /^note\.txt\s/ }).click()
  await page.getByRole('button', { name: 'Rename' }).click()
  await page.getByLabel('New name').fill('renamed.txt')
  await page.getByLabel('New name').press('Enter')
  await expect(page.getByRole('option', { name: /^renamed\.txt\s/ })).toBeVisible()

  await page.getByRole('option', { name: /^renamed\.txt\s/ }).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Move to trash' }).click()
  await expect(page.getByRole('option')).toHaveCount(0)
  expect(readdirSync(`${homedir()}/.local/share/rfs/trash`).some(n => n.endsWith('-renamed.txt'))).toBe(true)
})

test('mobile: drawer, listing, bottom sheet', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.goto('/')
  await shot(page, '06-mobile-landing')
  await page.getByRole('button', { name: 'Show sidebar' }).click()
  await expect(page.getByRole('dialog', { name: 'Machines' })).toBeVisible()
  await shot(page, '07-mobile-drawer')
  const first = page.getByRole('dialog').locator(`[data-machine="${machine}"]`).getByRole('button', { name: /\d+%/ }).first()
  await first.click()
  await expect(page).toHaveURL(new RegExp(`/m/${machine}/`))
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.goto(`/m/${machine}${dir}`)
  await expect(page.getByRole('option', { name: /^hello\.txt\s/ })).toBeVisible()
  await shot(page, '08-mobile-listing')
  await page.getByRole('option', { name: /^hello\.txt\s/ }).click()
  await expect(page.getByRole('dialog', { name: 'File' })).toBeVisible()
  await expect(page.getByRole('dialog').locator('pre')).toHaveText('hello from fixture')
  await shot(page, '09-mobile-sheet')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Folder details' }).click()
  await expect(page.getByRole('dialog', { name: 'Folder' })).toBeVisible()
  await ctx.close()
})
