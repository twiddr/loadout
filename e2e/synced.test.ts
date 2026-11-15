import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CONFIG, serializeConfig } from '../src/core/config'
import { overridesBlock } from '../src/core/synced'
import { fakeHome } from './support/fake-home'
import {
  ACCOUNT,
  ORG,
  addLibrarySkill,
  addSynced,
  launch,
  writeClaudeSettings
} from './support/synced'

const NAMES = ['pdf', 'probe', 'probe-gh']
const LEAD_2 =
  '2 skills in your loadout are also synced from claude.ai. Claude Code loads the synced copies whatever the Loadout toggles say. To turn them off, add one of these to ~/.claude/settings.json. Loadout never changes that file.'
const LEAD_1 =
  '1 skill in your loadout is also synced from claude.ai. Claude Code loads the synced copy whatever the Loadout toggles say. To turn it off, add one of these to ~/.claude/settings.json. Loadout never changes that file.'
const NOTE_OVERRIDES =
  'Keeps the other synced skills. If the file already has "skillOverrides", add the lines inside it. A new overlap needs a new line.'
const NOTE_SYNC_OFF =
  'Removes every synced skill from Claude Code, including pdf, docx, xlsx and pptx. Loadout can then no longer show whether a claude.ai copy differs.'
const ICON_CLEAR =
  'Also synced from claude.ai. Claude Code loads the synced copy. Open the skill for the fix.'
const ICON_DIMMED = 'Also on claude.ai. Claude Code does not load the synced copy.'

/** The fake home seeded with the plan's three synced skills: `probe` and `probe-gh` are overlaps. */
function seededHome(): { home: string; env: Record<string, string> } {
  const fake = fakeHome()
  addSynced(fake.home, {
    probe: readFileSync(join(fake.home, 'Code', 'Skills', 'probe', 'SKILL.md'), 'utf8'),
    'probe-gh': '---\nname: probe-gh\ndescription: An older copy.\n---\n',
    pdf: '---\nname: pdf\n---\n'
  })
  return fake
}

/** Removes probe's link from ~/.claude/skills and writes a config with Claude Code off and Codex on. */
function disableClaude(home: string): void {
  rmSync(join(home, '.claude', 'skills', 'probe'), { force: true })
  const config = structuredClone(DEFAULT_CONFIG)
  config.agents[0].enabled = false
  config.agents[1].enabled = true
  config.tesslWorkspace = 'acme'
  writeFileSync(join(home, '.loadout', 'config.json'), serializeConfig(config))
}

/** The card icon, in either state: both labels name claude.ai. */
function syncedIcons(scope: Page | ReturnType<Page['locator']>): ReturnType<Page['locator']> {
  return scope.getByRole('img', { name: /claude\.ai/ })
}

async function openRecon(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow()
  await page.getByRole('link', { name: 'Recon' }).click()
  return page
}

/** The three rows directly after the `synced` row. */
function syncedRows(page: Page): ReturnType<Page['locator']> {
  return page
    .getByRole('region', { name: 'Unmanaged' })
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'synced', exact: true }) })
    .locator('xpath=following-sibling::tr[position() <= 3]')
}

async function expectRows(page: Page): Promise<void> {
  const unmanaged = page.getByRole('region', { name: 'Unmanaged' })
  const rows = syncedRows(page)
  for (const [i, name] of NAMES.entries()) {
    const row = rows.nth(i)
    await expect(row.getByRole('cell', { name, exact: true })).toBeVisible()
    await expect(row.getByText('SYNCED', { exact: true })).toBeVisible()
    await expect(row.getByText(`anthropic-skills:${name}`, { exact: true })).toBeVisible()
  }
  await expect(unmanaged.getByText('stale-only')).toHaveCount(0)
  await expect(rows.nth(0).getByText('IN LOADOUT', { exact: true })).toHaveCount(0)
  await expect(rows.nth(1).getByText('IN LOADOUT', { exact: true })).toBeVisible()
  await expect(rows.nth(2).getByText('IN LOADOUT', { exact: true })).toBeVisible()
  await expect(unmanaged.getByText('IN LOADOUT', { exact: true })).toHaveCount(2)
}

test('synced: recon rows, the mark and the fix block', async () => {
  const { home, env } = seededHome()
  const app = await launch(home, env)
  try {
    const page = await openRecon(app)
    const unmanaged = page.getByRole('region', { name: 'Unmanaged' })
    const syncedRow = unmanaged
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: 'synced', exact: true }) })
    await expect(syncedRow).toContainText('Synced from your claude.ai account · 3 skills')
    // The `synced` name starts folded: no rows and no fix block until it unfolds.
    const fold = syncedRow.getByRole('button', { name: 'synced', exact: true })
    await expect(fold).toHaveAttribute('aria-expanded', 'false')
    await expect(unmanaged.getByText('SYNCED', { exact: true })).toHaveCount(0)
    await fold.click()
    await expect(fold).toHaveAttribute('aria-expanded', 'true')
    await expectRows(page)
    await expect(page.getByText(/^2 UNMANAGED ·/)).toBeVisible()

    const fix = unmanaged.getByRole('region', { name: 'Also in your loadout' })
    await expect(fix.getByText('ALSO IN YOUR LOADOUT · 2', { exact: true })).toBeVisible()
    await expect(fix.getByText(LEAD_2, { exact: true })).toBeVisible()
    await expect(fix.getByText('TURN OFF THESE 2 SYNCED COPIES', { exact: true })).toBeVisible()
    await expect(fix.getByText('OR TURN THE SYNC OFF', { exact: true })).toBeVisible()
    await expect(fix.getByText(NOTE_OVERRIDES, { exact: true })).toBeVisible()
    await expect(fix.getByText(NOTE_SYNC_OFF, { exact: true })).toBeVisible()
    await expect(
      fix.getByText('Press RESCAN after you save the file.', { exact: true })
    ).toBeVisible()

    // The `synced` name folds its rows and the fix block again, and unfolds them again.
    await fold.click()
    await expect(fold).toHaveAttribute('aria-expanded', 'false')
    await expect(unmanaged.getByText('SYNCED', { exact: true })).toHaveCount(0)
    await expect(fix).toHaveCount(0)
    await fold.click()
    await expectRows(page)
    await expect(fix).toBeVisible()

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
    const copied = (): Promise<string | undefined> =>
      app.evaluate(() => (globalThis as unknown as { copied?: string }).copied)
    await stubCopy(false)
    await fix.getByRole('button', { name: 'Copy: TURN OFF THESE 2 SYNCED COPIES' }).click()
    await expect.poll(copied).toBe(overridesBlock(['probe', 'probe-gh']))
    await fix.getByRole('button', { name: 'Copy: OR TURN THE SYNC OFF' }).click()
    await expect.poll(copied).toBe('"syncClaudeAiSkills": false')
    await stubCopy(true)
    await fix.getByRole('button', { name: 'Copy: OR TURN THE SYNC OFF' }).click()
    await expect(page.getByRole('alert')).toHaveText('Copy failed: stub failure')
    await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click()

    const rescan = page.getByRole('button', { name: 'Rescan' })
    writeClaudeSettings(home, { skillOverrides: { 'anthropic-skills:probe-gh': 'off' } })
    await rescan.click()
    await expect(fix.getByText('ALSO IN YOUR LOADOUT · 1', { exact: true })).toBeVisible()
    await expect(fix.getByText(LEAD_1, { exact: true })).toBeVisible()
    await expect(fix.getByText('TURN OFF THIS SYNCED COPY', { exact: true })).toBeVisible()
    await expect
      .poll(() => fix.locator('pre.copy-block').first().textContent())
      .toBe(overridesBlock(['probe']))

    writeClaudeSettings(home, {
      skillOverrides: { 'anthropic-skills:probe': 'off', 'anthropic-skills:probe-gh': 'off' }
    })
    await rescan.click()
    await expect(fix).toHaveCount(0)
    await expectRows(page)

    writeClaudeSettings(home, { syncClaudeAiSkills: false })
    await rescan.click()
    await expect(syncedRow).toContainText(
      'Synced from your claude.ai account · 3 skills · sync off, not loaded'
    )
    await expect(fix).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('synced: no live bucket falls back to the one-folder row', async () => {
  const { home, env } = fakeHome()
  mkdirSync(join(home, '.claude/skills/synced/x_y/pdf'), { recursive: true })
  const app = await launch(home, env)
  try {
    const first = await app.firstWindow()
    await expect(first.getByRole('article', { name: 'probe', exact: true })).toBeVisible()
    await expect(syncedIcons(first)).toHaveCount(0)
    const page = await openRecon(app)
    const unmanaged = page.getByRole('region', { name: 'Unmanaged' })
    const syncedRow = unmanaged
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: 'synced', exact: true }) })
    await expect(syncedRow.getByRole('cell').nth(3)).toHaveText('—')
    await expect(unmanaged.getByText('SYNCED', { exact: true })).toHaveCount(0)
    await expect(unmanaged.getByRole('region', { name: 'Also in your loadout' })).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByRole('link', { name: 'Loadout' }).click()
    await page.getByRole('button', { name: 'probe', exact: true }).click()
    await expect(page.getByText('SIZE', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'claude.ai' })).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('synced: Claude Code not enabled keeps the rows and hides the block', async () => {
  const { home, env } = seededHome()
  disableClaude(home)
  const app = await launch(home, env)
  try {
    const page = await openRecon(app)
    await page.getByRole('button', { name: 'synced', exact: true }).click()
    await expectRows(page)
    await expect(
      page
        .getByRole('region', { name: 'Unmanaged' })
        .getByRole('region', { name: 'Also in your loadout' })
    ).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('synced: the card icon, clear and dimmed, with its tooltips', async () => {
  const { home, env } = seededHome()
  addLibrarySkill(home, 'plain')
  let app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    const probe = page.getByRole('article', { name: 'probe', exact: true })
    const probeGh = page.getByRole('article', { name: 'probe-gh', exact: true })
    const plain = page.getByRole('article', { name: 'plain', exact: true })
    const cloud = probe.getByRole('img', { name: ICON_CLEAR })
    await expect(cloud).toBeVisible()
    const tip = probe.getByRole('tooltip').filter({ hasText: 'claude.ai' })
    // The window can show after the first hover, which resets :hover; hover again.
    await expect(async () => {
      await cloud.hover()
      await expect(tip).toBeVisible({ timeout: 1000 })
    }).toPass()
    await expect(tip).toHaveText(
      'Also synced from claude.ai.\nClaude Code loads the synced copy.\nOpen the skill for the fix.'
    )
    // The open tip covers the card name; move the pointer away.
    await page.mouse.move(0, 0)

    // No package mark: the icon sits next to the chevrons, on their centre line.
    const rank = probe.getByRole('img', { name: 'Issued to 1 agent' })
    let c = (await cloud.boundingBox())!
    const r = (await rank.boundingBox())!
    expect(c.x + c.width).toBeLessThanOrEqual(r.x)
    expect(Math.abs(c.y + c.height / 2 - (r.y + r.height / 2))).toBeLessThan(1)

    await expect(probeGh.getByRole('img', { name: ICON_CLEAR })).toBeVisible()
    await expect(syncedIcons(plain)).toHaveCount(0)

    // With the package mark: cloud, package, chevrons.
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    const tessl = join(home, 'Code', 'Skills', 'probe', '.tessl-plugin')
    mkdirSync(tessl, { recursive: true })
    writeFileSync(join(tessl, 'plugin.json'), '{"name":"acme/probe","version":"0.1.0"}')
    const refresh = page.getByRole('button', { name: 'Refresh' })
    await refresh.click()
    const pkg = probe.getByRole('img', { name: /^Published to Tessl Registry:/ })
    await expect(pkg).toBeVisible()
    c = (await cloud.boundingBox())!
    const p = (await pkg.boundingBox())!
    expect(c.x + c.width).toBeLessThanOrEqual(p.x)
    expect(p.x + p.width).toBeLessThanOrEqual((await rank.boundingBox())!.x)

    writeClaudeSettings(home, { skillOverrides: { 'anthropic-skills:probe': 'off' } })
    await refresh.click()
    const dimmed = probe.getByRole('img', { name: ICON_DIMMED })
    await expect(dimmed).toBeVisible()
    await expect(probe.locator('.card-synced')).toHaveClass(/dimmed/)
    await expect(probeGh.locator('.card-synced')).not.toHaveClass(/dimmed/)
    await expect(async () => {
      await dimmed.hover()
      await expect(tip).toBeVisible({ timeout: 1000 })
    }).toPass()
    await expect(tip).toHaveText('Also on claude.ai.\nClaude Code does not load the synced copy.')
    await page.mouse.move(0, 0)
    await expect(probeGh.getByRole('img', { name: ICON_CLEAR })).toBeVisible()

    writeClaudeSettings(home, { syncClaudeAiSkills: false })
    await refresh.click()
    await expect(probeGh.getByRole('img', { name: ICON_DIMMED })).toBeVisible()
    await expect(probe.getByRole('img', { name: ICON_DIMMED })).toBeVisible()

    await app.close()
    disableClaude(home)
    app = await launch(home, env)
    const again = await app.firstWindow()
    await expect(again.getByRole('article', { name: 'probe', exact: true })).toBeVisible()
    await expect(syncedIcons(again)).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('synced: the CLAUDE.AI side card in its five states', async () => {
  const { home, env } = seededHome()
  addLibrarySkill(home, 'plain')
  const probeFolder = join(home, 'Code', 'Skills', 'probe')
  const probeText = readFileSync(join(probeFolder, 'SKILL.md'), 'utf8')
  const STATE_1 = 'Claude Code loads both copies: your loadout copy and the synced copy.'
  const STATE_2 = 'The Claude Code toggle is off, but Claude Code still loads the synced copy.'
  const STATE_3 =
    'The synced copy is turned off by "skillOverrides" in ~/.claude/settings.json. Claude Code does not load it.'
  const STATE_4 =
    'The claude.ai sync is turned off in ~/.claude/settings.json. Claude Code does not load the synced copy.'
  const STATE_5 = 'The source folder is gone, so Claude Code loads only the synced copy.'
  const DIFFERS_LINE =
    'Compared with the copy Claude Code last synced. Update the skill on claude.ai.'
  let app = await launch(home, env)
  try {
    let page = await app.firstWindow()
    const card = page.getByRole('region', { name: 'claude.ai' })
    const copyValue = card.locator('.spec-row').nth(1).locator('span').nth(1)
    const label = card.getByText('TO TURN THE SYNCED COPY OFF', { exact: true })
    const copyButton = card.getByRole('button', { name: 'Copy: TO TURN THE SYNCED COPY OFF' })
    const open = async (name: string): Promise<void> => {
      await page.getByRole('link', { name: 'Loadout' }).click()
      await page.getByRole('button', { name, exact: true }).click()
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    }
    // A state build without leaving the page: the window gains focus.
    const focus = (): Promise<void> =>
      app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].emit('focus')
      })
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('copy-text')
      ipcMain.handle('copy-text', (_event, { text }: { text: string }) => {
        ;(globalThis as unknown as { copied: string }).copied = text
        return { ok: true }
      })
    })
    const copied = (): Promise<string | undefined> =>
      app.evaluate(() => (globalThis as unknown as { copied?: string }).copied)

    // State 1: loaded, and the Claude Code toggle is on.
    await page.getByRole('button', { name: 'probe', exact: true }).click()
    await expect(card.getByText('CLAUDE.AI', { exact: true })).toBeVisible()
    await expect(card.locator('.spec-row').nth(0)).toHaveText(
      /^SYNCED AS\s*anthropic-skills:probe$/
    )
    await expect(card.locator('.spec-row').nth(1).locator('span').nth(0)).toHaveText('COPY')
    await expect(copyValue).toHaveText('SAME')
    await expect(card.getByText(DIFFERS_LINE)).toHaveCount(0)
    await expect(card.getByText(STATE_1, { exact: true })).toBeVisible()
    await expect(label).toBeVisible()
    await expect(card.locator('pre.copy-block')).toHaveText(overridesBlock(['probe']))
    await copyButton.click()
    await expect.poll(copied).toBe(overridesBlock(['probe']))
    await expect(
      card.getByText('Add it to ~/.claude/settings.json. Loadout never changes that file.', {
        exact: true
      })
    ).toBeVisible()
    await expect(
      card.getByText('For every overlap at once, or to turn the sync off:', { exact: true })
    ).toBeVisible()
    await card.getByRole('button', { name: 'SEE RECON →' }).click()
    await expect(page.getByRole('heading', { name: 'RECON', exact: true })).toBeVisible()
    await open('probe')

    // State 2: the toggle off; the synced copy still loads.
    const toggle = page.getByRole('checkbox', { name: 'probe Claude Code' })
    await toggle.uncheck()
    await expect(card.getByText(STATE_2, { exact: true })).toBeVisible()
    await expect(card.getByText(STATE_1, { exact: true })).toHaveCount(0)
    await toggle.check()
    await expect(card.getByText(STATE_1, { exact: true })).toBeVisible()

    await open('probe-gh')
    await expect(copyValue).toHaveText('DIFFERS')
    await expect(copyValue).toHaveClass(/amber-text/)
    await expect(card.getByText(DIFFERS_LINE, { exact: true })).toBeVisible()
    await expect(card.getByText(STATE_2, { exact: true })).toBeVisible()
    await expect(card.locator('pre.copy-block')).toHaveText(overridesBlock(['probe-gh']))
    await copyButton.click()
    await expect.poll(copied).toBe(overridesBlock(['probe-gh']))

    // State 3: turned off by skillOverrides.
    writeClaudeSettings(home, { skillOverrides: { 'anthropic-skills:probe-gh': 'off' } })
    await focus()
    await expect(card.getByText(STATE_3, { exact: true })).toBeVisible()
    await expect(label).toHaveCount(0)
    await expect(card.getByRole('button', { name: /COPY/ })).toHaveCount(0)
    await expect(card.locator('pre.copy-block')).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'SEE RECON →' })).toHaveCount(0)

    // State 4: the sync is off, also with the override.
    writeClaudeSettings(home, {
      syncClaudeAiSkills: false,
      skillOverrides: { 'anthropic-skills:probe-gh': 'off' }
    })
    await focus()
    await expect(card.getByText(STATE_4, { exact: true })).toBeVisible()
    await expect(card.getByText(STATE_3, { exact: true })).toHaveCount(0)
    await expect(label).toHaveCount(0)
    await expect(card.locator('pre.copy-block')).toHaveCount(0)

    // A skill that is not synced has no card.
    await open('plain')
    await expect(page.getByText('SIZE', { exact: true })).toBeVisible()
    await expect(card).toHaveCount(0)

    // The library copy cannot be read: the card stays, COPY shows a dash, and no notice shows.
    writeClaudeSettings(home, {})
    rmSync(probeFolder, { recursive: true, force: true })
    await focus()
    await open('probe')
    await expect(card).toBeVisible()
    await expect(copyValue).toHaveText('—')
    await expect(page.getByRole('alert')).toHaveCount(0)
    // State 5: the entry is missing and still on, so Claude Code loads only the synced copy.
    await expect(card.getByText(STATE_5, { exact: true })).toBeVisible()
    await expect(card.getByText(STATE_1, { exact: true })).toHaveCount(0)
    await expect(label).toBeVisible()
    await expect(card.locator('pre.copy-block')).toHaveText(overridesBlock(['probe']))

    // The live bucket is removed while the page is open: the card goes, and no notice shows.
    await open('probe-gh')
    await expect(copyValue).toHaveText('DIFFERS')
    rmSync(join(home, '.claude', 'skills', 'synced', `${ORG}_${ACCOUNT}`), {
      recursive: true,
      force: true
    })
    await focus()
    await expect(card).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)

    // Claude Code not enabled: no card, also on a loaded overlap.
    await app.close()
    mkdirSync(probeFolder, { recursive: true })
    writeFileSync(join(probeFolder, 'SKILL.md'), probeText)
    addSynced(home, { probe: probeText })
    disableClaude(home)
    app = await launch(home, env)
    page = await app.firstWindow()
    await page.getByRole('button', { name: 'probe', exact: true }).click()
    await expect(page.getByText('SIZE', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'claude.ai' })).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})
