import { _electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LoadoutApi } from '../src/core/ipc'
import { fakeHome } from './support/fake-home'
import { expectWindowDrag } from './support/dialog'

declare const window: { loadout: LoadoutApi }

const ROOT = join(__dirname, '..')

const launchArgs = (home: string): string[] => [
  `--user-data-dir=${join(home, 'electron-data')}`,
  join(ROOT, 'out', 'main', 'index.js')
]

/** Writes the probe manifest at `version`. */
function writeManifest(home: string, version: string): void {
  const manifestDir = join(home, 'Code', 'Skills', 'probe', '.tessl-plugin')
  mkdirSync(manifestDir, { recursive: true })
  writeFileSync(join(manifestDir, 'plugin.json'), JSON.stringify({ name: 'acme/probe', version }))
}

/** A fake home whose probe skill has a manifest at `manifestVersion` (unless `withManifest` is false) and, when given, a registry file. */
function unpublishHome(
  manifestVersion: string,
  registry: string | null,
  withManifest = true
): ReturnType<typeof fakeHome> {
  const made = fakeHome()
  if (withManifest) writeManifest(made.home, manifestVersion)
  if (registry !== null) writeFileSync(join(made.home, 'registry'), registry)
  return made
}

const argsLog = (home: string): string[] => {
  const file = join(home, 'tessl-args.log')
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []
}

/** Launches the app, waits for READY, runs `unpublish` on probe and returns its result. */
async function runUnpublish(home: string, env: Record<string, string>): Promise<unknown> {
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    const result = await page.evaluate(() => window.loadout.invoke('unpublish', { skill: 'probe' }))
    return result
  } finally {
    await app.close()
  }
}

test('unpublish: removes every live version, newest first', async () => {
  const { home, env } = unpublishHome('0.1.1', '0.1.0 live\n0.1.1 live\n')
  try {
    const result = await runUnpublish(home, env)
    expect(result).toEqual({ ok: true, removed: ['0.1.1', '0.1.0'], manifestDeleted: true })
    const log = argsLog(home)
    const first = log.indexOf('plugin unpublish --plugin acme/probe@0.1.1')
    const second = log.indexOf('plugin unpublish --plugin acme/probe@0.1.0')
    expect(first).toBeGreaterThanOrEqual(0)
    expect(second).toBeGreaterThan(first)
    // Every version is gone: the manifest and its now empty folder are deleted.
    expect(existsSync(join(home, 'Code', 'Skills', 'probe', '.tessl-plugin'))).toBe(false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('unpublish: other files in .tessl-plugin stay', async () => {
  const { home, env } = unpublishHome('0.1.0', '0.1.0 live\n')
  const folder = join(home, 'Code', 'Skills', 'probe', '.tessl-plugin')
  writeFileSync(join(folder, 'notes.md'), 'kept\n')
  try {
    const result = await runUnpublish(home, env)
    expect(result).toEqual({ ok: true, removed: ['0.1.0'], manifestDeleted: true })
    expect(existsSync(join(folder, 'plugin.json'))).toBe(false)
    expect(readFileSync(join(folder, 'notes.md'), 'utf8')).toBe('kept\n')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('unpublish: the walk finds a hidden version', async () => {
  const { home, env } = unpublishHome('0.1.2', '0.1.0 live\n0.1.1 hidden\n')
  try {
    const result = await runUnpublish(home, env)
    expect(result).toEqual({ ok: true, removed: ['0.1.0', '0.1.1'], manifestDeleted: true })
    const log = argsLog(home)
    expect(log).toContain('plugin info acme/probe@0.1.2 --json')
    expect(log).toContain('plugin info acme/probe@0.1.1 --json')
    expect(log).not.toContain('plugin info acme/probe@0.1.0 --json')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('unpublish: an archived plugin goes to the walk', async () => {
  // An archived plugin names no latest version; its versions answer only by number.
  const { home, env } = unpublishHome('0.1.0', '0.1.0 hidden\n')
  writeFileSync(join(home, 'registry.archived'), '')
  try {
    const result = await runUnpublish(home, env)
    expect(result).toEqual({ ok: true, removed: ['0.1.0'], manifestDeleted: true })
    expect(argsLog(home)).toContain('plugin info acme/probe@0.1.0 --json')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('unpublish: versions left', async () => {
  const { home, env } = unpublishHome('0.1.0', '0.2.0 hidden\n')
  try {
    expect(await runUnpublish(home, env)).toEqual({
      ok: false,
      message:
        'Unpublished nothing, but acme/probe still has versions that Loadout cannot find. Finish with the Tessl CLI; see the log.'
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('unpublish: not on the registry', async () => {
  const { home, env } = unpublishHome('0.1.0', '')
  try {
    expect(await runUnpublish(home, env)).toEqual({
      ok: false,
      message: 'acme/probe is not on the registry, or your Tessl account has no access to it.'
    })
    expect(argsLog(home).some((l) => l.startsWith('plugin unpublish'))).toBe(false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('unpublish: a repeat is caught', async () => {
  const { home, env } = unpublishHome('0.1.0', '0.1.0 live\n')
  writeFileSync(join(home, 'unpublish.noop'), '')
  try {
    expect(await runUnpublish(home, env)).toEqual({
      ok: false,
      message: 'Tessl still lists acme/probe@0.1.0 after the unpublish; see the log.'
    })
    expect(argsLog(home).filter((l) => l.startsWith('plugin unpublish'))).toHaveLength(1)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('unpublish: a failed unpublish stops the job', async () => {
  const { home, env } = unpublishHome('0.1.0', '0.1.0 live\n')
  writeFileSync(join(home, 'unpublish.err'), '✘ Not Found (status 404)\n')
  try {
    expect(await runUnpublish(home, env)).toEqual({
      ok: false,
      message: 'Unpublish of acme/probe@0.1.0 failed: Not Found (status 404)'
    })
    // Not every version is gone: the manifest stays.
    expect(existsSync(join(home, 'Code', 'Skills', 'probe', '.tessl-plugin', 'plugin.json'))).toBe(
      true
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('unpublish: logged out', async () => {
  const { home, env } = unpublishHome('0.1.0', null)
  writeFileSync(
    join(home, 'plugin-info.err'),
    readFileSync(join(ROOT, 'tests', 'fixtures', 'tessl', 'plugin-info-logged-out.txt'), 'utf8')
  )
  writeFileSync(join(home, 'plugin-info.code'), '1')
  try {
    expect(await runUnpublish(home, env)).toEqual({
      ok: false,
      message:
        'Could not check acme/probe on the registry: Please authenticate with Tessl to continue. Run `tessl login` to sign up or log in.'
    })
    expect(argsLog(home).some((l) => l.startsWith('plugin unpublish'))).toBe(false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('unpublish: follow-up closed', async () => {
  const { home, env } = unpublishHome('0.1.0', '0.1.0 live\n')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env, LOADOUT_RECHECK_MS: '2000' } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    // The fake publish writes 0.1.1; the registry has 0.1.0, so the Publish ends pending.
    await page.evaluate(() => window.loadout.invoke('publish', { skill: 'probe', bump: 'patch' }))
    // The follow-up is open: the card reads pending, not the registry's 0.1.0.
    await page.getByRole('button', { name: 'probe', exact: true }).click()
    await expect(
      page.getByRole('region', { name: 'Tessl' }).getByText('pending', { exact: true })
    ).toBeVisible()
    const result = await page.evaluate(() => window.loadout.invoke('unpublish', { skill: 'probe' }))
    expect(result).toEqual({ ok: true, removed: ['0.1.0'], manifestDeleted: true })
    const count = (): number =>
      argsLog(home).filter((l) => l === 'plugin info acme/probe --json').length
    const before = count()
    // Past the third slot (3 x 2 s) after the Publish: a still-open follow-up would have looked again.
    await page.waitForTimeout(7000)
    expect(count()).toBe(before)
    // The manifest is deleted: no TESSL card and no NOT FOUND strip.
    await expect(page.getByRole('region', { name: 'Tessl' })).toHaveCount(0)
    await expect(page.locator('.check-strip')).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('unpublish dialog: item, texts, cancel and confirm', async () => {
  const { home, env } = unpublishHome('0.1.1', '0.1.0 live\n0.1.1 live\n', false)
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    // No manifest: no item. A github entry never has one.
    await page.getByLabel('Actions for probe-gh', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Tessl unpublish' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.getByLabel('Actions for probe', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Tessl unpublish' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    writeManifest(home, '0.1.1')
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible()
    await page.getByLabel('Actions for probe', { exact: true }).click()
    await page.getByRole('button', { name: 'Tessl unpublish' }).click()

    const dialog = page.getByRole('dialog').filter({ hasText: 'UNPUBLISH' })
    await expect(dialog).toBeVisible()
    await expectWindowDrag(dialog)
    await expect(dialog.getByText('from the Tessl Registry')).toBeVisible()
    await expect(dialog.getByText('acme/probe')).toBeVisible()
    await expect(dialog.getByText('every version Loadout can find')).toBeVisible()
    await expect(
      dialog.getByText('Unpublish removes a version as if it was never published.')
    ).toBeVisible()
    await expect(
      dialog.getByText('Unpublished versions are completely removed and cannot be recovered.')
    ).toBeVisible()
    await expect(
      dialog.getByText(
        'Colleagues who installed the skill keep their copy, but cannot update it or install it again.'
      )
    ).toBeVisible()
    await expect(
      dialog.getByText('When every version is gone, Loadout deletes the Tessl manifest')
    ).toBeVisible()

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(argsLog(home).some((l) => l.startsWith('plugin unpublish'))).toBe(false)

    await page.getByLabel('Actions for probe', { exact: true }).click()
    await page.getByRole('button', { name: 'Tessl unpublish' }).click()
    await dialog.getByRole('button', { name: 'Unpublish', exact: true }).click()
    await expect(
      page
        .getByRole('article', { name: 'probe', exact: true })
        .getByText('unpublished 0.1.1, 0.1.0')
    ).toBeVisible()
    // The manifest is gone, so the card's Tessl mark and the menu item are gone too.
    await expect(
      page
        .getByRole('article', { name: 'probe', exact: true })
        .getByRole('img', { name: /^Published to Tessl Registry:/ })
    ).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})
