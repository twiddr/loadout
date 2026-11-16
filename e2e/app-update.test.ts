import {
  _electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { extname, join } from 'node:path'
import type { MessageBoxOptions } from 'electron'
import type { LoadoutApi, Result, State } from '../src/core/ipc'
import { INSTALL_COMMAND, plistString, releaseNotesUrl } from '../src/core/release'
import { tinyApp, tinyDmg } from '../tests/support/tiny-app'
import { fakeHome } from './support/fake-home'

declare const window: { loadout: LoadoutApi }

const ROOT = join(__dirname, '..')
/** The installed version: `__APP_VERSION__` is `package.json`'s version in e2e. */
const CURRENT: string = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
const OFFLINE = 'curl: (6) Could not resolve host: github.com'

/** The patch plus one. */
export function nextVersion(v: string): string {
  const [major, minor, patch] = v.split('.').map(Number)
  return `${major}.${minor}.${patch + 1}`
}

/** A release lower than `v`. */
export function lowerVersion(v: string): string {
  const [major, minor, patch] = v.split('.').map(Number)
  if (patch > 0) return `${major}.${minor}.${patch - 1}`
  if (minor > 0) return `${major}.${minor - 1}.0`
  return `${major - 1}.0.0`
}

/** What the fake `curl` prints when `/releases/latest` redirects to the tag of `version`. */
function latestRelease(version: string): string {
  return `302 https://github.com/twiddr/loadout/releases/tag/v${version}`
}

function launch(home: string, env: Record<string, string>): Promise<ElectronApplication> {
  return _electron.launch({
    args: [`--user-data-dir=${join(home, 'electron-data')}`, join(ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, ...env } as Record<string, string>
  })
}

/** Clicks Loadout › Check for Updates… in main. */
export async function clickMenuCheck(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()!
      .items[0].submenu!.items.find((i) => i.label === 'Check for Updates…')!
      .click()
  })
}

/** Replaces `dialog.showMessageBox` with a stub; the reader returns the options of every box asked for. */
export async function stubMessageBox(
  app: ElectronApplication
): Promise<() => Promise<MessageBoxOptions[]>> {
  await app.evaluate(({ dialog }) => {
    const boxes: unknown[] = []
    ;(globalThis as { boxes?: unknown[] }).boxes = boxes
    dialog.showMessageBox = (async (...args: unknown[]) => {
      boxes.push(args[args.length - 1])
      return { response: 0, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  })
  return () => app.evaluate(() => (globalThis as { boxes?: MessageBoxOptions[] }).boxes ?? [])
}

function ready(page: Page): Promise<void> {
  return expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
    timeout: 10000
  })
}

async function appUpdate(page: Page): Promise<State['appUpdate']> {
  const reply = await page.evaluate(() => window.loadout.invoke('get-state'))
  if (!reply.ok) throw new Error(reply.message)
  return reply.state.appUpdate
}

function curlCalls(home: string): string[] {
  const file = join(home, 'curl-calls')
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []
}

const upToDate = {
  type: 'info',
  message: 'Loadout is up to date.',
  detail: `You have ${CURRENT}, the latest release.`,
  buttons: ['OK']
}

test('failed launch check writes one Log line', async () => {
  const { home, env } = fakeHome()
  writeFileSync(join(home, 'latest-release.err'), `${OFFLINE}\n`)
  const app = await launch(home, { ...env, LOADOUT_UPDATE_CHECK: '1' })
  try {
    const page = await app.firstWindow()
    await ready(page)
    await expect.poll(() => curlCalls(home).length).toBe(1)
    await page.getByRole('link', { name: 'Log' }).click()
    const card = page.getByRole('article', { name: /^Run \d+$/ })
    await expect(card).toHaveCount(1)
    await expect(card.getByText('APP-UPDATE', { exact: true })).toBeVisible()
    await expect(card.getByText(`Update check failed: ${OFFLINE}`, { exact: true })).toBeVisible()
    await expect(page.locator('.app-update')).toHaveCount(0)
    await expect(page.locator('p.notice')).toHaveCount(0)
    expect(await appUpdate(page)).toBeNull()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('menu check: up to date', async () => {
  const { home, env } = fakeHome()
  writeFileSync(join(home, 'latest-release'), latestRelease(CURRENT))
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    const boxes = await stubMessageBox(app)
    await clickMenuCheck(app)
    await expect.poll(boxes).toEqual([upToDate])
    // The settled check is cleared: a second click runs a second curl and answers again.
    await clickMenuCheck(app)
    await expect.poll(boxes).toEqual([upToDate, upToDate])
    expect(curlCalls(home)).toEqual(['run', 'run'])
    await page.getByRole('link', { name: 'Log' }).click()
    await expect(page.getByRole('article', { name: /^Run \d+$/ })).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('menu check: failure', async () => {
  const { home, env } = fakeHome()
  writeFileSync(join(home, 'latest-release.err'), `${OFFLINE}\n`)
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    const boxes = await stubMessageBox(app)
    await clickMenuCheck(app)
    await expect
      .poll(boxes)
      .toEqual([
        { type: 'warning', message: 'The update check failed.', detail: OFFLINE, buttons: ['OK'] }
      ])
    await page.getByRole('link', { name: 'Log' }).click()
    await expect(page.getByRole('article', { name: /^Run \d+$/ })).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('menu check joins the running check', async () => {
  const { home, env } = fakeHome()
  writeFileSync(join(home, 'latest-release.sleep'), '4')
  writeFileSync(join(home, 'latest-release'), latestRelease(CURRENT))
  const app = await launch(home, { ...env, LOADOUT_UPDATE_CHECK: '1' })
  try {
    const page = await app.firstWindow()
    const boxes = await stubMessageBox(app)
    // The launch check sleeps 4 s in the fake curl; both clicks land inside it.
    await expect.poll(() => curlCalls(home).length).toBe(1)
    await clickMenuCheck(app)
    await clickMenuCheck(app)
    await expect.poll(boxes, { timeout: 10000 }).toEqual([upToDate, upToDate])
    expect(curlCalls(home)).toEqual(['run'])
    await ready(page)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('menu check during MUSTERING', async () => {
  const { home, env } = fakeHome()
  writeFileSync(join(home, 'latest-release'), latestRelease(CURRENT))
  const app = await launch(home, { ...env, FAKE_WHOAMI_SLEEP: '3' })
  try {
    const page = await app.firstWindow()
    const mustering = page.locator('.rail-status', { hasText: /^MUSTERING$/ })
    await expect(mustering).toBeVisible()
    const boxes = await stubMessageBox(app)
    await clickMenuCheck(app)
    await expect.poll(boxes).toEqual([upToDate])
    // Read once, without retries: the box came while the startup check still ran.
    expect(await mustering.count()).toBe(1)
    await ready(page)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('one check per launch', async () => {
  const next = nextVersion(CURRENT)
  // Without the switch an unpackaged app makes no launch check.
  {
    const { home, env } = fakeHome()
    writeFileSync(join(home, 'latest-release'), latestRelease(next))
    const app = await launch(home, env)
    try {
      const page = await app.firstWindow()
      await ready(page)
      await page.waitForTimeout(1000)
      expect(existsSync(join(home, 'curl-calls'))).toBe(false)
      expect(await appUpdate(page)).toBeNull()
    } finally {
      await app.close()
      rmSync(home, { recursive: true, force: true })
    }
  }
  // With it: one check after READY, and a Refresh starts no second one.
  {
    const { home, env } = fakeHome()
    writeFileSync(join(home, 'latest-release'), latestRelease(next))
    const app = await launch(home, { ...env, LOADOUT_UPDATE_CHECK: '1', FAKE_WHOAMI_SLEEP: '1' })
    try {
      const page = await app.firstWindow()
      await ready(page)
      await expect.poll(async () => (await appUpdate(page))?.latest).toBe(next)
      expect(curlCalls(home)).toEqual(['run'])
      await later(page)
      await page.getByRole('button', { name: 'Refresh' }).click()
      await expect(page.locator('.rail-status', { hasText: /^MUSTERING$/ })).toBeVisible()
      await ready(page)
      await page.waitForTimeout(1000)
      expect(curlCalls(home)).toEqual(['run'])
    } finally {
      await app.close()
      rmSync(home, { recursive: true, force: true })
    }
  }
})

test('quit during a check', async () => {
  const { home, env } = fakeHome()
  writeFileSync(join(home, 'latest-release.sleep'), '30')
  const app = await launch(home, { ...env, LOADOUT_UPDATE_CHECK: '1' })
  const fakeCurl = join(home, 'fakebin', 'curl')
  const alive = (): boolean => {
    try {
      execFileSync('/usr/bin/pgrep', ['-f', fakeCurl])
      return true
    } catch {
      return false
    }
  }
  try {
    await app.firstWindow()
    await expect.poll(() => curlCalls(home).length, { timeout: 10000 }).toBe(1)
    expect(alive()).toBe(true)
    const started = Date.now()
    await app.close()
    expect(Date.now() - started).toBeLessThan(5000)
    // The quit stopped the check's child, which runs in its own process group.
    await expect.poll(alive).toBe(false)
  } finally {
    await app.close()
    try {
      execFileSync('/usr/bin/pkill', ['-f', fakeCurl])
    } catch {
      // Nothing left to stop.
    }
    rmSync(home, { recursive: true, force: true })
  }
})

function updateButton(page: Page, version: string): Locator {
  return page.getByRole('button', { name: `Update to ${version}`, exact: true })
}

function updatePrompt(page: Page): Locator {
  return page.locator('dialog.update-prompt')
}

/** The prompt that a launch check with a newer release opens over the page: wait for it, then LATER. */
async function later(page: Page): Promise<void> {
  const prompt = updatePrompt(page)
  await expect(prompt).toBeVisible({ timeout: 10000 })
  await prompt.getByRole('button', { name: 'LATER', exact: true }).click()
  await expect(prompt).toBeHidden()
}

test('corner with a newer release', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = fakeHome()
  writeFileSync(join(home, 'latest-release'), latestRelease(next))
  const app = await launch(home, { ...env, LOADOUT_UPDATE_CHECK: '1' })
  try {
    const page = await app.firstWindow()
    await ready(page)
    await expect(updateButton(page, next)).toBeVisible()
    await expect(updateButton(page, next)).toHaveText('UPDATE›')
    await expect(page.locator('.app-version')).toHaveText(`${CURRENT} → ${next}`)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('corner without a newer release', async () => {
  for (const latest of [CURRENT, lowerVersion(CURRENT)]) {
    const { home, env } = fakeHome()
    writeFileSync(join(home, 'latest-release'), latestRelease(latest))
    const app = await launch(home, { ...env, LOADOUT_UPDATE_CHECK: '1' })
    try {
      const page = await app.firstWindow()
      await ready(page)
      await expect.poll(() => curlCalls(home).length).toBe(1)
      await page.waitForTimeout(500)
      await expect(page.locator('.app-version')).toHaveText(CURRENT)
      await expect(page.getByRole('button', { name: /^Update to/ })).toHaveCount(0)
      await expect(updatePrompt(page)).toBeHidden()
    } finally {
      await app.close()
      rmSync(home, { recursive: true, force: true })
    }
  }
})

test('prompt after the launch check', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = fakeHome()
  writeFileSync(join(home, 'latest-release'), latestRelease(next))
  const app = await launch(home, { ...env, LOADOUT_UPDATE_CHECK: '1' })
  try {
    const page = await app.firstWindow()
    await ready(page)
    const prompt = updatePrompt(page)
    await expect(prompt).toBeVisible({ timeout: 10000 })
    await expect(prompt).toContainText(`LOADOUT ${CURRENT}`)
    await expect(prompt).toContainText(`Loadout ${next} is out.`)
    const notes = prompt.getByRole('link', { name: 'RELEASE NOTES' })
    await expect(notes).toHaveAttribute('href', releaseNotesUrl(next))
    await expect(prompt.locator('.actions button')).toHaveText(['LATER', 'UPDATE'])
    await expect(prompt.getByRole('button', { name: 'UPDATE', exact: true })).toBeFocused()
    await prompt.getByRole('button', { name: 'LATER', exact: true }).click()
    await expect(prompt).toBeHidden()
    await expect(page.locator('dialog.update')).toBeHidden()
    await expect(updateButton(page, next)).toBeVisible()
    expect(await appUpdate(page)).toMatchObject({ latest: next, stage: 'offered' })
    expect(curlCalls(home)).toEqual(['run'])
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('prompt: Escape is LATER', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = fakeHome()
  writeFileSync(join(home, 'latest-release'), latestRelease(next))
  const app = await launch(home, { ...env, LOADOUT_UPDATE_CHECK: '1' })
  try {
    const page = await app.firstWindow()
    await ready(page)
    const prompt = updatePrompt(page)
    await expect(prompt).toBeVisible({ timeout: 10000 })
    await page.keyboard.press('Escape')
    await expect(prompt).toBeHidden()
    await expect(page.locator('dialog.update')).toBeHidden()
    await expect(updateButton(page, next)).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('no prompt after a menu check', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = fakeHome()
  writeFileSync(join(home, 'latest-release'), latestRelease(next))
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    await clickMenuCheck(app)
    await expect(page.locator('dialog.update')).toBeVisible()
    await page.waitForTimeout(500)
    await expect(updatePrompt(page)).toBeHidden()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('no prompt over another dialog', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = fakeHome()
  writeFileSync(join(home, 'latest-release.sleep'), '3')
  writeFileSync(join(home, 'latest-release'), latestRelease(next))
  const app = await launch(home, { ...env, LOADOUT_UPDATE_CHECK: '1' })
  try {
    const page = await app.firstWindow()
    await ready(page)
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Settings' })
      .click()
    await expect(page.locator('dialog.settings')).toBeVisible()
    await expect(updateButton(page, next)).toBeVisible({ timeout: 10000 })
    await page.waitForTimeout(500)
    await expect(updatePrompt(page)).toBeHidden()
    await expect(page.locator('dialog.settings')).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('dialog and COPY', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = fakeHome()
  writeFileSync(join(home, 'latest-release'), latestRelease(next))
  const app = await launch(home, { ...env, LOADOUT_UPDATE_CHECK: '1' })
  try {
    const page = await app.firstWindow()
    await ready(page)
    // The main handler is replaced, so the test never writes the real macOS clipboard.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('copy-text')
      ipcMain.handle('copy-text', (_event, { text }: { text: string }) => {
        ;(globalThis as unknown as { copied: string }).copied = text
        return { ok: true }
      })
    })
    await later(page)
    const dialog = page.locator('dialog.update')
    await expect(dialog).toBeHidden()
    await updateButton(page, next).click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(`LOADOUT ${CURRENT}`)
    await expect(dialog).toContainText(`Loadout ${next} is out.`)
    const notes = dialog.getByRole('link', { name: 'RELEASE NOTES' })
    await expect(notes).toHaveAttribute('href', releaseNotesUrl(next))
    await expect(dialog.locator('.bc-cmd pre')).toHaveText(INSTALL_COMMAND)
    for (const step of [
      'In Terminal, run:',
      'Quit Loadout.',
      'Open Loadout.dmg in Downloads, drag Loadout to Applications and replace the old copy, then eject the Loadout disk.',
      'Start Loadout.'
    ]) {
      await expect(dialog).toContainText(step)
    }
    const copy = dialog.getByRole('button', { name: 'Copy the command' })
    await expect(copy).toBeFocused()
    await copy.click()
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { copied?: string }).copied))
      .toBe(INSTALL_COMMAND)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toBeHidden()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('menu check opens the dialog', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = fakeHome()
  writeFileSync(join(home, 'latest-release'), latestRelease(next))
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    const boxes = await stubMessageBox(app)
    await expect(page.locator('dialog.update')).toBeHidden()
    await clickMenuCheck(app)
    await expect(page.locator('dialog.update')).toBeVisible()
    await expect(updateButton(page, next)).toBeVisible()
    expect(await boxes()).toEqual([])
    await page.locator('dialog.update').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('dialog.update')).toBeHidden()
    await page.getByRole('link', { name: 'Log' }).click()
    await expect(page.getByRole('article', { name: /^Run \d+$/ })).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('the marker stays after a failed menu check', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = fakeHome()
  writeFileSync(join(home, 'latest-release'), latestRelease(next))
  const app = await launch(home, { ...env, LOADOUT_UPDATE_CHECK: '1' })
  try {
    const page = await app.firstWindow()
    await ready(page)
    await expect(updateButton(page, next)).toBeVisible()
    await later(page)
    const boxes = await stubMessageBox(app)
    writeFileSync(join(home, 'latest-release.err'), `${OFFLINE}\n`)
    await clickMenuCheck(app)
    await expect(page.locator('dialog.update')).toBeVisible()
    expect(curlCalls(home)).toEqual(['run', 'run'])
    expect(await boxes()).toEqual([])
    await expect(updateButton(page, next)).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('the app is usable while the check runs', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = fakeHome()
  writeFileSync(join(home, 'latest-release.sleep'), '5')
  writeFileSync(join(home, 'latest-release'), latestRelease(next))
  const app = await launch(home, { ...env, LOADOUT_UPDATE_CHECK: '1' })
  try {
    const page = await app.firstWindow()
    await ready(page)
    await expect.poll(() => curlCalls(home).length).toBe(1)
    // The fake curl sleeps 5 s: the toggle runs while the check is in flight.
    const probe = page.getByRole('checkbox', { name: 'probe Claude Code', exact: true })
    await expect(probe).toBeChecked()
    await probe.click()
    await expect(probe).not.toBeChecked()
    expect(await appUpdate(page)).toBeNull()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible()
    await expect(updateButton(page, next)).toBeVisible({ timeout: 10000 })
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

/** A tiny app at `version` as the fake `curl`'s download, with its size in the header dump. */
function releaseDmg(home: string, version: string): void {
  const source = join(home, `release-${version}`)
  rmSync(join(home, 'release.dmg'), { force: true })
  const tiny = tinyApp(source, { version, marker: join(home, 'marker') })
  tinyDmg(tiny, join(home, 'release.dmg'))
  const size = statSync(join(home, 'release.dmg')).size
  writeFileSync(join(home, 'release-headers'), `HTTP/1.1 200 OK\r\ncontent-length: ${size}\r\n\r\n`)
}

/**
 * `fakeHome()` with the launch check on and a newer release: its DMG (a tiny app at the next
 * version) as the download and, unless `bundle` is false, a tiny app at the current version in
 * `<home>/Applications/Loadout.app` as the bundle the update replaces.
 */
function updateHome(options: { bundle?: boolean } = {}): {
  home: string
  env: Record<string, string>
} {
  const { home, env } = fakeHome()
  const next = nextVersion(CURRENT)
  writeFileSync(join(home, 'latest-release'), latestRelease(next))
  releaseDmg(home, next)
  if (options.bundle === false) return { home, env: { ...env, LOADOUT_UPDATE_CHECK: '1' } }
  const apps = join(home, 'Applications')
  tinyApp(apps, { version: CURRENT, marker: join(home, 'marker') })
  return {
    home,
    env: { ...env, LOADOUT_UPDATE_CHECK: '1', LOADOUT_UPDATE_BUNDLE: join(apps, 'Loadout.app') }
  }
}

type UpdateChannel = 'update-download' | 'update-cancel' | 'update-restart'

function invoke(page: Page, channel: UpdateChannel): Promise<Result> {
  return page.evaluate((c) => window.loadout.invoke(c as 'update-download'), channel)
}

async function stage(page: Page): Promise<string | undefined> {
  return (await appUpdate(page))?.stage
}

/** The `.loadout-update-*` folders beside the bundle. */
function updateFolders(home: string): string[] {
  const apps = join(home, 'Applications')
  if (!existsSync(apps)) return []
  return readdirSync(apps)
    .filter((name) => name.startsWith('.loadout-update-'))
    .map((name) => join(apps, name))
}

/** The version of the bundle at the install path, or null when there is none. */
function bundleVersion(home: string): string | null {
  const plist = join(home, 'Applications', 'Loadout.app', 'Contents', 'Info.plist')
  return existsSync(plist)
    ? plistString(readFileSync(plist, 'utf8'), 'CFBundleShortVersionString')
    : null
}

function logLine(page: Page, text: string): Locator {
  return page.getByRole('article', { name: /^Run \d+$/ }).getByText(text, { exact: true })
}

/** DOWNLOAD from `offered`, then wait for `ready`. */
async function reachReady(page: Page): Promise<void> {
  await expect.poll(() => stage(page)).toBe('offered')
  expect(await invoke(page, 'update-download')).toEqual({ ok: true })
  await expect.poll(() => stage(page), { timeout: 30000 }).toBe('ready')
}

test('download reaches ready', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = updateHome()
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    await later(page)
    await reachReady(page)
    expect(await appUpdate(page)).toEqual({
      latest: next,
      replace: { ok: true },
      stage: 'ready',
      percent: null,
      message: null
    })
    const folders = updateFolders(home)
    expect(folders).toHaveLength(1)
    expect(existsSync(join(folders[0], 'new', 'Loadout.app'))).toBe(true)
    expect(bundleVersion(home)).toBe(CURRENT)
    await page.getByRole('link', { name: 'Log' }).click()
    await expect(logLine(page, `Update ${next} is ready.`)).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('prompt: UPDATE starts the download', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = updateHome()
  writeFileSync(join(home, 'download.sleep'), '2')
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    const prompt = updatePrompt(page)
    await expect(prompt).toBeVisible({ timeout: 10000 })
    await prompt.getByRole('button', { name: 'UPDATE', exact: true }).click()
    await expect(prompt).toBeHidden()
    const dialog = page.locator('dialog.update')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.update-progress')).toContainText(`DOWNLOADING ${next}`)
    await expect(dialog.locator('.update-progress')).toContainText(`${next} IS READY`, {
      timeout: 30000
    })
    expect(curlCalls(home).filter((call) => call === 'download')).toEqual(['download'])
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('prompt: UPDATE when Loadout cannot write', async () => {
  const { home, env } = updateHome({ bundle: false })
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    const prompt = updatePrompt(page)
    await expect(prompt).toBeVisible({ timeout: 10000 })
    await prompt.getByRole('button', { name: 'UPDATE', exact: true }).click()
    await expect(prompt).toBeHidden()
    const dialog = page.locator('dialog.update')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('details.update-hand')).toHaveAttribute('open')
    await page.waitForTimeout(500)
    expect(curlCalls(home)).toEqual(['run'])
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('a second download is refused', async () => {
  const { home, env } = updateHome()
  writeFileSync(join(home, 'download.sleep'), '3')
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    await expect.poll(() => stage(page)).toBe('offered')
    const running = { ok: false, message: 'The update is already running.' }
    expect(await invoke(page, 'update-download')).toEqual({ ok: true })
    expect(await invoke(page, 'update-download')).toEqual(running)
    await expect.poll(() => stage(page), { timeout: 30000 }).toBe('ready')
    expect(await invoke(page, 'update-download')).toEqual(running)
    expect(curlCalls(home).filter((call) => call === 'download')).toEqual(['download'])
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('failed download', async () => {
  const err = 'curl: (22) The requested URL returned error: 404'
  const { home, env } = updateHome()
  writeFileSync(join(home, 'download.err'), `${err}\n`)
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    await later(page)
    await expect.poll(() => stage(page)).toBe('offered')
    expect(await invoke(page, 'update-download')).toEqual({ ok: true })
    await expect
      .poll(() => appUpdate(page), { timeout: 30000 })
      .toMatchObject({ stage: 'failed', message: err })
    expect(updateFolders(home)).toEqual([])
    await page.getByRole('link', { name: 'Log' }).click()
    await expect(logLine(page, `Update failed: ${err}`)).toBeVisible()
    // TRY AGAIN, with the download fixed.
    rmSync(join(home, 'download.err'))
    expect(await invoke(page, 'update-download')).toEqual({ ok: true })
    await expect
      .poll(() => appUpdate(page), { timeout: 30000 })
      .toMatchObject({ stage: 'ready', message: null })
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('failed check', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = updateHome()
  releaseDmg(home, CURRENT)
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    await expect.poll(() => stage(page)).toBe('offered')
    expect(await invoke(page, 'update-download')).toEqual({ ok: true })
    await expect
      .poll(() => appUpdate(page), { timeout: 30000 })
      .toMatchObject({ stage: 'failed', message: `the downloaded app is ${CURRENT}, not ${next}.` })
    expect(updateFolders(home)).toEqual([])
    expect(bundleVersion(home)).toBe(CURRENT)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('cancel', async () => {
  const { home, env } = updateHome()
  writeFileSync(join(home, 'download.sleep'), '10')
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    await later(page)
    await expect.poll(() => stage(page)).toBe('offered')
    expect(await invoke(page, 'update-download')).toEqual({ ok: true })
    await expect.poll(() => curlCalls(home)).toContain('download')
    expect(await stage(page)).toBe('downloading')
    expect(await invoke(page, 'update-cancel')).toEqual({ ok: true })
    // The fake curl sleeps 10 s: back to `offered` well before, so the cancel stopped it.
    await expect.poll(() => stage(page), { timeout: 5000 }).toBe('offered')
    expect(updateFolders(home)).toEqual([])
    await page.getByRole('link', { name: 'Log' }).click()
    await expect(logLine(page, 'Update cancelled.')).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('cannot write', async () => {
  const { home, env } = updateHome({ bundle: false })
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    await expect
      .poll(async () => (await appUpdate(page))?.replace)
      .toEqual({ ok: false, reason: 'Loadout is not running from an app bundle.' })
    expect(await invoke(page, 'update-download')).toEqual({
      ok: false,
      message: 'Loadout cannot replace itself here.'
    })
    expect(curlCalls(home)).toEqual(['run'])
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('the refused restart', async () => {
  const { home, env } = updateHome()
  // The fake git's fetch sleeps 5 s in a clone path with `slow`: a Check on it holds a command.
  const clone = join(home, '.loadout', 'repos', 'acme', 'slow', 'skills', 's')
  mkdirSync(clone, { recursive: true })
  writeFileSync(join(clone, 'SKILL.md'), '---\nname: probe-slow\ndescription: A probe.\n---\n')
  symlinkSync(clone, join(home, '.loadout', 'skills', 'probe-slow'))
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    await expect.poll(() => stage(page)).toBe('offered')
    expect(await invoke(page, 'update-restart')).toEqual({
      ok: false,
      message: 'The update is not ready.'
    })
    await reachReady(page)
    void page.evaluate(() => window.loadout.invoke('check', { skill: 'probe-slow' }))
    const busy = page.locator('.rail-status', { hasText: /^BUSY$/ })
    await expect(busy).toBeVisible()
    expect(await invoke(page, 'update-restart')).toEqual({
      ok: false,
      message: 'Another command is running.'
    })
    await expect(busy).toBeHidden({ timeout: 10000 })
    expect(await stage(page)).toBe('ready')
    expect(bundleVersion(home)).toBe(CURRENT)
    expect(existsSync(join(home, 'marker'))).toBe(false)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('restart when idle', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = updateHome()
  const marker = join(home, 'marker')
  const app = await launch(home, env)
  // The app exits on purpose after RESTART; it is closed here only when the test fails before.
  let restarted = false
  try {
    const page = await app.firstWindow()
    await ready(page)
    await reachReady(page)
    const [folder] = updateFolders(home)
    const closed = new Promise<void>((resolve) => app.once('close', () => resolve()))
    restarted = true
    // The reply can lose the race with the quit.
    void invoke(page, 'update-restart').catch(() => undefined)
    await closed
    await expect.poll(() => bundleVersion(home), { timeout: 10000 }).toBe(next)
    // The new executable started with the old app's arguments.
    await expect
      .poll(() => (existsSync(marker) ? readFileSync(marker, 'utf8') : ''))
      .toContain(`started ${next} --user-data-dir=${join(home, 'electron-data')}`)
    expect(readFileSync(marker, 'utf8')).not.toContain(`started ${CURRENT}`)
    const log = readFileSync(join(folder, 'swap.log'), 'utf8').trim().split('\n')
    expect(log[log.length - 1]).toBe('DONE')
  } finally {
    if (!restarted) await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('quit during a download', async () => {
  const { home, env } = updateHome()
  writeFileSync(join(home, 'download.sleep'), '30')
  const app = await launch(home, env)
  const fakeCurl = join(home, 'fakebin', 'curl')
  try {
    const page = await app.firstWindow()
    await ready(page)
    await expect.poll(() => stage(page)).toBe('offered')
    expect(await invoke(page, 'update-download')).toEqual({ ok: true })
    await expect.poll(() => curlCalls(home)).toContain('download')
    const started = Date.now()
    await app.close()
    expect(Date.now() - started).toBeLessThan(5000)
  } finally {
    await app.close()
    try {
      execFileSync('/usr/bin/pkill', ['-f', fakeCurl])
    } catch {
      // Nothing left to stop.
    }
    rmSync(home, { recursive: true, force: true })
  }
})

test('next start after a failed swap', async () => {
  const { home, env } = updateHome()
  const dir = join(home, 'Applications', '.loadout-update-aaaaaaaa')
  mkdirSync(dir)
  writeFileSync(join(dir, 'swap.log'), 'FAILED move-new 1\nRESTORED\n')
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    await expect
      .poll(() => appUpdate(page))
      .toMatchObject({
        stage: 'failed',
        message: 'the restart could not replace the app (FAILED move-new 1).'
      })
    expect(existsSync(dir)).toBe(false)
    const prompt = updatePrompt(page)
    await expect(prompt).toBeVisible({ timeout: 10000 })
    await prompt.getByRole('button', { name: 'UPDATE', exact: true }).click()
    // After a failure UPDATE only opens the dialog: the failure and the steps show, with TRY AGAIN.
    const dialog = page.locator('dialog.update')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('alert')).toContainText('FAILED move-new 1')
    await expect(dialog.locator('details.update-hand')).toHaveAttribute('open')
    await expect(button(dialog, 'TRY AGAIN')).toBeVisible()
    await page.waitForTimeout(500)
    expect(await stage(page)).toBe('failed')
    expect(curlCalls(home)).toEqual(['run'])
    await button(dialog, 'Close').click()
    await page.getByRole('link', { name: 'Log' }).click()
    await expect(logLine(page, 'Update: FAILED move-new 1')).toBeVisible()
    await expect(logLine(page, 'Update: RESTORED')).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

/** A valid `.asar` archive with one file: Electron's `fs` reads it as a folder. */
function tinyAsar(): Buffer {
  const json = Buffer.from(JSON.stringify({ files: { 'a.txt': { size: 1, offset: '0' } } }))
  const padded = Math.ceil(json.length / 4) * 4
  const header = Buffer.alloc(8 + padded)
  header.writeUInt32LE(4 + padded, 0)
  header.writeUInt32LE(json.length, 4)
  json.copy(header, 8)
  const size = Buffer.alloc(8)
  size.writeUInt32LE(4, 0)
  size.writeUInt32LE(header.length, 4)
  return Buffer.concat([size, header, Buffer.from('x')])
}

test('next start deletes an old bundle with an app.asar', async () => {
  const { home, env } = updateHome()
  const dir = join(home, 'Applications', '.loadout-update-aaaaaaaa')
  const resources = join(dir, 'old', 'Loadout.app', 'Contents', 'Resources')
  mkdirSync(resources, { recursive: true })
  writeFileSync(join(resources, 'app.asar'), tinyAsar())
  writeFileSync(join(dir, 'swap.log'), 'DONE\n')
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    await later(page)
    await expect.poll(() => existsSync(dir)).toBe(false)
    await page.getByRole('link', { name: 'Log' }).click()
    await expect(logLine(page, 'Update: DONE')).toBeVisible()
    await expect(page.getByText(/could not delete/)).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('next start: the swap log reaches a page that loads late', async () => {
  const { home, env } = updateHome()
  const dir = join(home, 'Applications', '.loadout-update-aaaaaaaa')
  mkdirSync(dir)
  writeFileSync(join(dir, 'swap.log'), 'DONE\n')
  // The page is served with a 3 s delay, so main is READY and has read the swap log before it loads.
  const renderer = join(ROOT, 'out', 'renderer')
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css'
  }
  const server = createServer((req, res) => {
    const file = join(renderer, new URL(req.url ?? '/', 'http://x').pathname)
    setTimeout(
      () => {
        try {
          const body = readFileSync(file)
          res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
          res.end(body)
        } catch {
          res.writeHead(404)
          res.end()
        }
      },
      file.endsWith('.html') ? 3000 : 0
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const app = await launch(home, {
    ...env,
    ELECTRON_RENDERER_URL: `http://127.0.0.1:${port}/index.html`
  })
  try {
    const page = await app.firstWindow()
    await ready(page)
    await later(page)
    await page.getByRole('link', { name: 'Log' }).click()
    await expect(logLine(page, 'Update: DONE')).toBeVisible()
  } finally {
    await app.close()
    server.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('menu check while ready', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = updateHome()
  writeFileSync(join(home, 'download.sleep'), '5')
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    await later(page)
    await expect.poll(() => stage(page)).toBe('offered')
    // A still newer release appears while the download runs: the update keeps its version.
    writeFileSync(join(home, 'latest-release'), latestRelease(nextVersion(next)))
    expect(await invoke(page, 'update-download')).toEqual({ ok: true })
    await expect.poll(() => curlCalls(home)).toContain('download')
    const dialog = page.locator('dialog.update')
    await clickMenuCheck(app)
    await expect(dialog).toBeVisible()
    expect(await appUpdate(page)).toMatchObject({ latest: next, stage: 'downloading' })
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toBeHidden()
    // And again once it is ready.
    await expect.poll(() => stage(page), { timeout: 30000 }).toBe('ready')
    await clickMenuCheck(app)
    await expect(dialog).toBeVisible()
    expect(await appUpdate(page)).toMatchObject({ latest: next, stage: 'ready' })
    expect(curlCalls(home)).toEqual(['run', 'download', 'run', 'run'])
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

/** UPDATE › in the corner, then the open dialog. */
async function openDialog(page: Page): Promise<Locator> {
  const dialog = page.locator('dialog.update')
  await updateButton(page, nextVersion(CURRENT)).click()
  await expect(dialog).toBeVisible()
  return dialog
}

function button(dialog: Locator, name: string): Locator {
  return dialog.getByRole('button', { name, exact: true })
}

test('dialog: offered', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = updateHome()
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    await expect.poll(() => stage(page)).toBe('offered')
    await later(page)
    const dialog = await openDialog(page)
    await expect(dialog.locator('details.update-hand')).not.toHaveAttribute('open')
    await expect(dialog.locator('details.update-hand summary')).toHaveText('INSTALL BY HAND ›')
    await expect(dialog.locator('.bc-cmd')).toBeHidden()
    await expect(dialog).toContainText(
      `Loadout downloads and checks ${next}. It restarts only when you click RESTART.`
    )
    await expect(dialog.locator('.actions button')).toHaveText(['Close', 'DOWNLOAD'])
    await expect(button(dialog, 'DOWNLOAD')).toHaveClass(/\bprimary\b/)
    await expect(button(dialog, 'DOWNLOAD')).toBeFocused()
    await expect(button(dialog, 'OPEN TERMINAL')).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('dialog: downloading then ready', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = updateHome()
  writeFileSync(join(home, 'download.sleep'), '2')
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    await expect.poll(() => stage(page)).toBe('offered')
    await later(page)
    const dialog = await openDialog(page)
    await button(dialog, 'DOWNLOAD').click()
    const progress = dialog.locator('.update-progress')
    await expect(progress).toContainText(`DOWNLOADING ${next}`)
    await expect(dialog.locator('.actions button')).toHaveText(['CANCEL', 'Close'])
    await expect(button(dialog, 'Close')).toHaveClass(/\bprimary\b/)
    await expect(progress).toContainText(`${next} IS READY`, { timeout: 30000 })
    await expect(progress).toContainText('CHECKED')
    await expect(dialog.locator('.update-bar span')).toHaveAttribute('style', 'width: 100%;')
    await expect(dialog).toContainText(
      'Restart Loadout to finish the update. A running command must end first.'
    )
    await expect(dialog.locator('.actions button')).toHaveText(['Close', 'RESTART'])
    await expect(button(dialog, 'RESTART')).toHaveClass(/\bprimary\b/)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('dialog: close keeps the download', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = updateHome()
  writeFileSync(join(home, 'download.sleep'), '3')
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    await expect.poll(() => stage(page)).toBe('offered')
    await later(page)
    let dialog = await openDialog(page)
    await button(dialog, 'DOWNLOAD').click()
    await expect(dialog.locator('.update-progress')).toContainText(`DOWNLOADING ${next}`)
    await button(dialog, 'Close').click()
    await expect(dialog).toBeHidden()
    dialog = await openDialog(page)
    await expect(dialog.locator('.update-progress')).toContainText(`DOWNLOADING ${next}`)
    expect(await stage(page)).toBe('downloading')
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('dialog: failed shows the steps', async () => {
  const { home, env } = updateHome()
  writeFileSync(join(home, 'download.err'), 'curl: (22) The requested URL returned error: 404\n')
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    await expect.poll(() => stage(page)).toBe('offered')
    await later(page)
    const dialog = await openDialog(page)
    await button(dialog, 'DOWNLOAD').click()
    await expect(dialog.getByRole('alert')).toHaveText(
      'The update failed: curl: (22) The requested URL returned error: 404',
      { timeout: 30000 }
    )
    await expect(dialog.locator('details.update-hand')).toHaveAttribute('open')
    await expect(dialog.locator('.bc-cmd')).toBeVisible()
    await expect(dialog.locator('.actions button')).toHaveText([
      'OPEN TERMINAL',
      'Close',
      'TRY AGAIN'
    ])
    await expect(button(dialog, 'TRY AGAIN')).toHaveClass(/\bprimary\b/)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('dialog: cannot write shows the steps', async () => {
  const { home, env } = updateHome({ bundle: false })
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    await later(page)
    const dialog = await openDialog(page)
    await expect(dialog).toContainText(
      'Loadout cannot replace itself here: Loadout is not running from an app bundle. Install it by hand.'
    )
    await expect(dialog.locator('details.update-hand')).toHaveAttribute('open')
    await expect(dialog.locator('.bc-cmd')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Copy the command' })).toBeFocused()
    await expect(dialog.locator('.actions button')).toHaveText(['OPEN TERMINAL', 'Close'])
    await expect(button(dialog, 'Close')).toHaveClass(/\bprimary\b/)
    await expect(button(dialog, 'DOWNLOAD')).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('dialog: refused restart notice', async () => {
  const next = nextVersion(CURRENT)
  const { home, env } = updateHome()
  // The fake git's fetch sleeps 5 s in a clone path with `slow`: a Check on it holds a command.
  const clone = join(home, '.loadout', 'repos', 'acme', 'slow', 'skills', 's')
  mkdirSync(clone, { recursive: true })
  writeFileSync(join(clone, 'SKILL.md'), '---\nname: probe-slow\ndescription: A probe.\n---\n')
  symlinkSync(clone, join(home, '.loadout', 'skills', 'probe-slow'))
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await ready(page)
    await later(page)
    await reachReady(page)
    let dialog = await openDialog(page)
    await expect(dialog.locator('.update-progress')).toContainText(`${next} IS READY`)
    void page.evaluate(() => window.loadout.invoke('check', { skill: 'probe-slow' }))
    const busy = page.locator('.rail-status', { hasText: /^BUSY$/ })
    await expect(busy).toBeVisible()
    await button(dialog, 'RESTART').click()
    await expect(dialog.getByRole('alert')).toHaveText('Another command is running.')
    await expect(dialog).not.toContainText('Restart Loadout to finish the update.')
    await button(dialog, 'Close').click()
    await expect(dialog).toBeHidden()
    dialog = await openDialog(page)
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(dialog).toContainText(
      'Restart Loadout to finish the update. A running command must end first.'
    )
    expect(bundleVersion(home)).toBe(CURRENT)
    await expect(busy).toBeHidden({ timeout: 10000 })
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})
