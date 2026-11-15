// The update rehearsal: the packaged app updates itself in a scratch folder through a fake `curl`,
// once for real and once with a forced swap failure. Run after `pnpm package`:
//   pnpm exec playwright test --config scripts/rehearse-update/playwright.config.ts
// `REHEARSE_FROM=public` (the default) starts from the public latest release and updates it to the
// build. `REHEARSE_FROM=local` starts from the build and updates it to a copy one patch version
// higher; it is only for a release with no public release before it.
// It prints one PASS or FAIL line per check, works only in folders under the system temp folder,
// and stops only the apps it started.
import { chromium, expect, test, type Page } from '@playwright/test'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { plistString } from '../../src/core/release'
import { fakeHome } from '../../e2e/support/fake-home'
import { tinyDmg } from '../../tests/support/tiny-app'

const ROOT = join(__dirname, '..', '..')
const BUILD = join(ROOT, 'dist', 'mac-arm64', 'Loadout.app')
const FROM = process.env.REHEARSE_FROM || 'public'
const PUBLIC_DMG = 'https://github.com/twiddr/loadout/releases/latest/download/Loadout.dmg'
const PORT = 9339

function run(file: string, args: string[]): string {
  const result = spawnSync(file, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${file} ${args.join(' ')} failed: ${result.stderr || result.error?.message}`)
  }
  return result.stdout
}

function scratch(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'loadout-rehearse-')))
}

function plist(app: string, key: string): string {
  return plistString(readFileSync(join(app, 'Contents', 'Info.plist'), 'utf8'), key) ?? ''
}

function nextVersion(v: string): string {
  const [major, minor, patch] = v.split('.').map(Number)
  return `${major}.${minor}.${patch + 1}`
}

/** One PASS or FAIL line on stdout; a FAIL ends the test. */
async function check(name: string, body: () => unknown): Promise<void> {
  try {
    await body()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.log(`FAIL ${name}`)
    throw error
  }
}

/** The app's window over CDP, once its debugging port answers. */
async function connect(): Promise<Page> {
  const deadline = Date.now() + 60_000
  for (;;) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
      const context = browser.contexts()[0]
      return context.pages()[0] ?? (await context.waitForEvent('page'))
    } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

function logLine(page: Page, text: string | RegExp): ReturnType<Page['getByText']> {
  return page.getByRole('article', { name: /^Run \d+$/ }).getByText(text, { exact: true })
}

let fixtures = ''
let oldApp = ''
let oldVersion = ''
let newVersion = ''
let newDmg = ''

test.beforeAll(() => {
  if (FROM !== 'local' && FROM !== 'public') throw new Error('REHEARSE_FROM is local or public.')
  // Another app on the port would answer in place of the rehearsal's own copy.
  const listening = spawnSync('/usr/sbin/lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN'], {
    encoding: 'utf8'
  }).stdout
  if (listening) throw new Error(`Port ${PORT} is in use:\n${listening}`)
  fixtures = scratch()
  if (FROM === 'local') {
    // The build is the old app; a copy one patch higher, signed again ad hoc, is the new one.
    oldApp = BUILD
    oldVersion = plist(BUILD, 'CFBundleShortVersionString')
    newVersion = nextVersion(oldVersion)
    const app = join(fixtures, 'new', 'Loadout.app')
    run('/usr/bin/ditto', [BUILD, app])
    const info = join(app, 'Contents', 'Info.plist')
    run('/usr/bin/plutil', ['-replace', 'CFBundleShortVersionString', '-string', newVersion, info])
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app])
    newDmg = tinyDmg(app, join(fixtures, 'Loadout.dmg'))
  } else {
    // The public latest release is the old app; the build's DMG is the new one.
    const dmg = join(fixtures, 'public.dmg')
    const mnt = join(fixtures, 'mnt')
    run('/usr/bin/curl', ['-fsSL', '-o', dmg, PUBLIC_DMG])
    mkdirSync(mnt)
    run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mnt, dmg])
    oldApp = join(fixtures, 'old', 'Loadout.app')
    try {
      run('/usr/bin/ditto', [join(mnt, 'Loadout.app'), oldApp])
    } finally {
      run('/usr/bin/hdiutil', ['detach', mnt])
    }
    oldVersion = plist(oldApp, 'CFBundleShortVersionString')
    newVersion = plist(BUILD, 'CFBundleShortVersionString')
    newDmg = join(ROOT, 'dist', 'Loadout.dmg')
  }
})

test.afterAll(() => {
  if (fixtures) rmSync(fixtures, { recursive: true, force: true })
})

let children: ChildProcess[] = []
let executables: string[] = []
let folders: string[] = []

/** The pids of the apps started from `exe`: the first launch, or the one the swap script started. */
function pids(exe: string): number[] {
  const out = spawnSync('/usr/bin/pgrep', ['-f', exe], { encoding: 'utf8' }).stdout
  return out.split('\n').filter(Boolean).map(Number)
}

test.afterEach(async () => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  for (const exe of executables) {
    for (const pid of pids(exe)) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // It ended after pgrep listed it.
      }
    }
  }
  await expect
    .poll(
      () =>
        executables.flatMap(pids).length +
        children.filter((c) => c.exitCode === null && c.signalCode === null).length,
      { timeout: 30_000 }
    )
    .toBe(0)
  for (const folder of folders) rmSync(folder, { recursive: true, force: true })
  children = []
  executables = []
  folders = []
})

/**
 * Copies the old app into a scratch `Applications`, serves the new DMG through the fake `curl`,
 * starts the old app, and runs UPDATE ›, DOWNLOAD and RESTART. Returns the window of the app that
 * the swap script started, and the install path.
 */
async function updateAndRestart(
  label: string,
  extraEnv: Record<string, string>
): Promise<{ page: Page; install: string }> {
  const dir = scratch()
  folders.push(dir)
  const install = join(dir, 'Applications', 'Loadout.app')
  run('/usr/bin/ditto', [oldApp, install])
  const { home, env } = fakeHome()
  folders.push(home)
  writeFileSync(
    join(home, 'latest-release'),
    `302 https://github.com/twiddr/loadout/releases/tag/v${newVersion}`
  )
  symlinkSync(newDmg, join(home, 'release.dmg'))
  writeFileSync(
    join(home, 'release-headers'),
    `HTTP/1.1 200 OK\r\ncontent-length: ${statSync(newDmg).size}\r\n\r\n`
  )

  const exe = join(install, 'Contents', 'MacOS', plist(install, 'CFBundleExecutable'))
  executables.push(exe)
  const child = spawn(
    exe,
    [`--remote-debugging-port=${PORT}`, `--user-data-dir=${join(dir, 'electron-data')}`],
    {
      env: {
        ...env,
        LOADOUT_TEST_BACKGROUND: process.env.LOADOUT_TEST_BACKGROUND ?? '',
        ...extraEnv
      },
      stdio: 'ignore'
    }
  )
  children.push(child)

  const old = await connect()
  const corner = old.getByRole('button', { name: `Update to ${newVersion}`, exact: true })
  const dialog = old.locator('dialog.update')
  await check(`${label}: ${oldVersion} offers ${newVersion}`, async () => {
    await expect(corner).toBeVisible({ timeout: 30_000 })
  })
  await check(`${label}: ${newVersion} is downloaded, checked and ready`, async () => {
    await corner.click()
    await dialog.getByRole('button', { name: 'DOWNLOAD', exact: true }).click()
    await expect(dialog.locator('.update-progress')).toContainText(`${newVersion} IS READY`, {
      timeout: 300_000
    })
  })
  await check(`${label}: RESTART quits the old app`, async () => {
    await dialog.getByRole('button', { name: 'RESTART', exact: true }).click()
    await expect.poll(() => child.exitCode ?? child.signalCode, { timeout: 60_000 }).not.toBeNull()
  })
  let page: Page | undefined
  await check(
    `${label}: the app started again at the install path and CDP reconnects`,
    async () => {
      page = await connect()
      expect(pids(exe)).toHaveLength(1)
    }
  )
  return { page: page!, install }
}

test('update', async () => {
  const { page, install } = await updateAndRestart('update', {})
  await check('update: the Log has Update: DONE', async () => {
    await page.getByRole('link', { name: 'Log' }).click()
    await expect(logLine(page, 'Update: DONE')).toBeVisible({ timeout: 30_000 })
  })
  await check(`update: the install path holds ${newVersion}`, () => {
    expect(plist(install, 'CFBundleShortVersionString')).toBe(newVersion)
  })
  await check('update: the install path passes codesign --verify --deep --strict', () => {
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', install])
  })
  // With REHEARSE_FROM=local the corner shows the build-time version, which the update did not change.
  if (FROM === 'public') {
    await check(`update: the corner shows ${newVersion} and no UPDATE ›`, async () => {
      await page.getByRole('link', { name: 'Log' }).click()
      await expect(page.locator('.app-version')).toHaveText(newVersion)
      await expect(page.getByRole('button', { name: /^Update to/ })).toHaveCount(0)
    })
  }
})

test('forced failure', async () => {
  const { page, install } = await updateAndRestart('forced failure', {
    LOADOUT_UPDATE_FAIL: 'swap'
  })
  await check('forced failure: the Log has Update: FAILED move-new', async () => {
    await page.getByRole('link', { name: 'Log' }).click()
    await expect(logLine(page, /^Update: FAILED move-new \d+$/)).toBeVisible({ timeout: 30_000 })
  })
  await check('forced failure: the Log has Update: RESTORED', async () => {
    await expect(logLine(page, 'Update: RESTORED')).toBeVisible()
  })
  await check(`forced failure: the install path holds ${oldVersion}`, () => {
    expect(plist(install, 'CFBundleShortVersionString')).toBe(oldVersion)
  })
  await check('forced failure: the install path passes codesign --verify --deep --strict', () => {
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', install])
  })
  await check('forced failure: the dialog shows the failure with the steps open', async () => {
    const dialog = page.locator('dialog.update')
    await page.getByRole('button', { name: `Update to ${newVersion}`, exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText(
      'The update failed: the restart could not replace the app (FAILED move-new'
    )
    await expect(dialog.locator('details.update-hand')).toHaveAttribute('open')
  })
})
