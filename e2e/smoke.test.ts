import { _electron, expect, test, type Locator, type Page } from '@playwright/test'
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CONFIG, serializeConfig } from '../src/core/config'
import type { LoadoutApi } from '../src/core/ipc'
import { fakeHome } from './support/fake-home'
import { expectWindowDrag } from './support/dialog'
import { skipBriefing } from './support/briefing'

const ROOT = join(__dirname, '..')

test('launches, renders the shell and the startup line', async () => {
  const { home, env } = fakeHome()
  const config = structuredClone(DEFAULT_CONFIG)
  config.agents[0].enabled = true
  config.tesslWorkspace = 'acme'
  config.agents.push({
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode-not-installed',
    folder: '~/.config/opencode/skills',
    alsoReadBy: [],
    enabled: true
  })
  writeFileSync(join(home, '.loadout', 'config.json'), serializeConfig(config))
  // A .git folder makes the skills folder a work tree, so Publish still commits the manifest.
  mkdirSync(join(home, 'Code', 'Skills', '.git'))
  const app = await _electron.launch({
    args: [`--user-data-dir=${join(home, 'electron-data')}`, join(ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('checkbox', { name: 'probe Claude Code' })).toBeVisible()
    // The first menu and its About and Quit items take the app name.
    expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items[0].label)).toBe(
      'Loadout'
    )
    // Check for Updates… comes directly after About Loadout.
    expect(
      await app.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()
          ?.items[0].submenu?.items.slice(0, 2)
          .map((item) => item.label)
      )
    ).toEqual(['About Loadout', 'Check for Updates…'])
    await expect(page.getByRole('link', { name: 'Loadout' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('img', { name: 'Loadout' })
    ).toBeVisible()
    const probe = page.getByRole('article', { name: 'probe', exact: true })
    const probeGh = page.getByRole('article', { name: 'probe-gh', exact: true })
    await expect(probe.getByText('SK-01')).toBeVisible()
    await expect(probe.getByTitle('~/Code/Skills/probe')).toBeVisible()
    await expect(probe.getByRole('img', { name: 'Issued to 1 agent' })).toBeVisible()
    await expect(probe.getByRole('checkbox', { name: 'probe OpenCode' })).toBeVisible()
    await expect(probeGh.getByRole('checkbox', { name: 'probe-gh OpenCode' })).toBeVisible()
    await expect(probeGh.getByText('SK-02 · STOWED')).toBeVisible()
    await expect(page.getByRole('checkbox', { name: /probe Claude Code/ })).toBeChecked()
    await expect(
      page.getByRole('region', { name: 'Claude Code' }).getByText('1 / 2 SLOTS')
    ).toBeVisible()
    // A filled kit slot names its skill in a tip.
    const platoon = page.getByRole('complementary', { name: 'Platoon' })
    await expect(async () => {
      await page.mouse.move(0, 0)
      await platoon
        .getByRole('region', { name: 'Claude Code' })
        .getByRole('img', { name: 'probe', exact: true })
        .hover()
      await expect(platoon.getByRole('tooltip')).toHaveText('probe', { timeout: 1000 })
    }).toPass()
    await page.mouse.move(0, 0)
    await expect(platoon.getByRole('tooltip')).toHaveCount(0)
    // The Platoon cards keep their width when the panel gets a scrollbar.
    const agentCard = platoon.getByRole('region', { name: 'Claude Code' })
    const cardWidth = (await agentCard.boundingBox())?.width
    const [w, h] = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getSize()
    )
    await app.evaluate(
      ({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, 640),
      w
    )
    await expect.poll(() => platoon.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    expect((await agentCard.boundingBox())?.width).toBe(cardWidth)
    // The scrolling panel keeps the Enlist button's height and does not scroll sideways.
    expect(
      (await platoon.getByRole('button', { name: 'Enlist agent' }).boundingBox())?.height
    ).toBe(40)
    expect(await platoon.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0)
    await app.evaluate(
      ({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(s.w, s.h),
      { w, h }
    )
    await expect(
      page.getByRole('region', { name: 'OpenCode' }).getByText('NOT FOUND')
    ).toBeVisible()
    await page.getByRole('link', { name: 'Recon' }).click()
    await expect(page.getByRole('link', { name: 'Recon' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('cell', { name: 'deep-research', exact: true })).toBeVisible()
    await expect(
      page.getByRole('row', { name: /deep-research/ }).getByText('DANGLING')
    ).toBeVisible()
    await expect(page.getByText('No loadout issues.')).toBeVisible()
    await expect(
      page.getByRole('complementary', { name: 'Folders scanned' }).getByText('~/.loadout/skills')
    ).toBeVisible()
    await page.getByRole('link', { name: 'Loadout' }).click()
    await page.getByRole('button', { name: 'Enlist agent' }).click()
    await expect(page.getByRole('checkbox', { name: 'Enable Claude Code' })).toBeChecked()
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Recruit skill' }).click()
    await expect(page.getByRole('button', { name: 'Add from folder' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Add from link' })).toBeEnabled()
    await page.getByRole('button', { name: 'Add from registry' }).click()
    // Scan is as wide as Close and lines up with it.
    const recruit = page.getByRole('dialog')
    await expectWindowDrag(recruit)
    const scanBox = await recruit.getByRole('button', { name: 'Scan' }).boundingBox()
    const closeBox = await recruit.getByRole('button', { name: 'Close' }).boundingBox()
    expect(scanBox?.width).toBe(closeBox?.width)
    expect(scanBox?.x).toBe(closeBox?.x)
    await recruit.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('textbox', { name: 'Search your loadout' }).fill('gh')
    await expect(probe).toBeHidden()
    await expect(probeGh).toBeVisible()
    await page.getByRole('textbox', { name: 'Search your loadout' }).fill('')
    await page.getByRole('button', { name: 'Stowed', exact: true }).click()
    await expect(probe).toBeHidden()
    await expect(probeGh).toBeVisible()
    await page.getByRole('button', { name: 'Registry', exact: true }).click()
    await expect(page.getByText('No skill matches the Registry filter.')).toBeVisible()
    await page.getByRole('button', { name: 'All', exact: true }).click()
    await expect(probe).toBeVisible()
    await page.getByLabel('Actions for probe', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Tessl review' })).toBeEnabled()
    await page.getByRole('button', { name: 'Tessl fix' }).click()
    await expect(page.getByText(/Fix runs one improve-and-review round/)).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('fixing…')).toBeHidden()
    await page.getByLabel('Actions for probe', { exact: true }).click()
    await page.getByRole('button', { name: 'Tessl publish' }).click()
    await expect(page.getByText('to the Tessl workspace')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Workspace' })).toHaveText('acme')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(
      page.getByRole('complementary', { name: 'Platoon' }).getByText(/tessl 0\.119\.0/)
    ).toBeVisible()
    await page.getByLabel('Actions for probe', { exact: true }).click()
    await page.getByRole('button', { name: 'Tessl review' }).click()
    await page.getByRole('link', { name: 'Log' }).click()
    const card = page.getByRole('article', { name: /^Run \d+$/ })
    await expect(card.getByText('REVIEW', { exact: true })).toBeVisible()
    await expect(card.locator('.run-command')).toContainText('$ ')
    await expect(card.locator('.run-command')).toContainText('tessl review run')
    await expect(card.getByText('EXIT 0')).toBeVisible()
    // The main handler is replaced, so the test never writes the real macOS clipboard.
    const stubCopy = (fail: boolean): Promise<void> =>
      app.evaluate(({ ipcMain }, fail) => {
        ipcMain.removeHandler('copy-text')
        ipcMain.handle('copy-text', (_event, { text }: { text: string }) => {
          if (fail) return { ok: false, message: 'stub failure' }
          ;(globalThis as unknown as { copied: string }).copied = text
          return { ok: true }
        })
      }, fail)
    const copy = card.getByRole('button', { name: /^Copy run \d+$/ })
    await stubCopy(true)
    await copy.click()
    await expect(page.getByRole('alert')).toHaveText('Copy failed: stub failure')
    await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.getByRole('alert')).toBeHidden()
    await stubCopy(false)
    await copy.click()
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { copied?: string }).copied))
      .toMatch(/^\$ .*tessl review run/)
    const copied = await app.evaluate(() => (globalThis as unknown as { copied: string }).copied)
    expect(copied).toMatch(/\nexit 0\n$/)
    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(page.getByText('No command has run in this session.')).toBeVisible()
    const dark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
    const target = dark ? 'light' : 'dark'
    await page.getByRole('button', { name: `Switch to ${target} appearance` }).click()
    await expect.poll(() => savedConfig(home)?.appearance).toBe(target)

    // Settings: opened from the rail; System goes back to following macOS.
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Settings' })
      .click()
    const settings = page.getByRole('dialog')
    await expect(settings.getByRole('heading', { name: 'SETTINGS' })).toBeVisible()
    await expectWindowDrag(settings)
    // The fake tessl lists acme (picked, the default since the config had it) and beta.
    const workspaces = settings.getByRole('group', { name: 'Workspaces' })
    await expect(workspaces.getByRole('checkbox', { name: 'acme' })).toBeChecked()
    await expect(workspaces.getByRole('checkbox', { name: 'beta' })).not.toBeChecked()
    await workspaces.getByRole('radio', { name: 'Default workspace beta' }).check()
    await expect
      .poll(() => {
        const saved = savedConfig(home)
        return [saved?.tesslWorkspace, saved?.tesslWorkspaces]
      })
      .toEqual(['beta', ['acme', 'beta']])
    await expect(workspaces.getByRole('checkbox', { name: 'beta' })).toBeChecked()
    await expect(
      settings.getByRole('radio', { name: target === 'dark' ? 'Dark' : 'Light' })
    ).toBeChecked()
    await settings.getByText('System', { exact: true }).click()
    await expect.poll(() => savedConfig(home)?.appearance).toBe('system')
    await expect(
      settings.getByRole('region', { name: 'Systems' }).getByText('~/fakebin/git')
    ).toBeVisible()
    await expect(settings.getByRole('button', { name: 'Reveal Tessl plugins' })).toBeVisible()
    // Reveal is not clicked: it would open a real Finder window.
    expect(
      await page.evaluate(() => window.loadout.invoke('reveal-folder', { folder: 'tesslPlugins' }))
    ).toEqual({ ok: false, message: '~/.tessl/plugins does not exist yet.' })
    await settings.getByRole('button', { name: 'Close' }).click()
    await expect(settings).toBeHidden()

    // Publish starts from the default (now beta) and can go to another picked workspace.
    await page.getByRole('link', { name: 'Loadout' }).click()
    await page.getByLabel('Actions for probe', { exact: true }).click()
    await page.getByRole('button', { name: 'Tessl publish' }).click()
    const publishTo = page.getByRole('button', { name: 'Workspace' })
    await expect(publishTo).toHaveText('beta')
    await publishTo.click()
    await page.getByRole('menuitemradio', { name: 'acme' }).click()
    await expect(publishTo).toHaveText('acme')
    // The assertion waits for the git-work-tree answer.
    await expect(
      page.getByRole('dialog').getByRole('checkbox', { name: 'Commit manifest' })
    ).toBeChecked()
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('article', { name: 'probe', exact: true })).toContainText(
      'published 0.1.1'
    )
    await page.getByRole('link', { name: 'Log' }).click()
    await expect(
      page
        .getByRole('article', { name: /^Run \d+$/ })
        .locator('.run-command', { hasText: 'skill publish' })
    ).toContainText('--workspace acme --bump patch')
    // Commit manifest is on by default: Loadout commits only the manifest, and the Log shows the command.
    await expect(
      page
        .getByRole('article', { name: /^Run \d+$/ })
        .locator('.run-command', { hasText: 'commit -m' })
    ).toContainText('chore(probe): publish 0.1.1 -- .tessl-plugin/plugin.json')
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

/** The saved config, or null while the app is between truncating and writing it. */
function savedConfig(home: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(home, '.loadout', 'config.json'), 'utf8'))
  } catch {
    return null
  }
}

const launchArgs = (home: string): string[] => [
  `--user-data-dir=${join(home, 'electron-data')}`,
  join(ROOT, 'out', 'main', 'index.js')
]

test('publish dialog: commit manifest only in a git work tree', async () => {
  const { home, env } = fakeHome()
  const config = structuredClone(DEFAULT_CONFIG)
  config.agents[0].enabled = true
  config.tesslWorkspace = 'acme'
  writeFileSync(join(home, '.loadout', 'config.json'), serializeConfig(config))
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await page.getByLabel('Actions for probe', { exact: true }).click()
    await page.getByRole('button', { name: 'Tessl publish' }).click()
    const dialog = page.getByRole('dialog')
    await expectWindowDrag(dialog)
    await expect(dialog.getByText('Commit manifest')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('article', { name: 'probe', exact: true })).toContainText(
      'published 0.1.1'
    )
    await page.getByRole('link', { name: 'Log' }).click()
    const commands = page.getByRole('article', { name: /^Run \d+$/ }).locator('.run-command')
    await expect(commands.filter({ hasText: 'skill publish' })).toHaveCount(1)
    await expect(commands.filter({ hasText: ' add -- ' })).toHaveCount(0)
    await expect(commands.filter({ hasText: 'commit -m' })).toHaveCount(0)

    mkdirSync(join(home, 'Code', 'Skills', '.git'))
    await page.getByRole('link', { name: 'Loadout' }).click()
    await page.getByLabel('Actions for probe', { exact: true }).click()
    await page.getByRole('button', { name: 'Tessl publish' }).click()
    await expect(dialog.getByRole('checkbox', { name: 'Commit manifest' })).toBeChecked()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('publish dialog: shows who can see the skill', async () => {
  const { home, env } = fakeHome()
  const manifest = join(home, 'Code', 'Skills', 'probe', '.tessl-plugin')
  mkdirSync(manifest)
  writeFileSync(
    join(manifest, 'plugin.json'),
    '{"name":"acme/probe","version":"0.1.0","private":false}'
  )
  const config = structuredClone(DEFAULT_CONFIG)
  config.agents[0].enabled = true
  config.tesslWorkspace = 'acme'
  config.tesslWorkspaces = ['acme', 'beta']
  writeFileSync(join(home, '.loadout', 'config.json'), serializeConfig(config))
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await page.getByLabel('Actions for probe', { exact: true }).click()
    await page.getByRole('button', { name: 'Tessl publish' }).click()
    const dialog = page.getByRole('dialog')
    const visibility = dialog.locator('.publish-visibility')
    await expect(visibility).toHaveText('public · anyone can see and install it')
    await expect(visibility).toHaveClass(/amber-text/)
    await dialog.getByRole('button', { name: 'Workspace' }).click()
    await dialog.getByRole('menuitemradio', { name: 'beta' }).click()
    await expect(visibility).toHaveText('unknown · the manifest is for acme')
    await expect(visibility).not.toHaveClass(/amber-text/)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('skill page: history and spec of a GitHub skill', async () => {
  const { home, env } = fakeHome()
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'probe-gh', exact: true }).click()
    await page.getByRole('tab', { name: 'History' }).click()
    await expect(page.getByText('Initial')).toBeVisible()
    await expect(page.getByText('Shallow clone: history starts at abc1234.')).toBeVisible()
    await expect(page.getByText('BRANCH').locator('..')).toContainText('main')
    await expect(page.getByText('COMMIT', { exact: true }).locator('..')).toContainText('abc1234')
    await page.getByRole('button', { name: 'Back to Loadout' }).click()
    await expect(page.getByRole('article', { name: 'probe', exact: true })).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('tessl status: card mark, TESSL card and SHARE', async () => {
  const { home, env } = fakeHome()
  const manifestPath = join(home, 'Code', 'Skills', 'probe', '.tessl-plugin', 'plugin.json')
  mkdirSync(join(home, 'Code', 'Skills', 'probe', '.tessl-plugin'), { recursive: true })
  writeFileSync(manifestPath, '{"name":"acme/probe","version":"0.1.0","private":true}')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    const tip = 'Published to Tessl Registry: acme/probe, manifest version 0.1.0'
    const probe = page.getByRole('article', { name: 'probe', exact: true })
    await expect(probe.getByRole('img', { name: tip })).toBeVisible()
    await probe.getByRole('img', { name: tip }).hover()
    await expect(
      probe.getByRole('tooltip').filter({ hasText: 'Published to Tessl Registry' })
    ).toHaveText('Published to Tessl Registry\nacme/probe\nManifest version 0.1.0')
    const probeGh = page.getByRole('article', { name: 'probe-gh', exact: true })
    await expect(probeGh.getByRole('img', { name: /^Published to Tessl Registry:/ })).toHaveCount(0)
    // The open tip covers the card name; move the pointer away first.
    await page.mouse.move(0, 0)
    await probe.getByRole('button', { name: 'probe', exact: true }).click()
    const tessl = page.getByRole('region', { name: 'Tessl' })
    await expect(tessl.getByText('acme/probe', { exact: true })).toHaveAttribute(
      'title',
      'acme/probe'
    )
    await expect(tessl.getByText('0.1.0', { exact: true })).toBeVisible()
    await expect(tessl.getByText('not checked', { exact: true })).toBeVisible()
    await expect(tessl.getByRole('button', { name: 'Check the registry' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Check', exact: true })).toHaveCount(0)
    await expect(tessl.getByText('private · workspace members')).toBeVisible()
    await expect(tessl.getByRole('link', { name: 'Open in registry' })).toHaveAttribute(
      'href',
      'https://tessl.io/registry/acme/probe'
    )
    // The main handler is replaced, so the test never writes the real macOS clipboard.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('copy-text')
      ipcMain.handle('copy-text', (_event, { text }: { text: string }) => {
        ;(globalThis as unknown as { copied: string }).copied = text
        return { ok: true }
      })
    })
    await tessl.getByRole('button', { name: 'Share' }).click()
    expect(await app.evaluate(() => (globalThis as unknown as { copied: string }).copied)).toBe(
      'probe is on the Tessl Registry:\nhttps://tessl.io/registry/acme/probe\n\n' +
        'In Loadout: Recruit skill → Registry → acme/probe\nWithout Loadout: tessl install acme/probe\n\n' +
        'It is private: you need a Tessl account in the acme workspace.\n'
    )
    // A terminal publish bumps the manifest; the next state build shows it.
    writeFileSync(manifestPath, '{"name":"acme/probe","version":"0.2.0","private":true}')
    await page.evaluate(() => window.loadout.invoke('refresh'))
    await expect(tessl.getByText('0.2.0', { exact: true })).toBeVisible()
    rmSync(manifestPath)
    await page.evaluate(() => window.loadout.invoke('refresh'))
    await expect(tessl).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Check the registry' })).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('tessl status: TESSL card of a Registry skill', async () => {
  const { home, env } = fakeHome()
  addSkill(home, '.tessl/plugins', 'acme/kit/skills/probe-t', 'probe-t')
  // `tessl install` writes the plugin's manifest at the plugin root, above the skill's subpath.
  mkdirSync(join(home, '.tessl', 'plugins', 'acme', 'kit', '.tessl-plugin'), { recursive: true })
  writeFileSync(
    join(home, '.tessl', 'plugins', 'acme', 'kit', '.tessl-plugin', 'plugin.json'),
    '{"name":"acme/kit","version":"0.1.0","private":true}'
  )
  writeFileSync(
    join(home, 'plugin-info.json'),
    JSON.stringify({
      tile: { fullName: 'acme/kit', latestVersion: '0.1.1', archived: false, deprecated: true },
      version: { version: '0.1.1', createdAt: '2026-11-10T12:00:00.000Z' }
    })
  )
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await page
      .getByRole('article', { name: 'probe-t', exact: true })
      .getByRole('button', { name: 'probe-t', exact: true })
      .click()
    const tessl = page.getByRole('region', { name: 'Tessl' })
    await expect(tessl.getByText('acme/kit', { exact: true })).toBeVisible()
    await expect(tessl.getByText('INSTALLED', { exact: true })).toBeVisible()
    await expect(tessl.getByText('MANIFEST', { exact: true })).toHaveCount(0)
    await expect(tessl.getByText('0.1.0', { exact: true })).toBeVisible()
    await expect(tessl.getByText('not checked', { exact: true })).toBeVisible()
    await expect(tessl.getByText('private · workspace members')).toBeVisible()
    await expect(tessl.getByRole('link', { name: 'Open in registry' })).toHaveAttribute(
      'href',
      'https://tessl.io/registry/acme/kit'
    )
    await expect(page.locator('.edited-strip')).toHaveCount(0)
    await tessl.getByRole('button', { name: 'Check the registry' }).click()
    await expect(tessl.getByText('published 2026-11-10 · 0.1.1')).toBeVisible()
    await expect(tessl.getByText('DEPRECATED', { exact: true })).toBeVisible() // The publish strips belong to own skills; a Registry skill gets none.
    await expect(page.getByText('the registry has')).toHaveCount(0)
    // A whole-plugin archive: the REGISTRY row reads archived with the chip, not pending.
    writeFileSync(
      join(home, 'plugin-info.json'),
      JSON.stringify({
        tile: {
          fullName: 'acme/kit',
          latestVersion: null,
          archived: true,
          archivedReason: 'Old.',
          deprecated: true
        },
        version: null
      })
    )
    await tessl.getByRole('button', { name: 'Check the registry' }).click()
    await expect(tessl.getByText('archived', { exact: true })).toBeVisible()
    await expect(tessl.getByText('ARCHIVED', { exact: true })).toHaveAttribute(
      'title',
      'Archived on the registry: Old.'
    )
    await expect(tessl.getByText('DEPRECATED', { exact: true })).toHaveAttribute(
      'title',
      'Deprecated on the registry; no reason given.'
    )
    await expect(page.locator('.check-strip')).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('tessl status: files newer than the manifest read as changed since publish', async () => {
  const { home, env } = fakeHome()
  const folder = join(home, 'Code', 'Skills', 'probe')
  mkdirSync(join(folder, '.tessl-plugin'), { recursive: true })
  const manifestPath = join(folder, '.tessl-plugin', 'plugin.json')
  writeFileSync(manifestPath, '{"name":"acme/probe","version":"0.1.0","private":true}')
  // File times in seconds: every file older than the manifest, then SKILL.md 60 s newer.
  const t = Math.floor(Date.now() / 1000) - 3600
  for (const file of readdirSync(folder, { recursive: true, withFileTypes: true }))
    if (file.isFile()) utimesSync(join(file.parentPath, file.name), t - 60, t - 60)
  utimesSync(manifestPath, t, t)
  utimesSync(join(folder, 'SKILL.md'), t + 60, t + 60)
  const config = structuredClone(DEFAULT_CONFIG)
  config.agents[0].enabled = true
  config.tesslWorkspace = 'acme'
  writeFileSync(join(home, '.loadout', 'config.json'), serializeConfig(config))
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    const probe = page.getByRole('article', { name: 'probe', exact: true })
    const changed =
      'Published to Tessl Registry: acme/probe, manifest version 0.1.0, changed since publish'
    const mark = probe.getByRole('img', { name: changed, exact: true })
    await expect(mark).toBeVisible()
    await expect(probe.locator('.card-tessl')).toHaveClass(/edited/)
    await mark.hover()
    const tooltip = probe.getByRole('tooltip').filter({ hasText: 'Published to Tessl Registry' })
    await expect(tooltip).toBeVisible()
    // toHaveText collapses whitespace, so the four lines are checked on the raw text.
    expect(await tooltip.evaluate((el) => el.textContent)).toBe(
      'Published to Tessl Registry\nacme/probe\nManifest version 0.1.0\nChanged since publish'
    )
    await page.mouse.move(0, 0)
    // The pulse stops when the user asks for less motion; the amber colour stays.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(
      await probe.locator('.card-tessl-icon').evaluate((el) => getComputedStyle(el).animationName)
    ).toBe('none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    expect(
      await probe.locator('.card-tessl-icon').evaluate((el) => getComputedStyle(el).animationName)
    ).not.toBe('none')

    await probe.getByRole('button', { name: 'probe', exact: true }).click()
    const tessl = page.getByRole('region', { name: 'Tessl' })
    const strip = page.locator('.edited-strip')
    const text = strip.getByText('Files changed after version 0.1.0 was published.', {
      exact: true
    })
    await expect(text).toBeVisible()
    // The file names are only in the hover text, never in the sentence.
    await expect(text).toHaveAttribute('title', 'Changed since publish of 0.1.0:\nSKILL.md')
    await expect(tessl.getByText('EDITED')).toHaveCount(0)

    // Two more newer files: the hover text lists them, newest first.
    utimesSync(join(folder, 'SKILL.md'), t + 90, t + 90)
    mkdirSync(join(folder, 'scripts'))
    for (const file of ['notes.md', join('scripts', 'run.sh')]) {
      writeFileSync(join(folder, file), 'new')
      utimesSync(join(folder, file), t + 30, t + 30)
    }
    // Refresh returns at once while the startup check runs; wait for it to end first.
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    await page.evaluate(() => window.loadout.invoke('refresh'))
    await expect(text).toHaveAttribute(
      'title',
      'Changed since publish of 0.1.0:\nSKILL.md\nnotes.md\nscripts/run.sh'
    )

    // The strip's PUBLISH opens the dialog; a Publish rewrites the manifest, so nothing is newer.
    await strip.getByRole('button', { name: 'Publish' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(tessl.getByText('0.1.1', { exact: true })).toBeVisible()
    await expect(strip).toHaveCount(0)
    await page.getByRole('button', { name: 'Back to Loadout' }).click()
    await expect(probe.getByRole('img', { name: /^Published to Tessl Registry:/ })).toHaveAttribute(
      'aria-label',
      'Published to Tessl Registry: acme/probe, manifest version 0.1.1'
    )
    await expect(probe.locator('.card-tessl')).not.toHaveClass(/edited/)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('tessl status: CHECK walks every registry state and Publish fills it', async () => {
  const { home, env } = fakeHome()
  const folder = join(home, 'Code', 'Skills', 'probe')
  mkdirSync(join(folder, '.tessl-plugin'), { recursive: true })
  writeFileSync(
    join(folder, '.tessl-plugin', 'plugin.json'),
    '{"name":"acme/probe","version":"0.1.0","private":true}'
  )
  const files = ['json', 'err', 'code'].map((ext) => join(home, `plugin-info.${ext}`))
  // The fake `tessl plugin info` answers from these three files in the fake home.
  const answer = (reply: object | { err: string; code: number }): void => {
    for (const file of files) rmSync(file, { force: true })
    if ('err' in reply) {
      copyFileSync(join(ROOT, 'tests', 'fixtures', 'tessl', reply.err), files[1])
      writeFileSync(files[2], String(reply.code))
    } else writeFileSync(files[0], JSON.stringify(reply))
  }
  const info = (version: string, extra: object = {}): object => ({
    tile: {
      fullName: 'acme/probe',
      latestVersion: version,
      archived: false,
      deprecated: false,
      ...extra
    },
    version: { version, createdAt: '2026-11-10T12:00:00.000Z' }
  })
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env, LOADOUT_RECHECK_MS: '500' } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await page
      .getByRole('article', { name: 'probe', exact: true })
      .getByRole('button', { name: 'probe', exact: true })
      .click()
    const tessl = page.getByRole('region', { name: 'Tessl' })
    const check = tessl.getByRole('button', { name: 'Check the registry' })
    // An own skill has no header CHECK; the refresh button in the REGISTRY row replaces it.
    await expect(page.getByRole('button', { name: 'Check', exact: true })).toHaveCount(0)
    const strip = page.locator('.intel-strip, .check-strip')

    answer(info('0.1.0'))
    await check.click()
    await expect(tessl.getByText('published 2026-11-10 · 0.1.0')).toBeVisible()
    await expect(page.getByText('the registry has')).toHaveCount(0)
    await page.getByRole('link', { name: 'Log' }).click()
    await expect(
      page
        .getByRole('article', { name: /^Run \d+$/ })
        .locator('.run-command')
        .filter({ hasText: 'tessl plugin info acme/probe --json' })
    ).toHaveCount(1)
    await page.getByRole('link', { name: 'Loadout' }).click()
    await page
      .getByRole('article', { name: 'probe', exact: true })
      .getByRole('button', { name: 'probe', exact: true })
      .click()

    answer(info('0.0.9'))
    await check.click()
    await expect(strip).toContainText(
      'The manifest in ~/Code/Skills/probe says 0.1.0; the registry has 0.0.9. Version 0.1.0 is not published.'
    )
    await expect(strip.getByRole('button', { name: 'Publish' })).toBeVisible()

    answer(info('0.2.0'))
    await check.click()
    await expect(strip).toContainText(
      'The registry has 0.2.0; the manifest in ~/Code/Skills/probe says 0.1.0. A newer version was published from another copy of this skill. Bring that copy into this folder before you publish again.'
    )
    await expect(strip.getByRole('button', { name: 'Publish' })).toHaveCount(0)

    answer(info('0.1.0', { archived: true, archivedReason: 'Old.' }))
    await check.click()
    await expect(tessl.getByText('ARCHIVED')).toHaveAttribute(
      'title',
      'Archived on the registry: Old.'
    )

    // A whole-plugin archive names no latest version: archived, not pending, and no strip.
    answer(
      JSON.parse(
        readFileSync(join(ROOT, 'tests', 'fixtures', 'tessl', 'plugin-info-archived.json'), 'utf8')
      )
    )
    await check.click()
    await expect(tessl.getByText('archived', { exact: true })).toBeVisible()
    await expect(tessl.getByText('ARCHIVED', { exact: true })).toHaveAttribute(
      'title',
      'Archived on the registry: Replaced by a newer helper'
    )
    await expect(tessl.getByText('pending', { exact: true })).toHaveCount(0)
    await expect(strip).toHaveCount(0)

    // Exit 0 with no version yet: Tessl is still moderating.
    answer(
      JSON.parse(
        readFileSync(join(ROOT, 'tests', 'fixtures', 'tessl', 'plugin-info-pending.json'), 'utf8')
      )
    )
    await check.click()
    await expect(page.locator('.check-strip').getByText('PENDING', { exact: true })).toBeVisible()
    await expect(page.locator('.check-strip')).toContainText(
      'Tessl is checking the new version; it shows on the registry in a few minutes.'
    )
    await expect(tessl.getByText('pending', { exact: true })).toBeVisible()
    await expect(strip.getByRole('button', { name: 'Publish' })).toHaveCount(0)

    answer({ err: 'plugin-info-not-found.txt', code: 1 })
    await check.click()
    await expect(page.locator('.check-strip').getByText('NOT FOUND', { exact: true })).toBeVisible()
    await expect(page.locator('.check-strip')).toContainText(
      'acme/probe is not on the registry, or your Tessl account has no access to it.'
    )
    await expect(tessl.getByText('not found', { exact: true })).toBeVisible()

    answer({ err: 'plugin-info-logged-out.txt', code: 1 })
    await check.click()
    await expect(
      page.locator('.check-strip').getByText('CHECK FAILED', { exact: true })
    ).toBeVisible()
    await expect(page.locator('.check-strip')).toContainText(
      'Could not check acme/probe on the registry: Please authenticate with Tessl to continue. Run `tessl login` to sign up or log in.'
    )
    await expect(tessl.getByText('check failed', { exact: true })).toBeVisible()

    // An entry without a manifest is refused before any run.
    expect(
      await page.evaluate(() => window.loadout.invoke('check-registry', { skill: 'probe-gh' }))
    ).toEqual({
      ok: false,
      message: '"probe-gh" has no Tessl manifest in ~/.loadout/repos/acme/tools/skills/probe-gh.'
    })

    answer(info('0.0.9'))
    await check.click()
    await strip.getByRole('button', { name: 'Publish' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('probe')
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    // The registry still shows the old version right after the publish: pending, not folder ahead.
    answer(info('0.1.0'))
    await strip.getByRole('button', { name: 'Publish' }).click()
    await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.locator('.skill-result')).toHaveText('· published 0.1.1')
    await expect(tessl.getByText('pending', { exact: true })).toBeVisible()
    await expect(page.locator('.check-strip').getByText('PENDING', { exact: true })).toBeVisible()
    await expect(page.getByText('is not published')).toHaveCount(0)

    // The follow-up re-check finds the new version without a click, then stops.
    answer(info('0.1.1'))
    await expect(tessl.getByText('published 2026-11-10 · 0.1.1')).toBeVisible()
    await expect(strip).toHaveCount(0)
    await page.getByRole('link', { name: 'Log' }).click()
    const commands = page.getByRole('article', { name: /^Run \d+$/ }).locator('.run-command')
    const texts = await commands.allTextContents()
    const at = (needle: string): number => texts.findIndex((t) => t.includes(needle))
    const lookups = (list: string[]): number =>
      list
        .slice(
          0,
          list.findIndex((t) => t.includes('skill publish'))
        )
        .filter((t) => t.includes('tessl plugin info acme/probe --json')).length
    // The Log lists the newest run first: the in-job lookup and at least one re-check follow the publish.
    expect(at('skill publish')).toBeGreaterThan(-1)
    const found = lookups(texts)
    expect(found).toBeGreaterThanOrEqual(2)
    // More than three intervals later no further re-check has run.
    await page.waitForTimeout(2000)
    expect(lookups(await commands.allTextContents())).toBe(found)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

/**
 * A fake home whose probe has manifest 0.1.0 and a registry that answers `version`; the fake
 * Publish writes 0.1.1, so a Publish while the registry has 0.1.0 ends pending.
 */
function registryHome(version: string): {
  home: string
  env: Record<string, string>
  answer: (version: string) => void
} {
  const { home, env } = fakeHome()
  const folder = join(home, 'Code', 'Skills', 'probe')
  mkdirSync(join(folder, '.tessl-plugin'), { recursive: true })
  writeFileSync(
    join(folder, '.tessl-plugin', 'plugin.json'),
    '{"name":"acme/probe","version":"0.1.0"}'
  )
  const answer = (v: string): void =>
    writeFileSync(
      join(home, 'plugin-info.json'),
      JSON.stringify({
        tile: { fullName: 'acme/probe', latestVersion: v, archived: false, deprecated: false },
        version: { version: v, createdAt: '2026-11-10T12:00:00.000Z' }
      })
    )
  answer(version)
  return { home, env, answer }
}

/** Publishes probe once the startup check has found tessl. */
async function publishProbe(page: Page): Promise<void> {
  await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({ timeout: 10000 })
  const result = await page.evaluate(() =>
    window.loadout.invoke('publish', {
      skill: 'probe',
      bump: 'patch',
      workspace: 'acme',
      commit: false
    })
  )
  expect(result).toMatchObject({ ok: true })
}

/** The registry lookups in the Log, newest first. */
const lookupRuns = (page: Page): Locator =>
  page
    .getByRole('article', { name: /^Run \d+$/ })
    .locator('.run-command')
    .filter({ hasText: 'tessl plugin info acme/probe --json' })

test('tessl status: a re-check that falls in a running command is skipped; the next one runs', async () => {
  const { home, env, answer } = registryHome('0.1.0')
  // Its fetch sleeps 5 s: a Check on it is busy across the first re-check at 4 s, not the second at 8 s.
  addSkill(home, '.loadout/repos', 'acme/slow/skills/s', 'probe-slow')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env, LOADOUT_RECHECK_MS: '4000' } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'probe', exact: true }).click()
    const tessl = page.getByRole('region', { name: 'Tessl' })
    await publishProbe(page)
    void page.evaluate(() => window.loadout.invoke('check', { skill: 'probe-slow' }))
    await expect(page.locator('.rail-status', { hasText: /^BUSY$/ })).toBeVisible()
    answer('0.1.1')
    await expect(page.locator('.rail-status', { hasText: /^BUSY$/ })).toBeHidden({ timeout: 10000 })
    // The Check has ended and the first re-check did not run: still pending.
    await expect(tessl.getByText('pending', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Log' }).click()
    await expect(lookupRuns(page)).toHaveCount(1)
    // The second re-check runs as planned and finds the new version.
    await expect(lookupRuns(page)).toHaveCount(2, { timeout: 10000 })
    await page.getByRole('link', { name: 'Loadout' }).click()
    await page.getByRole('button', { name: 'probe', exact: true }).click()
    await expect(tessl.getByText('published 2026-11-10 · 0.1.1')).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('tessl status: re-checks stop after the third; the version stays pending until found', async () => {
  const { home, env, answer } = registryHome('0.1.0')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env, LOADOUT_RECHECK_MS: '1000' } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await publishProbe(page)
    await page.getByRole('link', { name: 'Log' }).click()
    // The in-job lookup and three re-checks, all still pending. A 1 s gap keeps each re-check clear
    // of the one before it, which would otherwise be skipped as busy.
    await expect(lookupRuns(page)).toHaveCount(4, { timeout: 10000 })
    await page.waitForTimeout(1500)
    await expect(lookupRuns(page)).toHaveCount(4)
    // A refresh after the re-checks still reads the older registry version as pending.
    await page.getByRole('link', { name: 'Loadout' }).click()
    await page.getByRole('button', { name: 'probe', exact: true }).click()
    const tessl = page.getByRole('region', { name: 'Tessl' })
    const strip = page.locator('.intel-strip, .check-strip')
    const refresh = tessl.getByRole('button', { name: 'Check the registry' })
    await refresh.click()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible()
    await page.getByRole('link', { name: 'Log' }).click()
    await expect(lookupRuns(page)).toHaveCount(5)
    await page.getByRole('link', { name: 'Loadout' }).click()
    await page.getByRole('button', { name: 'probe', exact: true }).click()
    await expect(strip.getByText('PENDING', { exact: true })).toBeVisible()
    await expect(page.getByText('is not published')).toHaveCount(0)
    // The first answer that is not pending ends it: an older version then reads as folder ahead.
    answer('0.1.1')
    await refresh.click()
    await expect(tessl.getByText('published 2026-11-10 · 0.1.1')).toBeVisible()
    answer('0.1.0')
    await refresh.click()
    await expect(strip).toContainText('Version 0.1.1 is not published.')
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('skill page: briefing renders markdown, escapes HTML, blocks link navigation', async () => {
  const { home, env } = fakeHome()
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'probe', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Probe', exact: true })).toBeVisible()
    await expect(page.locator('.md strong')).toHaveText('bold')
    await expect(page.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
    await expect(page.locator('.md img')).toHaveCount(0)
    await expect(page.getByText('SIZE')).toBeVisible()
    await expect(page.getByText('SKILL.md · read-only')).toBeVisible()
    // A blocked navigation never finishes, so a later Playwright click or assertion would wait for it.
    // Click inside the page, read the page with evaluate, and end the test here.
    await expect(page.locator('.md a')).toHaveAttribute('href', 'http://example.invalid/docs')
    const url = page.url()
    await page.evaluate(() => document.querySelector<HTMLElement>('.md a')?.click())
    await page.waitForTimeout(500)
    expect(page.url()).toBe(url)
    expect(await page.evaluate(() => document.querySelector('.md h1')?.textContent)).toBe('Probe')
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('skill page: briefing shows a folded YAML description whole and a nested map below its key', async () => {
  const { home, env } = fakeHome()
  writeFileSync(
    join(home, 'Code', 'Skills', 'probe', 'SKILL.md'),
    [
      '---',
      'name: probe',
      'description: >-',
      '  Use when starting (STATUS, roadmap,',
      '  ADRs, project tier): "set up the docs".',
      'metadata:',
      '  version: "1.0"',
      '---',
      '# Probe',
      ''
    ].join('\n')
  )
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'probe', exact: true }).click()
    const rows = page.locator('.frontmatter > div')
    await expect(rows).toHaveText([
      'name: probe',
      'description: Use when starting (STATUS, roadmap, ADRs, project tier): "set up the docs".',
      'metadata: \n  version: "1.0"'
    ])
    // The nested map takes its own line below the key: its row is two lines high, the name row one.
    const name = await rows.nth(0).boundingBox()
    const metadata = await rows.nth(2).boundingBox()
    expect(metadata!.height).toBeGreaterThan(name!.height * 1.5)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('shows Refresh after a failed load and recovers', async () => {
  const { home, env } = fakeHome()
  const library = join(home, '.loadout', 'skills')
  chmodSync(library, 0o000)
  const app = await _electron.launch({
    args: [`--user-data-dir=${join(home, 'electron-data')}`, join(ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible()
    chmodSync(library, 0o755)
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.getByRole('checkbox', { name: 'probe Claude Code' })).toBeVisible()
    await expect(page.getByRole('alert')).toBeHidden()
    // The startup check still ran, so commands are not refused as busy.
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible()
  } finally {
    chmodSync(library, 0o755)
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('first launch: empty library, no agent, claude missing', async () => {
  const { home, env } = fakeHome()
  rmSync(join(home, '.loadout', 'skills', 'probe'), { force: true })
  rmSync(join(home, '.loadout', 'skills', 'probe-gh'), { force: true })
  rmSync(join(home, '.claude', 'skills', 'probe'), { force: true })
  rmSync(join(home, 'fakebin', 'claude'), { force: true })
  writeFileSync(join(home, '.loadout', 'config.json'), serializeConfig(DEFAULT_CONFIG))
  const app = await _electron.launch({
    args: [`--user-data-dir=${join(home, 'electron-data')}`, join(ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await skipBriefing(page)
    // No agent is enabled, so BOOT CAMP opens first.
    await page.getByRole('link', { name: 'Loadout' }).click()
    await expect(page.getByText('Your loadout is empty')).toBeVisible()
    await expect(page.getByText('No agent enabled.')).toBeVisible()
    const platoon = page.getByRole('complementary', { name: 'Platoon' })
    // The window can show after the first hover, which resets :hover; hover again.
    await expect(async () => {
      await platoon.getByText('claude not found').hover()
      await expect(platoon.getByText(/claude\.ai\/install\.sh/)).toBeVisible({ timeout: 1000 })
    }).toPass()
    // Settings shows only "not found"; the install hint is a tooltip on it.
    await page.mouse.move(0, 0)
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Settings' })
      .click()
    const systems = page.getByRole('dialog').getByRole('region', { name: 'Systems' })
    const missing = systems.locator('.tip', { hasText: 'not found' })
    await expect(missing).toBeVisible()
    const hint = systems.locator('[role="tooltip"]')
    await expect(hint).toHaveText(/claude\.ai\/install\.sh/)
    await expect(hint).toBeHidden()
    await expect(async () => {
      await missing.hover()
      await expect(hint).toBeVisible({ timeout: 1000 })
    }).toPass()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('boot camp: opens at first launch with no agent', async () => {
  const { home, env } = fakeHome()
  rmSync(join(home, '.claude', 'skills', 'probe'), { force: true })
  rmSync(join(home, 'fakebin', 'git'), { force: true })
  rmSync(join(home, 'fakebin', 'tessl'), { force: true })
  writeFileSync(join(home, '.loadout', 'config.json'), serializeConfig(DEFAULT_CONFIG))
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    const camp = page.getByRole('region', { name: 'BOOT CAMP' })
    await expect(camp.getByRole('heading', { name: 'BOOT CAMP' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'BOOT CAMP' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    // At the default window width the rank badge carries the count; the header line is empty.
    await expect(camp.locator('.page-line')).toHaveText('')
    await expect(camp.locator('.bc-rank-count')).toHaveText('0 OF 3 DONE')
    await expect(camp.locator('.bc-rank-word')).toHaveText('RECRUIT')
    await expect(camp.locator('.bc-badge .band.on')).toHaveCount(0)
    await expect(camp.locator('.bc-meter')).toHaveCount(0)
    await expect(
      camp.getByText(
        'Loadout keeps one list of your skills and turns each skill on or off per agent, with links. Your skill folders stay where they are.'
      )
    ).toBeVisible()
    const step = (name: string): Locator => camp.getByRole('region', { name })
    await expect(step('AGENTS').locator('.bc-head .bc-chip')).toHaveText('TO DO')
    await expect(step('GIT').locator('.bc-head .bc-chip')).toHaveText('TO DO')
    await expect(step('TESSL').locator('.bc-head .bc-chip')).toHaveText('OPTIONAL')
    await expect(step('GIT').getByText('git not found.')).toBeVisible()
    await expect(step('GIT').getByText('INSTALL GIT', { exact: true })).toBeVisible()
    await expect(step('TESSL').getByText('tessl not found.')).toBeVisible()
    await expect(step('TESSL').getByText('INSTALL TESSL', { exact: true })).toBeVisible()
    await expect(page.locator('.bc-exit')).toHaveCount(0)
    await expect(page.locator('.bc-side')).toHaveCount(0)
    await expect(page.locator('.bc-pic')).toHaveCount(0)
    for (const size of [
      { w: 1280, h: 820 },
      { w: 1024, h: 640 }
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(s.w, s.h),
        size
      )
      await expect.poll(() => page.evaluate(() => globalThis.innerWidth)).toBe(size.w)
      const at = `${size.w} × ${size.h}`
      const m = await page.evaluate(() => {
        const scroll = document.querySelector('.bc-scroll')!
        const main = document.querySelector<HTMLElement>('.main-col')!
        return {
          fits:
            document.scrollingElement!.scrollWidth <= globalThis.innerWidth &&
            scroll.scrollWidth <= scroll.clientWidth,
          words: main.innerText.split(/\s+/).filter(Boolean).length,
          screens: scroll.scrollHeight / scroll.clientHeight
        }
      })
      test.info().annotations.push({
        type: 'count',
        description: `${at}: ${m.words} words, ${m.screens.toFixed(2)} screens`
      })
      expect(m.fits, `${at}: no sideways scroll`).toBe(true)
      if (size.w === 1280) {
        expect(m.words, `${at}: words`).toBeLessThan(350)
        expect(m.screens, `${at}: screens`).toBeLessThanOrEqual(3)
        // The rank badge box shares its top edge with the AGENTS card.
        const badge = (await camp.locator('.bc-rank-box').boundingBox())!
        const agents = (await camp.locator('#bc-step-agents').boundingBox())!
        expect(Math.abs(badge.y - agents.y), `${at}: badge top`).toBeLessThanOrEqual(0.5)
      } else {
        // Under 1200 px the header meter carries the progress and the badge column is gone.
        await expect(camp.locator('.bc-rank')).toHaveCount(0)
        await expect(camp.locator('.bc-meter span')).toHaveCount(3)
        await expect(camp.locator('.page-line')).toHaveText('0 OF 3 DONE')
      }
    }
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('boot camp: an enabled agent opens the Loadout page', async () => {
  const { home, env } = fakeHome()
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    // The page is decided on the first state; wait for content that needs it.
    await expect(
      page
        .getByText('Your loadout is empty')
        .or(page.getByRole('article', { name: 'probe', exact: true }))
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Loadout' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(page.getByRole('link', { name: 'BOOT CAMP' })).not.toHaveAttribute(
      'aria-current',
      'page'
    )
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('boot camp: un-enlisting the last agent does not switch pages', async () => {
  const { home, env } = fakeHome()
  // Switching an agent off needs no skill enabled for it.
  rmSync(join(home, '.claude', 'skills', 'probe'), { force: true })
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('article', { name: 'probe', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'BOOT CAMP' }).click()
    const camp = page.getByRole('region', { name: 'BOOT CAMP' })
    const count = camp.locator('.bc-rank-count')
    // The fake home has git and a logged-in Tessl with a default workspace.
    await expect(count).toHaveText('3 OF 3 DONE')
    await expect(camp.locator('.bc-rank-word')).toHaveText('READY FOR DUTY')
    await expect(camp.locator('.bc-badge .band.on')).toHaveCount(3)
    await expect(camp.locator('.bc-exit')).toBeVisible()
    await camp.getByRole('checkbox', { name: 'Enlist Claude Code' }).uncheck()
    await expect(camp.locator('.bc-exit')).toHaveCount(0)
    await expect(count).toHaveText('2 OF 3 DONE')
    await expect(camp.locator('.bc-rank-word')).toHaveText('RECRUIT')
    await expect(camp.locator('.page-line')).toHaveText('')
    await expect(page.getByRole('link', { name: 'BOOT CAMP' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('boot camp: un-enlisting an agent with skills on is refused', async () => {
  // The fake home has probe on for Claude Code.
  const { home, env } = fakeHome()
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('article', { name: 'probe', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'BOOT CAMP' }).click()
    const camp = page.getByRole('region', { name: 'BOOT CAMP' })
    const enlist = camp.getByRole('checkbox', { name: 'Enlist Claude Code' })
    // A plain click: uncheck() fails when the page puts the switch back.
    await enlist.click()
    await expect(camp.getByRole('alert')).toHaveText(
      'Turn off the 1 skill enabled for Claude Code first.'
    )
    await expect(enlist).toBeChecked()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('settings: the refusal to turn off an agent shows inside the dialog', async () => {
  // The fake home has probe on for Claude Code.
  const { home, env } = fakeHome()
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible()
    await page.getByRole('button', { name: 'Enlist agent' }).click()
    const settings = page.getByRole('dialog')
    const enable = settings.getByRole('checkbox', { name: 'Enable Claude Code' })
    await enable.click()
    await expect(settings.getByRole('alert')).toHaveText(
      'Turn off the 1 skill enabled for Claude Code first.'
    )
    await expect(enable).toBeChecked()
    await settings.getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('systems: a tool that does not run', async () => {
  const { home, env } = fakeHome()
  writeFileSync(join(home, 'fakebin', 'git'), '#!/bin/sh\nexit 1\n')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    const platoon = page.getByRole('complementary', { name: 'Platoon' })
    await expect(platoon.getByText('git does not run')).toBeVisible({ timeout: 10000 })
    await expect(platoon.getByText('git not found')).toHaveCount(0)
    await expect(async () => {
      await platoon.getByText('git does not run').hover()
      await expect(
        platoon.getByText('Install git: xcode-select --install. Press Refresh afterwards.')
      ).toBeVisible({ timeout: 1000 })
    }).toPass()
    await page.getByRole('button', { name: /RECRUIT SKILL/ }).click()
    await expect(page.getByRole('button', { name: 'Add from link' })).toBeDisabled()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('recon: VIEW and every agent folder', async () => {
  const { home, env } = fakeHome()
  const config = structuredClone(DEFAULT_CONFIG)
  config.agents[0].enabled = true
  config.agents[1].enabled = false
  config.tesslWorkspace = 'acme'
  writeFileSync(join(home, '.loadout', 'config.json'), serializeConfig(config))
  mkdirSync(join(home, '.codex', 'skills', 'stray'), { recursive: true })
  writeFileSync(join(home, '.codex', 'skills', 'stray', 'SKILL.md'), '---\nname: stray\n---\n')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    const platoon = page.getByRole('complementary', { name: 'Platoon' })
    await expect(platoon.getByRole('button', { name: 'VIEW →' })).toBeVisible({ timeout: 10000 })
    await platoon.getByRole('button', { name: 'VIEW →' }).click()
    await expect(page.getByText(/2 AGENT FOLDERS SCANNED/)).toBeVisible()
    const folders = page.getByRole('complementary', { name: 'Folders scanned' })
    await expect(folders.getByText('Codex', { exact: true })).toBeVisible()
    await expect(folders.getByText('not enabled')).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

/** Adds a library skill `name` whose folder is `<root>/<dir>`, with a SKILL.md. */
function addSkill(home: string, root: string, dir: string, name: string): void {
  const folder = join(home, root, dir)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: A probe.\n---\n`)
  symlinkSync(folder, join(home, '.loadout', 'skills', name))
}

declare const window: { loadout: LoadoutApi }

test('checks: Intel, strips and update all', async () => {
  const { home, env } = fakeHome()
  addSkill(home, '.tessl/plugins', 'acme/kit/skills/probe-t', 'probe-t')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('article', { name: 'probe-t', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Intel' }).click()
    await expect(
      page.getByText(
        "Your own skills get no update checks. Review, Fix and Publish them from each skill's page; there, the refresh button on the TESSL card compares a published skill with the Tessl Registry."
      )
    ).toBeVisible()
    await expect(page.getByText('NOT CHECKED THIS SESSION')).toBeVisible()
    await expect(page.getByRole('status').getByText('NO INTEL YET')).toBeVisible()
    await page.getByRole('status').getByRole('button', { name: 'Check all' }).click()
    const tools = page.getByRole('article', { name: 'acme/tools' })
    await expect(tools.getByText('2 BEHIND')).toBeVisible()
    await expect(tools.getByText('def5678')).toBeVisible()
    await expect(tools.getByText('Second change')).toBeVisible()
    await expect(
      page.getByRole('article', { name: 'acme/kit' }).getByText('0.1.0 → 0.1.1')
    ).toBeVisible()
    await expect(page.locator('.rail-badge')).toHaveText('2')
    await tools.getByRole('button', { name: 'View diff' }).click()
    await expect(page.locator('.diff-line.add')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Intel' })).toHaveAttribute('aria-current', 'page')
    await page.getByRole('button', { name: 'Back to Intel' }).click()
    await expect(tools.getByText('2 BEHIND')).toBeVisible()

    await page.getByRole('link', { name: 'Loadout' }).click()
    await expect(page.getByText('2 updates available — probe-gh, probe-t')).toBeVisible()
    await page
      .getByRole('article', { name: 'probe-gh', exact: true })
      .getByRole('button', { name: 'Intel for probe-gh' })
      .click()
    await expect(page.getByText('Update available — 2 commits behind origin/main')).toBeVisible()
    await expect(page.getByText('COMMIT', { exact: true }).locator('..')).toContainText('abc1234')
    await page.getByRole('tab', { name: 'Diff' }).click()
    await expect(page.locator('.diff-line.add')).toHaveText('+description: A better GitHub probe.')
    await expect(page.locator('.diff-line.del')).toHaveText('-description: A GitHub probe.')
    await page.getByRole('button', { name: 'Update', exact: true }).click()
    // Review focus 4: the page re-reads after the update, and the strip and Diff tab are gone.
    await expect(page.getByText(/Update available/)).toBeHidden()
    await expect(page.getByRole('tab', { name: 'Diff' })).toBeHidden()
    await expect(page.locator('.frontmatter')).toContainText('A better GitHub probe.')
    await expect(page.getByText('COMMIT', { exact: true }).locator('..')).toContainText('def5678')
    await page.getByRole('tab', { name: 'History' }).click()
    await expect(page.getByText('Second change')).toBeVisible()
    await page.getByRole('button', { name: 'Back to Loadout' }).click()
    await expect(page.getByText('1 update available — probe-t')).toBeVisible()
    await page.getByRole('button', { name: 'Update all' }).click()
    await expect(page.getByText(/updates? available —/)).toBeHidden()
    await page.getByRole('link', { name: 'Intel' }).click()
    await expect(page.getByRole('article', { name: 'acme/kit' })).toBeHidden()
    await expect(page.getByText('UP TO DATE · 2')).toBeVisible()
    await expect(page.getByRole('status').getByText('ALL QUIET')).toBeVisible()
    await expect(page.getByText(/Every tracked source is up to date · checked/)).toBeVisible()

    await page.getByRole('link', { name: 'Log' }).click()
    const run = (action: string): Locator =>
      page
        .getByRole('article', { name: /^Run \d+$/ })
        .filter({ has: page.getByText(action, { exact: true }) })
    await expect(run('CHECK').first().getByText('EXIT 0')).toBeVisible()
    await expect(run('UPDATE').first().getByText('EXIT 0')).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('check all goes on past a failed and a dirty clone; update all still works', async () => {
  const { home, env } = fakeHome()
  addSkill(home, '.loadout/repos', 'acme/broken/skills/b', 'probe-broken')
  addSkill(home, '.loadout/repos', 'acme/dirty/skills/d', 'probe-dirty')
  addSkill(home, '.loadout/repos', 'acme/diverged/skills/v', 'probe-diverged')
  addSkill(home, '.loadout/repos', 'acme/noupstream/skills/n', 'probe-noupstream')
  addSkill(home, '.loadout/repos', 'acme/current/skills/c', 'probe-current')
  const repos = join(home, '.loadout', 'repos', 'acme')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('article', { name: 'probe-dirty', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Intel' }).click()
    await page.getByRole('button', { name: 'Check all', exact: true }).click()
    const broken = page.getByRole('article', { name: 'acme/broken' })
    await expect(broken.getByText('CHECK FAILED', { exact: true })).toBeVisible()
    await expect(broken.getByText('Check failed (exit 128), see the log.')).toBeVisible()
    const dirty = page.getByRole('article', { name: 'acme/dirty' })
    await expect(dirty.getByText('BLOCKED', { exact: true })).toBeVisible()
    await expect(
      dirty.getByText(
        `The clone has local edits; update refused. Files: SKILL.md. Commit or discard them in ${join(repos, 'dirty')} first.`
      )
    ).toBeVisible()
    await expect(dirty.getByRole('button', { name: 'Reveal clone' })).toBeVisible()
    const diverged = page.getByRole('article', { name: 'acme/diverged' })
    await expect(diverged.getByText('BLOCKED', { exact: true })).toBeVisible()
    await expect(
      diverged.getByText(
        `The clone has commits that are not on origin/main; update refused. Fix it with git in ${join(repos, 'diverged')} first.`
      )
    ).toBeVisible()
    const noUpstream = page.getByRole('article', { name: 'acme/noupstream' })
    await expect(noUpstream.getByText('CHECK FAILED', { exact: true })).toBeVisible()
    await expect(noUpstream.getByText('Check failed (exit 128), see the log.')).toBeVisible()
    await expect(page.getByText('UP TO DATE · 1')).toBeVisible()
    await expect(
      page.getByRole('complementary', { name: 'Sources' }).getByText('acme/current')
    ).toBeVisible()
    await expect(
      page.getByRole('article', { name: 'acme/tools' }).getByText('2 BEHIND')
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Check all', exact: true })).toBeEnabled()

    await page.getByRole('button', { name: 'Update all' }).click()
    await expect(page.getByRole('article', { name: 'acme/tools' })).toBeHidden()
    await expect(page.getByText('UP TO DATE · 2')).toBeVisible()
    await expect(page.getByRole('alert')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Update all' })).toBeDisabled()
    expect(await page.evaluate(() => window.loadout.invoke('update-all'))).toEqual({
      ok: false,
      message: 'No source is ready to update; press Check all first.'
    })
    expect(await page.evaluate(() => window.loadout.invoke('check', { skill: 'probe' }))).toEqual({
      ok: false,
      message: '"probe" is not a GitHub or Tessl source.'
    })

    await page.getByRole('link', { name: 'Log' }).click()
    await expect(
      page
        .getByRole('article', { name: /^Run \d+$/ })
        .filter({ hasText: 'acme/noupstream fetch' })
        .getByText("fatal: no upstream configured for branch 'main'")
    ).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('update all names the source whose pull failed and updates the others', async () => {
  const { home, env } = fakeHome()
  addSkill(home, '.loadout/repos', 'acme/pullfail/skills/p', 'probe-pullfail')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('article', { name: 'probe-pullfail', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Intel' }).click()
    await page.getByRole('button', { name: 'Check all', exact: true }).click()
    await expect(
      page.getByRole('article', { name: 'acme/pullfail' }).getByText('2 BEHIND')
    ).toBeVisible()
    await expect(
      page.getByRole('article', { name: 'acme/tools' }).getByText('2 BEHIND')
    ).toBeVisible()

    await page.getByRole('link', { name: 'Loadout' }).click()
    await page.getByRole('button', { name: 'Update all' }).click()
    await expect(page.getByRole('alert')).toHaveText(
      'Update all: 1 source failed (acme/pullfail); see the log.'
    )
    await expect(
      page.getByRole('article', { name: 'probe-gh', exact: true }).getByText('updated')
    ).toBeVisible()
    await page.getByRole('link', { name: 'Intel' }).click()
    await expect(
      page.getByRole('complementary', { name: 'Sources' }).getByText('acme/tools')
    ).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('cancel in check all stops the running fetch and skips the rest', async () => {
  const { home, env } = fakeHome()
  rmSync(join(home, '.loadout', 'skills', 'probe-gh'))
  addSkill(home, '.loadout/repos', 'acme/a-slow/skills/a', 'probe-a')
  addSkill(home, '.loadout/repos', 'acme/b/skills/b', 'probe-b')
  addSkill(home, '.loadout/repos', 'acme/c/skills/c', 'probe-c')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('article', { name: 'probe-a', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Intel' }).click()
    await page.getByRole('button', { name: 'Check all', exact: true }).click()
    // The skill page reads while a command runs.
    await page.getByRole('link', { name: 'Loadout' }).click()
    await page.getByRole('button', { name: 'probe-a', exact: true }).click()
    await expect(page.locator('.frontmatter')).toContainText('name: probe-a')
    await expect(page.locator('.rail-status', { hasText: /^BUSY$/ })).toBeVisible()
    await page.getByRole('link', { name: 'Log' }).click()
    // The slow fetch is really running when Cancel is pressed.
    await expect(page.locator('.run-strip-command')).toContainText('acme/a-slow fetch')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('alert')).toHaveText('Check all cancelled; 2 sources not checked.')
    await expect(
      page.getByRole('article', { name: /^Run \d+$/ }).getByText('CANCELLED', { exact: true })
    ).toBeVisible()
    await page.getByRole('link', { name: 'Recon' }).click()
    await expect(page.getByRole('button', { name: 'Rescan' })).toBeEnabled()
    await page.getByRole('link', { name: 'Intel' }).click()
    await expect(
      page.getByRole('article', { name: 'acme/a-slow' }).getByText('Check failed, see the log.')
    ).toBeVisible()
    await expect(page.getByRole('article', { name: 'acme/b' })).toBeHidden()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('the window opens before the tool check, which shows MUSTERING until it ends', async () => {
  const { home, env } = fakeHome()
  const config = structuredClone(DEFAULT_CONFIG)
  config.agents[0].enabled = true
  writeFileSync(join(home, '.loadout', 'config.json'), serializeConfig(config))
  const app = await _electron.launch({
    args: launchArgs(home),
    // Longer than a slow first paint when tests run in parallel, so MUSTERING is still up.
    env: { ...process.env, ...env, FAKE_WHOAMI_SLEEP: '8' } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    const rail = page.getByRole('navigation', { name: 'Main' })
    await expect(rail.locator('.rail-status', { hasText: /^MUSTERING$/ })).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Claude Code' }).getByText('MUSTERING')
    ).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'probe Claude Code' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Recruit skill' })).toBeVisible()
    await expect(rail.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 20000
    })
    await expect(page.getByRole('region', { name: 'Claude Code' }).getByText('READY')).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'probe Claude Code' })).toBeEnabled()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('recon: MISSING and NOT A LINK cards, and Remove on a missing skill', async () => {
  const { home, env } = fakeHome()
  const library = join(home, '.loadout', 'skills')
  symlinkSync(join(home, 'gone', 'probe-gone'), join(library, 'probe-gone'))
  mkdirSync(join(library, 'probe-real'))
  writeFileSync(join(library, 'probe-real', 'SKILL.md'), '---\nname: probe-real\n---\n')
  mkdirSync(join(home, '.loadout', 'reviews'))
  writeFileSync(
    join(home, '.loadout', 'reviews', 'probe-gone.json'),
    '{"reviewedAt":1000,"fingerprint":"x","tessl":{"review":{"reviewScore":50}}}'
  )
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(
      page.getByRole('article', { name: 'probe-gone', exact: true }).getByText('MISSING')
    ).toBeVisible()
    // The REVIEW tab of a missing skill says the folder is gone, not that the skill changed.
    await page.getByRole('button', { name: 'probe-gone', exact: true }).click()
    await page.getByRole('tab', { name: 'Review' }).click()
    await expect(page.getByText(/^The source folder is gone/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'RUN REVIEW' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Back to Loadout' }).click()
    await page.getByRole('link', { name: 'Recon' }).click()
    const issues = page.getByRole('region', { name: 'Loadout issues' })
    await expect(issues.getByText('LOADOUT ISSUES · 2')).toBeVisible()
    const missing = issues.getByRole('article', { name: 'probe-gone' })
    await expect(missing.getByText('MISSING')).toBeVisible()
    await expect(missing.getByText('~/gone/probe-gone')).toBeVisible()
    await expect(missing.getByRole('button', { name: 'Relocate' })).toBeEnabled()
    const notALink = issues.getByRole('article', { name: 'probe-real' })
    await expect(notALink.getByText('NOT A LINK')).toBeVisible()
    // Reveal and Relocate are not clicked: they open a real Finder window or folder picker.
    await expect(notALink.getByRole('button', { name: 'Reveal' })).toBeEnabled()
    await expect(notALink.getByRole('button', { name: 'Remove' })).toHaveCount(0)
    await missing.getByRole('button', { name: 'Remove' }).click()
    await expectWindowDrag(page.getByRole('dialog'))
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
    await expect(missing).toBeHidden()
    await expect(issues.getByText('LOADOUT ISSUES · 1')).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('intel: VIEW DIFF on a source with two skills opens a menu of its skills', async () => {
  const { home, env } = fakeHome()
  addSkill(home, '.loadout/repos', 'acme/tools/skills/probe-gh2', 'probe-gh2')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('article', { name: 'probe-gh2', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Intel' }).click()
    await page.getByRole('status').getByRole('button', { name: 'Check all' }).click()
    const tools = page.getByRole('article', { name: 'acme/tools' })
    await expect(tools.getByText('2 BEHIND')).toBeVisible()
    await tools.getByRole('button', { name: 'View diff' }).click()
    await expect(page.getByRole('button', { name: 'probe-gh', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'probe-gh2', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Diff' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('heading', { name: 'probe-gh2' })).toBeVisible()
    await page.getByRole('button', { name: 'Back to Intel' }).click()
    await expect(tools).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('intel: one checked source does not make every source up to date', async () => {
  const { home, env } = fakeHome()
  addSkill(home, '.loadout/repos', 'acme/current/skills/c', 'probe-current')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible()
    const card = page.getByRole('article', { name: 'probe-current', exact: true })
    await page.getByLabel('Actions for probe-current', { exact: true }).click()
    await page.getByRole('button', { name: 'Check source' }).click()
    await expect(card.getByText('up to date')).toBeVisible()

    await page.getByRole('link', { name: 'Intel' }).click()
    const empty = page.getByRole('status')
    await expect(empty.getByText('ALL QUIET')).toBeHidden()
    await expect(empty.getByText('PARTIAL INTEL')).toBeVisible()
    await expect(
      empty.getByText('1 of 2 tracked sources not checked this session: acme/tools.')
    ).toBeVisible()
    await expect(page.getByText(/· 1 NOT CHECKED$/)).toBeVisible()

    await empty.getByRole('button', { name: 'Check all' }).click()
    await expect(
      page.getByRole('article', { name: 'acme/tools' }).getByText('2 BEHIND')
    ).toBeVisible()
    await expect(page.getByText(/NOT CHECKED/)).toBeHidden()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('recruit: editing the link drops the earlier scan', async () => {
  const { home, env } = fakeHome()
  // An existing clone, so Scan reads it without `git clone`.
  const folder = join(home, '.loadout', 'repos', 'acme', 'other', 'skills', 'new-link')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'SKILL.md'), '---\nname: new-link\ndescription: A probe.\n---\n')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible()
    await page.getByRole('button', { name: 'Recruit skill' }).click()
    await page.getByRole('button', { name: 'Add from link' }).click()
    const dialog = page.getByRole('dialog')
    await expectWindowDrag(dialog)
    await dialog.getByLabel('GitHub link').fill('acme/other')
    await dialog.getByRole('button', { name: 'Scan' }).click()
    await dialog.getByRole('checkbox', { name: 'Add skills/new-link' }).check()
    await expect(dialog.getByRole('button', { name: 'Add' })).toBeEnabled()

    await dialog.getByLabel('GitHub link').fill('acme/different')
    await expect(dialog.getByRole('checkbox', { name: 'Add skills/new-link' })).toBeHidden()
    await expect(dialog.getByRole('button', { name: 'Add' })).toBeHidden()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('recruit: the header checkbox ticks and clears every skill it can add', async () => {
  const { home, env } = fakeHome()
  // An existing clone, so Scan reads it without `git clone`; `probe` is already in the library.
  for (const name of ['new-a', 'new-b', 'probe']) {
    const folder = join(home, '.loadout', 'repos', 'acme', 'many', 'skills', name)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: A probe.\n---\n`)
  }
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible()
    await page.getByRole('button', { name: 'Recruit skill' }).click()
    await page.getByRole('button', { name: 'Add from link' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('GitHub link').fill('acme/many')
    await dialog.getByRole('button', { name: 'Scan' }).click()
    const all = dialog.getByRole('checkbox', { name: 'Add all skills' })
    const a = dialog.getByRole('checkbox', { name: 'Add skills/new-a' })
    const b = dialog.getByRole('checkbox', { name: 'Add skills/new-b' })
    const probe = dialog.getByRole('checkbox', { name: 'Add skills/probe' })
    await expect(probe).toBeDisabled()

    await all.check()
    await expect(a).toBeChecked()
    await expect(b).toBeChecked()
    await expect(probe).not.toBeChecked()
    await expect(dialog.getByRole('button', { name: 'Add' })).toBeEnabled()

    await b.uncheck()
    await expect(all).not.toBeChecked()
    await expect(all).toHaveJSProperty('indeterminate', true)

    await all.check()
    await expect(b).toBeChecked()
    await all.uncheck()
    await expect(a).not.toBeChecked()
    await expect(b).not.toBeChecked()
    await expect(all).toHaveJSProperty('indeterminate', false)
    await expect(dialog.getByRole('button', { name: 'Add' })).toBeDisabled()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('recruit: a skill already recruited from the same link shows ticked', async () => {
  const { home, env } = fakeHome()
  // `owned` comes from acme/many; `probe` is a local skill with the same name as one in the clone.
  addSkill(home, '.loadout/repos', 'acme/many/skills/owned', 'owned')
  for (const name of ['new-a', 'probe']) {
    const folder = join(home, '.loadout', 'repos', 'acme', 'many', 'skills', name)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: A probe.\n---\n`)
  }
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible()
    await page.getByRole('button', { name: 'Recruit skill' }).click()
    await page.getByRole('button', { name: 'Add from link' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('GitHub link').fill('acme/many')
    await dialog.getByRole('button', { name: 'Scan' }).click()
    const owned = dialog.getByRole('checkbox', { name: 'Add skills/owned' })
    const probe = dialog.getByRole('checkbox', { name: 'Add skills/probe' })
    await expect(owned).toBeChecked()
    await expect(owned).toBeDisabled()
    await expect(probe).not.toBeChecked()
    await expect(probe).toBeDisabled()
    await expect(dialog.getByRole('checkbox', { name: 'Add all skills' })).not.toBeChecked()
    await expect(dialog.getByRole('button', { name: 'Add' })).toBeDisabled()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('recruit: the agent boxes deploy the added skills', async () => {
  const { home, env } = fakeHome()
  const config = structuredClone(DEFAULT_CONFIG)
  config.agents[0].enabled = true
  config.agents[1].enabled = true
  writeFileSync(join(home, '.loadout', 'config.json'), serializeConfig(config))
  for (const name of ['new-a', 'new-b']) {
    const folder = join(home, '.loadout', 'repos', 'acme', 'many', 'skills', name)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: A probe.\n---\n`)
  }
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible()
    await page.getByRole('button', { name: 'Recruit skill' }).click()
    await page.getByRole('button', { name: 'Add from link' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('GitHub link').fill('acme/many')
    await dialog.getByRole('button', { name: 'Scan' }).click()
    await dialog.getByRole('checkbox', { name: 'Add skills/new-a' }).check()
    const cc = dialog.getByRole('checkbox', { name: 'Deploy to Claude Code' })
    await expect(cc).not.toBeChecked()
    await expect(dialog.getByRole('checkbox', { name: 'Deploy to Codex' })).not.toBeChecked()
    await cc.check()
    await dialog.getByRole('button', { name: 'Add' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => existsSync(join(home, '.claude', 'skills', 'new-a'))).toBe(true)
    expect(existsSync(join(home, '.codex', 'skills', 'new-a'))).toBe(false)
    expect(existsSync(join(home, '.claude', 'skills', 'new-b'))).toBe(false)

    // The boxes start clear at the next open.
    await page.getByRole('button', { name: 'Recruit skill' }).click()
    await page.getByRole('button', { name: 'Add from link' }).click()
    await dialog.getByLabel('GitHub link').fill('acme/many')
    await dialog.getByRole('button', { name: 'Scan' }).click()
    await expect(dialog.getByRole('checkbox', { name: 'Deploy to Claude Code' })).not.toBeChecked()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test("recruit: the Registry dialog lists a workspace's plugins", async () => {
  const { home, env } = fakeHome()
  // `kit` is in the library, so its row says so; `beta/other` is on disk, so the row click's Scan reads it.
  addSkill(home, '.tessl/plugins', 'acme/kit/skills/probe-t', 'probe-t')
  const other = join(home, '.tessl', 'plugins', 'beta', 'other', 'skills', 'other-skill')
  mkdirSync(other, { recursive: true })
  writeFileSync(join(other, 'SKILL.md'), '---\nname: other-skill\ndescription: A probe.\n---\n')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible()
    await page.getByRole('button', { name: 'Recruit skill' }).click()
    await page.getByRole('button', { name: 'Add from registry' }).click()
    const dialog = page.getByRole('dialog')
    const picker = dialog.getByRole('button', { name: 'Workspace', exact: true })
    await expect(picker).toHaveText('acme')
    const open = dialog.getByRole('button', { name: 'Plugins of the workspace' })
    await open.click()
    const kit = dialog.getByRole('menuitem', { name: 'kit 0.1.0 in library' })
    await expect(kit).toBeVisible()
    await expect(kit).toBeDisabled()
    await expect(dialog.getByText('nokit')).toBeHidden()
    await open.click()
    await expect(kit).toBeHidden()

    await picker.click()
    await dialog.getByRole('menuitemradio', { name: 'beta' }).click()
    await expect(picker).toHaveText('beta')
    await open.click()
    const row = dialog.getByRole('menuitem', { name: 'other', exact: true })
    await expect(row).toBeVisible()
    await expect(dialog.getByText('Other.')).toBeHidden()
    await row.click()
    await expect(row).toBeHidden()
    const field = dialog.getByLabel('Tessl plugin')
    await expect(field).toHaveValue('beta/other')
    await expect(dialog.getByRole('checkbox', { name: 'Add skills/other-skill' })).toBeHidden()
    await dialog.getByRole('button', { name: 'Scan' }).click()
    await expect(dialog.getByRole('checkbox', { name: 'Add skills/other-skill' })).toBeVisible()
    expect(readFileSync(join(home, 'tessl-args.log'), 'utf8')).toContain(
      'search --json --workspace 2 beta'
    )
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('the Fix dialog closes when its skill leaves the library', async () => {
  const { home, env } = fakeHome()
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await page.getByLabel('Actions for probe', { exact: true }).click()
    await page.getByRole('button', { name: 'Tessl fix' }).click()
    const runFix = page.getByRole('button', { name: 'Run Fix' })
    await expect(runFix).toBeVisible()
    await expectWindowDrag(page.getByRole('dialog'))
    await page.evaluate(() => window.loadout.invoke('remove', { skill: 'probe' }))
    await expect(runFix).toBeHidden()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('busy: Run Fix and Publish are disabled, and no Update starts inside a Check', async () => {
  const { home, env } = fakeHome()
  addSkill(home, '.loadout/repos', 'acme/lagging/skills/s', 'probe-slow')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  // A Check on probe-slow: its rev-list sleeps 3 s after the fetch. Started from the page, so it
  // runs behind an open dialog.
  const startCheck = (): Promise<void> =>
    page.evaluate(() => {
      void window.loadout.invoke('check', { skill: 'probe-slow' })
    })
  const idle = async (): Promise<void> => {
    await expect
      .poll(
        async () => {
          const result = await page.evaluate(() => window.loadout.invoke('get-state'))
          return result.ok ? result.state.busy : 'error'
        },
        { timeout: 10_000 }
      )
      .toBeNull()
  }
  const page = await app.firstWindow()
  try {
    await expect(page.getByRole('article', { name: 'probe-slow', exact: true })).toBeVisible()
    await page.getByLabel('Actions for probe', { exact: true }).click()
    await page.getByRole('button', { name: 'Tessl fix' }).click()
    const runFix = page.getByRole('button', { name: 'Run Fix' })
    await expect(runFix).toBeEnabled()
    await startCheck()
    await expect(runFix).toBeDisabled()
    await page.getByRole('button', { name: 'Cancel' }).click()
    // The fetch has ended; the quiet reads after it still belong to the Check.
    await page.getByRole('link', { name: 'Log' }).click()
    await expect(page.getByRole('article', { name: /^Run \d+$/ }).getByText('EXIT 0')).toBeVisible()
    expect(
      await page.evaluate(() => window.loadout.invoke('update', { skill: 'probe-slow' }))
    ).toEqual({ ok: false, message: 'Another command is running.' })
    expect(
      await page.evaluate(() => window.loadout.invoke('check-registry', { skill: 'probe' }))
    ).toEqual({ ok: false, message: 'Another command is running.' })
    await idle()

    await page.getByRole('link', { name: 'Loadout' }).click()
    await page.getByLabel('Actions for probe', { exact: true }).click()
    await page.getByRole('button', { name: 'Tessl publish' }).click()
    const publish = page.getByRole('button', { name: 'Publish', exact: true })
    await expect(publish).toBeEnabled()
    await startCheck()
    await expect(publish).toBeDisabled()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await idle()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('saved review: score on the card, REVIEW tab, restart, stale on change', async () => {
  const { home, env } = fakeHome()
  copyFileSync(
    join(ROOT, 'tests', 'fixtures', 'tessl', 'review-run.json'),
    join(home, 'review.json')
  )
  const saved = join(home, '.loadout', 'reviews', 'probe.json')
  const launch = (): ReturnType<typeof _electron.launch> =>
    _electron.launch({
      args: launchArgs(home),
      env: { ...process.env, ...env } as Record<string, string>
    })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    const probe = page.getByRole('article', { name: 'probe', exact: true })
    await expect(probe).toBeVisible()
    const before = (await probe.boundingBox())?.height
    await page.getByLabel('Actions for probe', { exact: true }).click()
    await page.getByRole('button', { name: 'Tessl review' }).click()
    const score = probe.getByRole('button', { name: 'Review probe' })
    await expect(score).toHaveText('65/100 · just now')
    expect((await probe.boundingBox())?.height).toBe(before)
    expect(existsSync(saved)).toBe(true)
    await score.click()
    await expect(page.getByRole('tab', { name: 'Review' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText(/^The SKILL.md body is a concise/)).toBeVisible()
    await expect(page.getByText('16 checks passed')).toBeVisible()
    await page.getByRole('button', { name: 'Back to Loadout' }).click()

    await app.close()
    app = await launch()
    page = await app.firstWindow()
    const again = page.getByRole('article', { name: 'probe', exact: true })
    await expect(again.getByRole('button', { name: 'Review probe' })).toHaveText(/^65\/100 · /)

    appendFileSync(join(home, 'Code', 'Skills', 'probe', 'SKILL.md'), 'One more line.\n')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('focus'))
    await expect(again.getByRole('button', { name: 'Review probe' })).toBeHidden()
    await page.getByRole('button', { name: 'probe', exact: true }).click()
    await page.getByRole('tab', { name: 'Review' }).click()
    await expect(
      page.getByText(/^The skill changed after the last review \(65\/100, /)
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'RUN REVIEW' })).toBeEnabled()
    // A review that exits 0 with output Loadout cannot read keeps the old file and says so.
    writeFileSync(join(home, 'review.json'), 'not json')
    await page.getByRole('button', { name: 'RUN REVIEW' }).click()
    await expect(page.locator('.skill-result')).toHaveText('· review done, see the log')
    await page.getByRole('button', { name: 'Back to Loadout' }).click()

    await page.getByLabel('Actions for probe', { exact: true }).click()
    await page.getByRole('button', { name: 'Remove' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
    await expect.poll(() => existsSync(saved)).toBe(false)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('fix: FIXED on the card, FIX tab, undo, keep, undo blocked after an edit, review across the fix', async () => {
  const { home, env } = fakeHome()
  const skillMd = join(home, 'Code', 'Skills', 'probe', 'SKILL.md')
  const references = join(home, 'Code', 'Skills', 'probe', 'references')
  const saved = join(home, '.loadout', 'fixes', 'probe')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    const probe = page.getByRole('article', { name: 'probe', exact: true })
    const runFix = async (): Promise<void> => {
      await page.getByLabel('Actions for probe', { exact: true }).click()
      await page.getByRole('button', { name: 'Tessl fix' }).click()
      await page.getByRole('button', { name: 'Run Fix' }).click()
    }
    // A review before the fix: the fake prints 90/100 without review.json.
    const score = probe.getByRole('button', { name: 'Review probe' })
    await page.getByLabel('Actions for probe', { exact: true }).click()
    await page.getByRole('button', { name: 'Tessl review' }).click()
    await expect(score).toHaveText('90/100 · just now')
    await runFix()
    await expect(score).toBeHidden()
    const fixed = probe.getByRole('button', { name: 'Fix probe' })
    await expect(fixed).toHaveText('fixed · just now')
    await expect(probe.getByText('see the log')).toBeHidden()
    await fixed.click()
    await expect(page.getByRole('tab', { name: 'Fix' })).toHaveAttribute('aria-selected', 'true')
    const list = page.locator('.fix-files')
    await expect(list.getByText('SKILL.md')).toBeVisible()
    await expect(list.locator('li', { hasText: 'references/new.md' })).toContainText('ADDED')
    await expect(list.locator('li', { hasText: 'SKILL.md' })).toContainText('CHANGED')
    await expect(page.getByText('Fixed line.')).toBeVisible()
    await page.getByRole('radio', { name: 'before' }).click()
    await expect(page.getByText('Fixed line.')).toBeHidden()
    await expect(
      page.getByRole('region', { name: 'references/new.md' }).getByText('Not in this version.')
    ).toBeVisible()

    await page.getByRole('button', { name: 'UNDO FIX' }).click()
    await expect(page.getByRole('tab', { name: 'Fix' })).toBeHidden()
    expect(readFileSync(skillMd, 'utf8')).not.toContain('Fixed line.')
    expect(existsSync(references)).toBe(false)
    expect(existsSync(saved)).toBe(false)
    // The card is hidden behind the skill page; the header shows the current review.
    const header = page.locator('.skill-result')
    await expect(header).toHaveText('· review 90/100 · just now')

    await runFix()
    await expect(page.getByRole('tab', { name: 'Fix' })).toBeVisible()
    // BEFORE was picked for the first fix; the new fix opens on AFTER.
    await page.getByRole('tab', { name: 'Fix' }).click()
    await expect(page.getByRole('radio', { name: 'after' })).toHaveAttribute('aria-checked', 'true')
    appendFileSync(skillMd, 'My own edit.\n')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('focus'))
    await page.getByRole('tab', { name: 'Fix' }).click()
    await expect(page.getByRole('button', { name: 'UNDO FIX' })).toBeDisabled()
    await expect(page.getByText(/^The skill changed after the fix/)).toBeVisible()
    await page.getByRole('tab', { name: 'Review' }).click()
    await expect(
      page.getByText(/^The skill changed after the last review \(90\/100, /)
    ).toBeVisible()
    await page.getByRole('tab', { name: 'Fix' }).click()
    // KEEP FIX runs a review of the kept folder; review.json makes it distinct from the first.
    copyFileSync(
      join(ROOT, 'tests', 'fixtures', 'tessl', 'review-run.json'),
      join(home, 'review.json')
    )
    await page.getByRole('button', { name: 'KEEP FIX' }).click()
    await expect(page.getByRole('tab', { name: 'Fix' })).toBeHidden()
    expect(readFileSync(skillMd, 'utf8')).toContain('Fixed line.')
    expect(existsSync(saved)).toBe(false)
    await expect(header).toHaveText('· review 65/100 · just now')
    await page.getByRole('tab', { name: 'Review' }).click()
    await expect(page.getByText('16 checks passed')).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

/** The fake bin has no agent enabled, so BOOT CAMP opens first. */
function bootCampHome(): { home: string; env: Record<string, string>; bin: string } {
  const { home, env } = fakeHome()
  rmSync(join(home, '.claude', 'skills', 'probe'), { force: true })
  writeFileSync(join(home, '.loadout', 'config.json'), serializeConfig(DEFAULT_CONFIG))
  return { home, env, bin: join(home, 'fakebin') }
}

function fakeTool(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

test('boot camp: git missing, then found after CHECK AGAIN', async () => {
  const { home, env, bin } = bootCampHome()
  const fakeGit = readFileSync(join(bin, 'git'), 'utf8')
  rmSync(join(bin, 'git'))
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await skipBriefing(page)
    // The main handler is replaced, so the test never writes the real macOS clipboard.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('copy-text')
      ipcMain.handle('copy-text', (_event, { text }: { text: string }) => {
        ;(globalThis as unknown as { copied: string }).copied = text
        return { ok: true }
      })
    })
    const git = page.getByRole('region', { name: 'GIT' })
    await expect(git.getByText('git not found.')).toBeVisible()
    await expect(git.getByText('INSTALL GIT', { exact: true })).toBeVisible()
    await expect(git.locator('.bc-cmd')).toContainText('xcode-select --install')
    await expect(
      git.getByText(
        "macOS opens an installer window for Apple's command line developer tools; follow it to the end."
      )
    ).toBeVisible()
    await expect(git.locator('.bc-chip')).toHaveText('TO DO')
    await git.getByRole('button', { name: 'Copy the command' }).click()
    await expect(git.getByRole('button', { name: 'Copy the command' })).toHaveText('COPIED')
    expect(await app.evaluate(() => (globalThis as unknown as { copied: string }).copied)).toBe(
      'xcode-select --install'
    )
    fakeTool(join(bin, 'git'), fakeGit.replace(/^#!\/bin\/sh\n/, ''))
    await git.getByRole('button', { name: 'CHECK AGAIN' }).click()
    await expect(git.locator('.bc-status')).toContainText(
      /git 2\.47\.0 found at .*\/fakebin\/git\./
    )
    await expect(git.locator('.bc-chip')).toHaveText('DONE')
    await expect(git.getByText('INSTALL GIT', { exact: true })).toBeHidden()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('boot camp: git does not run', async () => {
  const { home, env, bin } = bootCampHome()
  fakeTool(join(bin, 'git'), 'exit 1')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    const git = page.getByRole('region', { name: 'GIT' })
    await expect(git.locator('.bc-status')).toContainText(/git at .*\/fakebin\/git does not run\./)
    await expect(git.getByText('INSTALL GIT', { exact: true })).toBeVisible()
    await expect(git.getByText(/is a placeholder/)).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('boot camp: Homebrew commands first', async () => {
  const { home, env, bin } = bootCampHome()
  rmSync(join(bin, 'git'))
  fakeTool(join(bin, 'brew'), 'exit 0')
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    const install = page.getByRole('region', { name: 'GIT' }).locator('.bc-install')
    await expect(install).toBeVisible()
    expect(await install.innerText()).toMatch(
      /WITH HOMEBREW[\s\S]*brew install git[\s\S]*WITHOUT HOMEBREW[\s\S]*xcode-select --install/
    )
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('boot camp: checking while the tool check runs', async () => {
  const { home, env } = bootCampHome()
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env, FAKE_WHOAMI_SLEEP: '3' } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    const git = page.getByRole('region', { name: 'GIT' })
    const agents = page.getByRole('region', { name: 'AGENTS' })
    await expect(git.getByText('Checking git…')).toBeVisible()
    await expect(git.locator('.bc-chip')).toHaveText('CHECKING…')
    await expect(git.getByText('git not found.')).toHaveCount(0)
    await expect(git.getByText('INSTALL GIT', { exact: true })).toHaveCount(0)
    await expect(agents.locator('.bc-line')).toHaveCount(0)
    await expect(git.locator('.bc-chip')).toHaveText('DONE', { timeout: 10000 })
    await expect(
      agents.locator('.bc-agent').filter({ hasText: 'Claude Code' }).locator('.bc-line')
    ).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('boot camp: the page keeps its state while CHECK AGAIN checks', async () => {
  const { home, env, bin } = bootCampHome()
  rmSync(join(bin, 'git'))
  const config = structuredClone(DEFAULT_CONFIG)
  config.agents[0].enabled = true
  writeFileSync(join(home, '.loadout', 'config.json'), serializeConfig(config))
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env, FAKE_WHOAMI_SLEEP: '3' } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('article', { name: 'probe', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'BOOT CAMP' }).click()
    const camp = page.getByRole('region', { name: 'BOOT CAMP' })
    const git = camp.getByRole('region', { name: 'GIT' })
    const line = camp.locator('.bc-rank-count')
    await expect(git.getByText('git not found.')).toBeVisible({ timeout: 10000 })
    await expect(line).toHaveText('1 OF 3 DONE')
    await git.getByRole('button', { name: 'CHECK AGAIN' }).click()
    const mustering = page.locator('.rail-status', { hasText: /^MUSTERING$/ })
    await expect(mustering).toBeVisible()
    await expect(line).toHaveText('1 OF 3 DONE')
    await expect(git.locator('.bc-chip')).toHaveText('TO DO')
    await expect(camp.locator('.bc-exit')).toBeVisible()
    await expect(git.getByText('INSTALL GIT', { exact: true })).toBeVisible()
    await expect(git.getByRole('button', { name: 'CHECK AGAIN' })).toBeDisabled()
    // The assertions above ran while the check ran.
    await expect(mustering).toBeVisible()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    await expect(git.getByText('git not found.')).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('boot camp: the page keeps its state while a Refresh from another page checks', async () => {
  const { home, env } = fakeHome()
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env, FAKE_WHOAMI_SLEEP: '3' } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    await page.getByRole('button', { name: 'Refresh' }).click()
    const mustering = page.locator('.rail-status', { hasText: /^MUSTERING$/ })
    await expect(mustering).toBeVisible()
    await page.getByRole('link', { name: 'BOOT CAMP' }).click()
    const git = page.getByRole('region', { name: 'BOOT CAMP' }).getByRole('region', { name: 'GIT' })
    await expect(git).toBeVisible()
    // Read once, without retries: a retrying assertion would pass after the check ends.
    expect(await git.locator('.bc-chip').textContent()).toBe('DONE')
    expect(await git.locator('.bc-status').textContent()).toContain('git 2.47.0 found')
    await expect(mustering).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('boot camp: CHECK AGAIN is disabled while a command runs', async () => {
  const { home, env, bin } = bootCampHome()
  // `git --version` fails, so the install block shows; a slow Tessl review keeps the app busy.
  fakeTool(join(bin, 'git'), 'exit 1')
  const fakeTessl = readFileSync(join(bin, 'tessl'), 'utf8').replace(
    /^#!\/bin\/sh\n/,
    '#!/bin/sh\nif [ "$1 $2" = "review run" ]; then /bin/sleep 5; fi\n'
  )
  writeFileSync(join(bin, 'tessl'), fakeTessl)
  const config = structuredClone(DEFAULT_CONFIG)
  config.tesslWorkspace = 'acme'
  writeFileSync(join(home, '.loadout', 'config.json'), serializeConfig(config))
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    const git = page.getByRole('region', { name: 'GIT' })
    await expect(git.getByRole('button', { name: 'CHECK AGAIN' })).toBeEnabled()
    await expect(git.getByRole('button', { name: 'OPEN TERMINAL' })).toBeEnabled()
    await page.evaluate(() => {
      void window.loadout.invoke('review', { skill: 'probe' })
    })
    await expect(git.getByRole('button', { name: 'CHECK AGAIN' })).toBeDisabled()
    await expect(git.getByRole('button', { name: 'OPEN TERMINAL' })).toBeDisabled()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('boot camp: Tessl next step only', async () => {
  const { home, env, bin } = bootCampHome()
  const fakeTessl = readFileSync(join(bin, 'tessl'), 'utf8')
  const launch = (): ReturnType<typeof _electron.launch> =>
    _electron.launch({
      args: launchArgs(home),
      env: { ...process.env, ...env } as Record<string, string>
    })
  fakeTool(
    join(bin, 'tessl'),
    `if [ "$1" = whoami ]; then echo '{"authenticated": false}'; exit 1; fi
echo 0.119.0`
  )
  let app = await launch()
  try {
    const page = await app.firstWindow()
    await skipBriefing(page)
    const tessl = page.getByRole('region', { name: 'TESSL' })
    await expect(tessl.locator('.bc-chip')).toHaveText('OPTIONAL')
    await expect(tessl.locator('.bc-status')).toContainText(/tessl 0\.119\.0 found at/)
    await expect(tessl.getByText('LOG IN', { exact: true })).toBeVisible()
    await expect(tessl.locator('.bc-cmd')).toContainText('tessl login')
    await expect(
      tessl.getByText(
        'The Tessl login page opens in your browser. If you have no Tessl account, the login page lets you create one.'
      )
    ).toBeVisible()
    await expect(tessl.getByRole('button', { name: 'OPEN TERMINAL' })).toBeEnabled()
    await expect(tessl.getByRole('button', { name: 'CHECK AGAIN' })).toBeEnabled()
    await expect(tessl.getByText('INSTALL TESSL', { exact: true })).toHaveCount(0)
    await expect(tessl.getByRole('button', { name: 'OPEN SETTINGS' })).toHaveCount(0)
  } finally {
    await app.close()
  }
  // Logged in, no default workspace.
  writeFileSync(join(bin, 'tessl'), fakeTessl)
  app = await launch()
  try {
    const page = await app.firstWindow()
    await skipBriefing(page)
    const tessl = page.getByRole('region', { name: 'TESSL' })
    await expect(
      tessl.getByText(
        'Logged in as acme-dev. Pick your default workspace in Settings; Review and Fix use it.'
      )
    ).toBeVisible()
    await expect(tessl.getByRole('button', { name: 'OPEN SETTINGS' })).toBeEnabled()
    await expect(tessl.getByText('LOG IN', { exact: true })).toHaveCount(0)
    await tessl.getByRole('button', { name: 'OPEN SETTINGS' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
  } finally {
    await app.close()
  }
  // All set.
  const config = structuredClone(DEFAULT_CONFIG)
  config.tesslWorkspace = 'acme'
  writeFileSync(join(home, '.loadout', 'config.json'), serializeConfig(config))
  app = await launch()
  try {
    const page = await app.firstWindow()
    const tessl = page.getByRole('region', { name: 'TESSL' })
    await expect(tessl.getByText('Logged in as acme-dev, default workspace acme.')).toBeVisible()
    await expect(tessl.locator('.bc-chip')).toHaveText('DONE')
    await expect(tessl.getByRole('button')).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('boot camp: enlist an agent', async () => {
  const { home, env, bin } = bootCampHome()
  rmSync(join(bin, 'codex'))
  const config = structuredClone(DEFAULT_CONFIG)
  config.agents.push({
    id: 'x',
    label: 'Other',
    command: 'foo',
    folder: join(home, '.other', 'skills'),
    alsoReadBy: [],
    enabled: false
  })
  writeFileSync(join(home, '.loadout', 'config.json'), serializeConfig(config))
  const folders = [join(home, '.claude', 'skills'), join(home, '.codex', 'skills')]
  const before = listing(folders)
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await skipBriefing(page)
    const camp = page.getByRole('region', { name: 'BOOT CAMP' })
    const section = camp.getByRole('region', { name: 'AGENTS' })
    const row = (name: string): Locator => section.locator('.bc-agent').filter({ hasText: name })
    const claude = row('Claude Code')
    const codex = row('Codex')
    const other = row('Other')
    await expect(claude.locator('.bc-status')).toHaveText('claude found on this Mac.')
    // The entry is the fake home's dangling deep-research link.
    await expect(claude.locator('.bc-line')).toHaveText(
      '1 entry is already in this folder. Loadout leaves it as it is. See Recon'
    )
    await expect(claude.getByRole('button', { name: 'See Recon' })).toBeVisible()
    await expect(claude.locator('.bc-install')).toHaveCount(0)
    await expect(codex.locator('.bc-status')).toHaveText('codex not found on this Mac.')
    await expect(codex.getByText('INSTALL CODEX', { exact: true })).toBeVisible()
    await expect(codex.getByText('Loadout creates this folder at your first toggle.')).toBeVisible()
    await expect(other.locator('.bc-status')).toHaveText('foo not found on this Mac.')
    await expect(other.locator('.bc-install')).toHaveCount(0)
    await expect(section.locator('.bc-head .bc-chip')).toHaveText('TO DO')
    await expect(camp.locator('.bc-exit')).toHaveCount(0)
    await expect(claude.locator('.switch-label')).toHaveText('ENLIST')
    await claude.getByRole('checkbox', { name: 'Enlist Claude Code' }).check()
    await expect(claude.locator('.switch-label')).toHaveText('ENLISTED')
    await expect(section.locator('.bc-head .bc-chip')).toHaveText('DONE')
    // The fake bin has git, so step 2 is done too.
    await expect(camp.locator('.bc-rank-count')).toHaveText('2 OF 3 DONE')
    await expect(camp.locator('.bc-rank-word')).toHaveText('READY FOR DUTY')
    const exit = camp.locator('.bc-exit')
    await expect(exit).toBeVisible()
    await expect(exit.getByText('READY', { exact: true })).toBeVisible()
    await expect(exit).toContainText('Add your first skill on the Loadout page with Recruit skill.')
    await expect
      .poll(() => {
        const saved = savedConfig(home) as { agents: { id: string; enabled: boolean }[] } | null
        return saved?.agents.find((a) => a.id === 'claude-code')?.enabled
      })
      .toBe(true)
    await claude.getByRole('button', { name: 'See Recon' }).click()
    await expect(page.getByRole('link', { name: 'Recon' })).toHaveAttribute('aria-current', 'page')
    await page.getByRole('link', { name: 'BOOT CAMP' }).click()
    // Only a dangling link is in the folder: nothing to recruit, so the strip points at Loadout.
    await camp.getByRole('button', { name: 'GO TO LOADOUT' }).click()
    await expect(page.getByRole('link', { name: 'Loadout' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  } finally {
    await app.close()
  }
  expect(listing(folders)).toEqual(before)
  rmSync(home, { recursive: true, force: true })
})

/** Every path under the folders with its type and link target, sorted; a missing folder is one row. */
function listing(folders: string[]): string[] {
  const rows: string[] = []
  const walk = (path: string): void => {
    const st = lstatSync(path)
    const type = st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : 'file'
    rows.push(`${path} ${type} ${type === 'link' ? readlinkSync(path) : ''}`)
    if (type === 'dir') for (const name of readdirSync(path)) walk(join(path, name))
  }
  for (const folder of folders) {
    if (existsSync(folder)) walk(folder)
    else rows.push(`${folder} missing`)
  }
  return rows.sort()
}
