import { _electron, expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseConfig, serializeConfig } from '../src/core/config'
import type { LoadoutApi, State } from '../src/core/ipc'
import { fakeHome } from './support/fake-home'
import { expectWindowDrag } from './support/dialog'
import { addSamples } from './support/samples'

declare const window: { loadout: LoadoutApi }

const ROOT = join(__dirname, '..')

const launchArgs = (home: string): string[] => [
  `--user-data-dir=${join(home, 'electron-data')}`,
  join(ROOT, 'out', 'main', 'index.js')
]

const getState = (page: Page): Promise<State> =>
  page.evaluate(async () => {
    const result = await window.loadout.invoke('get-state')
    if (!result.ok) throw new Error(result.message)
    return JSON.parse(JSON.stringify(result.state))
  })

test('recruit: the channels preview, recruit, log and undo', async () => {
  const { home, env } = fakeHome()
  addSamples(home)
  const parent = join(home, 'Recruited')
  mkdirSync(parent)
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [folder]
      })) as typeof dialog.showOpenDialog
    }, parent)

    const first = await getState(page)
    const row = (
      agentId: string,
      name: string
    ): State['unmanaged'][number]['recruit'] | undefined =>
      first.unmanaged.find((u) => u.agentId === agentId && u.name === name)?.recruit
    expect(first.backups).toEqual([])
    expect(row('claude-code', 'sample-plain')).toEqual({
      kind: 'recruit',
      mode: 'copy',
      name: 'sample-plain'
    })
    expect(row('codex', 'sample-plain')).toMatchObject({ kind: 'recruit', mode: 'copy' })
    expect(row('claude-code', 'sample-differs')).toMatchObject({ kind: 'recruit', mode: 'copy' })
    expect(row('claude-code', 'sample-claude-only')).toMatchObject({
      kind: 'recruit',
      mode: 'copy'
    })
    expect(row('claude-code', 'sample-linked')).toMatchObject({ kind: 'recruit', mode: 'in-place' })
    expect(row('claude-code', 'sample-dangling')).toEqual({ kind: 'backup' })
    expect(row('claude-code', 'soft-skill')).toEqual({
      kind: 'recruit',
      mode: 'copy',
      name: 'sample-misnamed'
    })
    expect(row('claude-code', 'sample-in-library')).toMatchObject({
      kind: 'recruit',
      mode: 'library'
    })
    expect(row('codex', 'sample-git')).toMatchObject({ kind: 'recruit', mode: 'copy' })
    expect(row('codex', 'sample-symlink')).toMatchObject({ kind: 'recruit', mode: 'copy' })
    expect(row('codex', 'sample-noname')).toMatchObject({ kind: 'text' })
    expect(row('codex', 'tessl__sample')).toMatchObject({ kind: 'text' })
    expect(row('claude-code', 'notes.md')).toEqual({ kind: 'none' })
    expect(row('claude-code', 'synced')).toEqual({ kind: 'none' })

    const chosen = await page.evaluate(() => window.loadout.invoke('choose-folder'))
    expect(chosen).toEqual({ ok: true, folder: parent })

    const preview = await page.evaluate(
      (folder) =>
        window.loadout.invoke('recruit-preview', {
          agentId: 'claude-code',
          entry: 'sample-plain',
          parent: folder
        }),
      parent
    )
    if (!preview.ok) throw new Error(preview.message)
    expect(preview.steps).toHaveLength(5)

    // A changed `shown` is refused, and nothing moves.
    const altered = await page.evaluate(
      ({ folder, shown }) =>
        window.loadout.invoke('recruit', {
          agentId: 'claude-code',
          entry: 'sample-plain',
          parent: folder,
          shown: [...shown, 'Extra line.']
        }),
      { folder: parent, shown: [...preview.notes, ...preview.steps] }
    )
    expect(altered).toMatchObject({ ok: false })
    expect((altered as { message: string }).message).toContain('changed after the preview')
    expect((await getState(page)).backups).toEqual([])

    const done = await page.evaluate(
      ({ folder, shown }) =>
        window.loadout.invoke('recruit', {
          agentId: 'claude-code',
          entry: 'sample-plain',
          parent: folder,
          shown
        }),
      { folder: parent, shown: [...preview.notes, ...preview.steps] }
    )
    expect(done).toMatchObject({ ok: true, name: 'sample-plain', files: 1 })
    expect((done as { chain: string | null }).chain).toContain('sample-plain')
    expect(lstatSync(join(home, '.claude', 'skills', 'sample-plain')).isSymbolicLink()).toBe(true)

    const after = await getState(page)
    expect(
      after.unmanaged.find((u) => u.agentId === 'claude-code' && u.name === 'sample-plain')
    ).toBeUndefined()
    expect(after.backups).toEqual([
      { agentId: 'claude-code', entry: 'sample-plain', kind: 'folder' }
    ])
    expect(after.entries.find((e) => e.name === 'sample-plain')?.enabledFor).toContain(
      'claude-code'
    )

    await page.getByRole('link', { name: 'Log' }).click()
    const card = page.getByRole('article', { name: /^Run \d+$/ })
    await expect(card).toHaveCount(1)
    await expect(card.getByText('RECRUIT', { exact: true })).toBeVisible()
    await expect(card.getByText('Verified: 1 file, identical.')).toBeVisible()

    const undone = await page.evaluate(() =>
      window.loadout.invoke('recruit-undo', { agentId: 'claude-code', entry: 'sample-plain' })
    )
    expect(undone).toMatchObject({ ok: true })
    expect((undone as { path: string }).path).toContain('sample-plain')
    expect(lstatSync(join(home, '.claude', 'skills', 'sample-plain')).isDirectory()).toBe(true)
    expect(existsSync(join(home, '.loadout', 'backups', 'claude-code', 'sample-plain'))).toBe(false)
    expect((await getState(page)).backups).toEqual([])

    const refused = await page.evaluate(() =>
      window.loadout.invoke('reveal-backup', { agentId: 'claude-code', entry: '../x' })
    )
    expect(refused).toMatchObject({ ok: false })
  } finally {
    await app.close()
  }
})

test('recruit: VIEW opens the candidate page', async () => {
  const { home, env } = fakeHome()
  addSamples(home)
  // The PACKS view: there, mouse Back once stopped on the page already shown.
  const configPath = join(home, '.loadout', 'config.json')
  const config = parseConfig(readFileSync(configPath, 'utf8'), configPath)
  config.loadoutView = 'packs'
  writeFileSync(configPath, serializeConfig(config))
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    await page.getByRole('link', { name: 'Recon' }).click()
    const row = (agent: string, name: string): Locator => reconRow(page, agent, name)
    const recon = page.getByRole('link', { name: 'Recon' })

    // VIEW sits before RECRUIT on a RECRUIT row only.
    await expect(row('Claude Code', 'sample-plain').getByRole('button')).toHaveText([
      'VIEW',
      'RECRUIT'
    ])
    await expect(
      row('Claude Code', 'sample-dangling').getByRole('button', { name: 'View' })
    ).toHaveCount(0)
    await expect(row('Codex', 'sample-noname').getByRole('button', { name: 'View' })).toHaveCount(0)

    // A folder candidate: the Codex copy of sample-plain, read-only.
    await row('Codex', 'sample-plain').getByRole('button', { name: 'View' }).click()
    await expect(page.getByRole('heading', { name: 'sample-plain' })).toBeVisible()
    await expect(page.getByText('NOT IN LOADOUT', { exact: true })).toBeVisible()
    const found = page.getByRole('region', { name: 'Found in' })
    await expect(found).toContainText('Codex')
    await expect(found).toContainText('~/.codex/skills/sample-plain')
    await expect(page.getByText('description: A sample skill.')).toBeVisible()
    await expect(page.locator('.file-row', { hasText: 'SKILL.md' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Decommission skill' })).toHaveCount(0)
    await expect(page.locator('.main-col').getByRole('checkbox')).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Review' })).toHaveCount(0)
    await expect(recon).toHaveAttribute('aria-current', 'page')

    await page.getByRole('button', { name: 'Back to Recon' }).click()
    await expect(page.getByRole('region', { name: 'Unmanaged' })).toBeVisible()

    // A link candidate reads the link's target.
    await row('Claude Code', 'sample-linked').getByRole('button', { name: 'View' }).click()
    await expect(page.locator('.skill-address')).toContainText('LINK')
    await expect(page.locator('.skill-address')).toContainText('~/Code/my-skills/sample-linked')
    await expect(page.getByText('name: sample-linked')).toBeVisible()

    // RECRUIT on the page opens the dialog; after the recruit, the page returns to Recon.
    await page.locator('.skill-actions').getByRole('button', { name: 'Recruit' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('listitem')).toHaveCount(3)
    await dialog.getByRole('button', { name: 'Recruit' }).click()
    await expect(dialog.getByText('Recruited sample-linked for Claude Code.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Unmanaged' })).toBeVisible()
    await expect(row('Claude Code', 'sample-linked')).toHaveCount(0)
    // One mouse Back press moves: past the gone candidate and the Recon page already shown.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].emit('swipe', {}, 'left')
    })
    await expect(page.getByRole('heading', { name: 'sample-plain' })).toBeVisible()
  } finally {
    await app.close()
  }
})

/** The Recon row of one unmanaged entry. */
function reconRow(page: Page, agent: string, name: string): Locator {
  const cell = (text: string): Locator => page.getByRole('cell', { name: text, exact: true })
  return page
    .getByRole('region', { name: 'Unmanaged' })
    .getByRole('row')
    .filter({ has: cell(agent) })
    .filter({ has: cell(name) })
}

/** The value of one fact in the open dialog. */
const fact = (dialog: Locator, label: string): Locator =>
  dialog.locator(`dt:text-is("${label}") + dd`)

test('recruit: the Recon rows, the dialog, the backups and undo', async () => {
  const { home, env } = fakeHome()
  addSamples(home)
  const parent = join(home, 'Recruited')
  mkdirSync(parent)
  mkdirSync(join(home, '.loadout', 'backups', 'old-agent', 'z'), { recursive: true })
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [folder]
      })) as typeof dialog.showOpenDialog
    }, parent)
    // The samples hold skills to recruit, so the BOOT CAMP strip points at Recon.
    await page.getByRole('link', { name: 'BOOT CAMP' }).click()
    const exit = page.locator('.bc-exit')
    await expect(exit).toContainText('Recruit your first skill on the Recon page.')
    await exit.getByRole('button', { name: 'GO TO RECON' }).click()
    await expect(page.getByRole('link', { name: 'Recon' })).toHaveAttribute('aria-current', 'page')
    const backups = page.getByRole('region', { name: 'Backups' })
    const dialog = page.getByRole('dialog')

    await expect(page.getByText(/^\d+ UNMANAGED · 1 BACKUP · \d+ LOADOUT/)).toBeVisible()
    const row = (agent: string, name: string): Locator => reconRow(page, agent, name)
    await expect(row('Claude Code', 'sample-plain').getByRole('button')).toHaveText([
      'VIEW',
      'RECRUIT'
    ])
    await expect(row('Claude Code', 'sample-dangling').getByRole('button')).toHaveText(
      'MOVE TO BACKUP'
    )
    await expect(row('Codex', 'sample-symlink').getByRole('button')).toHaveText(['VIEW', 'RECRUIT'])
    await expect(row('Codex', 'tessl__sample')).toContainText(
      'A link into ~/.agents/skills, which another tool manages. Loadout leaves it alone.'
    )
    await expect(row('Codex', 'sample-noname')).toContainText(
      'SKILL.md in ~/.codex/skills/sample-noname has no "name" in its frontmatter. Add the name line, then press Rescan.'
    )
    await expect(row('Codex', 'tessl__sample').getByRole('button')).toHaveCount(0)
    await expect(row('Claude Code', 'notes.md').getByRole('button')).toHaveCount(0)
    await expect(row('Claude Code', 'synced').getByRole('button')).toHaveCount(1) // the fold button only

    // The stray backup folder: its folder name as AGENT, REVEAL only.
    const stray = backups.getByRole('row').filter({ hasText: 'old-agent' })
    await expect(stray.getByRole('cell', { name: 'z', exact: true })).toBeVisible()
    await expect(stray.getByRole('button', { name: 'Reveal' })).toBeVisible()
    await expect(stray.getByRole('button', { name: 'Undo' })).toHaveCount(0)

    // sample-symlink: the refusal in the dialog, CLOSE only.
    await row('Codex', 'sample-symlink').getByRole('button', { name: 'Recruit' }).click()
    await expect(
      dialog.getByText(
        'Recruit cannot copy "sample-symlink", because it holds symlinks: alias.md. Replace each link with a regular file or folder, then try again.'
      )
    ).toBeVisible()
    await expect(dialog.getByRole('button')).toHaveText(['Close'])
    await expectWindowDrag(dialog)
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toHaveCount(0)

    // sample-plain: the facts and no folder; CANCEL changes nothing.
    const before = await getState(page)
    await row('Claude Code', 'sample-plain').getByRole('button', { name: 'Recruit' }).click()
    await expect(dialog.getByText('CLAUDE CODE · sample-plain')).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'RECRUIT' })).toBeVisible()
    await expect(fact(dialog, 'FOUND')).toHaveText('~/.claude/skills/sample-plain')
    await expect(fact(dialog, 'SKILL')).toHaveText('sample-plain')
    await expect(fact(dialog, 'SIZE')).toHaveText(/^1 file · /)
    await expect(fact(dialog, 'IN LOADOUT')).toHaveText('no')
    await expect(
      dialog.getByText(
        'Did this skill come from GitHub? Cancel, add it with Recruit skill › Link, and open this again: you can then switch to that copy.'
      )
    ).toBeVisible()
    await expect(
      dialog.getByText(
        'Pick the folder where your own skills live. Loadout makes sample-plain in it.'
      )
    ).toBeVisible()
    await expect(dialog.getByText('No folder picked.')).toBeVisible()
    await expect(dialog.getByText('LOADOUT WILL')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Recruit' })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    const unchanged = await getState(page)
    expect(unchanged.unmanaged).toEqual(before.unmanaged)
    expect(unchanged.backups).toEqual(before.backups)

    // Open again, pick the folder, RECRUIT.
    await row('Claude Code', 'sample-plain').getByRole('button', { name: 'Recruit' }).click()
    await dialog.getByRole('button', { name: 'Choose folder…' }).click()
    await expect(
      dialog.getByText(
        'Pick the folder where your own skills live. Loadout makes sample-plain in it.'
      )
    ).toBeVisible()
    await expect(dialog.getByText('~/Recruited', { exact: true })).toBeVisible()
    await expect(dialog.getByText('LOADOUT WILL')).toBeVisible()
    await expect(dialog.getByRole('listitem')).toHaveText([
      'Copy ~/.claude/skills/sample-plain to ~/Recruited/sample-plain.',
      'Check that the copy is identical to your original.',
      'Add sample-plain to your loadout, linked to ~/Recruited/sample-plain.',
      'Move your original from ~/.claude/skills/sample-plain to ~/.loadout/backups/claude-code/sample-plain. It stays there, unchanged.',
      "Link ~/.claude/skills/sample-plain to your loadout's sample-plain, so Claude Code keeps loading the skill."
    ])
    await expect(
      dialog.getByText('Loadout deletes nothing. UNDO on the Recon page puts your original back.')
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Recruit' }).click()
    await expect(dialog.getByText('Recruited sample-plain for Claude Code.')).toBeVisible()
    await expect(dialog.getByText('Verified: 1 file, identical.')).toBeVisible()
    await expect(
      dialog.getByText(
        'Nothing was deleted. Your original is in ~/.loadout/backups/claude-code/sample-plain.'
      )
    ).toBeVisible()
    await expect(
      dialog.getByText(
        '~/.claude/skills/sample-plain → ~/.loadout/skills/sample-plain → ~/Recruited/sample-plain'
      )
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Reveal backup' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(row('Claude Code', 'sample-plain')).toHaveCount(0)
    await expect(
      backups
        .getByRole('row')
        .filter({ hasText: 'Claude Code' })
        .filter({ hasText: 'sample-plain' })
    ).toContainText('FOLDER')

    // The Codex row of sample-plain: mode library, same content, two steps, no folder line.
    await row('Codex', 'sample-plain').getByRole('button', { name: 'Recruit' }).click()
    await expect(fact(dialog, 'IN LOADOUT')).toHaveText('yes · same content')
    await expect(
      dialog.getByText(
        'Your loadout already has this skill with the same content. Loadout will not make another copy.'
      )
    ).toBeVisible()
    await expect(dialog.getByRole('listitem')).toHaveCount(2)
    await expect(dialog.getByText(/^Pick the folder/)).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    // sample-differs: recruit the Claude Code row (the folder is kept), then the Codex row lists the file.
    await row('Claude Code', 'sample-differs').getByRole('button', { name: 'Recruit' }).click()
    await expect(dialog.getByText('~/Recruited', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('listitem')).toHaveCount(5)
    await dialog.getByRole('button', { name: 'Recruit' }).click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await row('Codex', 'sample-differs').getByRole('button', { name: 'Recruit' }).click()
    await expect(fact(dialog, 'IN LOADOUT')).toHaveText('yes · 1 file differs')
    await expect(dialog.getByText('Your copy differs from the one in your loadout:')).toBeVisible()
    await expect(dialog.getByText('SKILL.md differs', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    // The notes of soft-skill and sample-git.
    await row('Claude Code', 'soft-skill').getByRole('button', { name: 'Recruit' }).click()
    await expect(
      dialog.getByText(
        "The folder is named soft-skill, but the skill's name is sample-misnamed. Loadout uses the skill's name for its links. Your agent can list the skill as sample-misnamed from now on."
      )
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await row('Codex', 'sample-git').getByRole('button', { name: 'Recruit' }).click()
    await expect(
      dialog.getByText(
        'This folder is a git repository. The copy keeps its history. Loadout runs no git command.'
      )
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    // sample-linked in place: three steps, no folder line; the old link goes to the backups.
    await row('Claude Code', 'sample-linked').getByRole('button', { name: 'Recruit' }).click()
    await expect(dialog.getByRole('listitem')).toHaveCount(3)
    await expect(dialog.getByText(/^Pick the folder/)).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Recruit' }).click()
    await expect(dialog.getByText('Recruited sample-linked for Claude Code.')).toBeVisible()
    await expect(dialog.getByText(/^Verified:/)).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Done' }).click()
    const linked = (await getState(page)).entries.find((e) => e.name === 'sample-linked')
    expect(linked?.target).toBe(join(home, 'Code', 'my-skills', 'sample-linked'))
    await expect(backups.getByRole('row').filter({ hasText: 'sample-linked' })).toContainText(
      'LINK'
    )

    // sample-in-library: same content, two steps, RECRUIT works.
    await row('Claude Code', 'sample-in-library').getByRole('button', { name: 'Recruit' }).click()
    await expect(fact(dialog, 'IN LOADOUT')).toHaveText('yes · same content')
    await expect(dialog.getByRole('listitem')).toHaveCount(2)
    await dialog.getByRole('button', { name: 'Recruit' }).click()
    await expect(dialog.getByText('Recruited sample-in-library for Claude Code.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Done' }).click()

    // sample-dangling: MOVE TO BACKUP with one step.
    await row('Claude Code', 'sample-dangling')
      .getByRole('button', { name: 'Move to backup' })
      .click()
    await expect(dialog.getByRole('heading', { name: 'MOVE TO BACKUP' })).toBeVisible()
    await expect(dialog.getByRole('listitem')).toHaveText([
      'Move your original from ~/.claude/skills/sample-dangling to ~/.loadout/backups/claude-code/sample-dangling. It stays there, unchanged.'
    ])
    await dialog.getByRole('button', { name: 'Move to backup' }).click()
    await expect(dialog.getByText('Moved sample-dangling to the backup.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(row('Claude Code', 'sample-dangling')).toHaveCount(0)
    const dangling = backups.getByRole('row').filter({ hasText: 'sample-dangling' })
    await expect(dangling).toContainText('LINK')

    // UNDO of the dangling link is refused while its old path is in use, then puts it back.
    const oldPath = join(home, '.claude', 'skills', 'sample-dangling')
    mkdirSync(oldPath)
    await page.getByRole('button', { name: 'Rescan' }).click()
    // Undo during the Rescan is refused; the folder's row shows that the Rescan ended.
    await expect(row('Claude Code', 'sample-dangling')).toHaveCount(1)
    await dangling.getByRole('button', { name: 'Undo' }).click()
    await expect(
      dialog.getByText(
        '~/.claude/skills/sample-dangling is in use, so Loadout cannot put your original back there. Move it away, then press Undo again.'
      )
    ).toBeVisible()
    await expect(dialog.getByRole('button')).toHaveText(['Close'])
    await dialog.getByRole('button', { name: 'Close' }).click()
    rmSync(oldPath, { recursive: true })
    await page.getByRole('button', { name: 'Rescan' }).click()
    await expect(row('Claude Code', 'sample-dangling')).toHaveCount(0)
    await dangling.getByRole('button', { name: 'Undo' }).click()
    await expect(dialog.getByRole('heading', { name: 'UNDO' })).toBeVisible()
    await expect(dialog.getByText(/^Loadout's copy of the skill/)).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Undo' }).click()
    await expect(dialog).toHaveCount(0)
    expect(lstatSync(oldPath).isSymbolicLink()).toBe(true)
    await expect(
      page
        .getByRole('status')
        .getByText('Your original is back in ~/.claude/skills/sample-dangling.')
    ).toBeVisible()

    // UNDO of sample-plain: the confirmation, then the notice.
    const plain = backups
      .getByRole('row')
      .filter({ hasText: 'Claude Code' })
      .filter({ has: page.getByRole('cell', { name: 'sample-plain', exact: true }) })
    await plain.getByRole('button', { name: 'Undo' }).click()
    await expect(dialog.getByRole('heading', { name: 'UNDO' })).toBeVisible()
    await expect(dialog.getByRole('listitem')).toHaveText([
      "Remove Loadout's link ~/.claude/skills/sample-plain.",
      'Move your original from ~/.loadout/backups/claude-code/sample-plain back to ~/.claude/skills/sample-plain.'
    ])
    await expect(
      dialog.getByText(
        "Loadout's copy of the skill and its place in your loadout stay. Decommission the skill if you do not want it."
      )
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Undo' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('status')).toHaveText(
      'Your original is back in ~/.claude/skills/sample-plain. "sample-plain" stays in your loadout, off for Claude Code.'
    )
    expect(lstatSync(join(home, '.claude', 'skills', 'sample-plain')).isDirectory()).toBe(true)
    await expect(row('Claude Code', 'sample-plain').getByRole('button')).toHaveText([
      'VIEW',
      'RECRUIT'
    ])

    // The dialog closes when its row leaves the state.
    await row('Claude Code', 'sample-claude-only').getByRole('button', { name: 'Recruit' }).click()
    await expect(dialog.getByRole('listitem')).toHaveCount(5)
    const recruited = await page.evaluate(async (folder) => {
      const request = { agentId: 'claude-code', entry: 'sample-claude-only', parent: folder }
      const preview = await window.loadout.invoke('recruit-preview', request)
      if (!preview.ok) return preview
      return window.loadout.invoke('recruit', {
        ...request,
        shown: [...preview.notes, ...preview.steps]
      })
    }, parent)
    expect(recruited).toMatchObject({ ok: true })
    await expect(dialog).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('recruit: an agent that is not enabled shows the Enlist text and no backups', async () => {
  const { home, env } = fakeHome()
  addSamples(home)
  const configPath = join(home, '.loadout', 'config.json')
  const config = parseConfig(readFileSync(configPath, 'utf8'), configPath)
  config.agents[1].enabled = false
  writeFileSync(configPath, serializeConfig(config))
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    await page.getByRole('link', { name: 'Recon' }).click()
    for (const name of ['sample-plain', 'sample-git', 'sample-noname']) {
      await expect(reconRow(page, 'Codex', name)).toContainText('Enlist Codex to recruit this.')
      await expect(reconRow(page, 'Codex', name).getByRole('button')).toHaveCount(0)
    }
    await expect(page.getByText(/^\d+ UNMANAGED · 0 BACKUPS · \d+ LOADOUT/)).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Backups' }).getByText('No backups.', { exact: true })
    ).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('recruit: the dialog stays open while a recruit runs', async () => {
  const { home, env } = fakeHome()
  addSamples(home)
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    // The handler is replaced, so the run stays open until the test releases it.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('recruit')
      ipcMain.handle(
        'recruit',
        () =>
          new Promise((resolve) => {
            ;(globalThis as unknown as { release: () => void }).release = () =>
              resolve({ ok: false, message: 'Held run.' })
          })
      )
    })
    await page.getByRole('link', { name: 'Recon' }).click()
    const dialog = page.getByRole('dialog')
    const recruit = reconRow(page, 'Claude Code', 'sample-in-library').getByRole('button', {
      name: 'Recruit'
    })

    // Escape closes the dialog while nothing runs.
    await recruit.click()
    await expect(dialog.getByRole('listitem')).toHaveCount(2)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await recruit.click()
    await expect(dialog.getByRole('listitem')).toHaveCount(2)
    await dialog.getByRole('button', { name: 'Recruit' }).click()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Recruit' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await app.evaluate(() => (globalThis as unknown as { release: () => void }).release())
    await expect(dialog.getByText('Held run.')).toBeVisible()
    await expect(dialog.getByRole('button')).toHaveText(['Close'])
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('recruit: a late rejected preview leaves a newer dialog open', async () => {
  const { home, env } = fakeHome()
  addSamples(home)
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    // Every preview is held; the test rejects the first one after the dialog moved on.
    type Held = { held: ((error: Error) => void)[] }
    await app.evaluate(({ ipcMain }) => {
      const store = globalThis as unknown as Held
      store.held = []
      ipcMain.removeHandler('recruit-preview')
      ipcMain.handle(
        'recruit-preview',
        () => new Promise((_resolve, reject) => void store.held.push(reject))
      )
    })
    // The preview starts on the dialog's late `toggle`, so wait until main holds it.
    const heldCount = (): Promise<number> =>
      app.evaluate(() => (globalThis as unknown as Held).held.length)
    await page.getByRole('link', { name: 'Recon' }).click()
    const dialog = page.getByRole('dialog')
    await reconRow(page, 'Claude Code', 'sample-in-library')
      .getByRole('button', { name: 'Recruit' })
      .click()
    await expect.poll(heldCount).toBe(1)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await reconRow(page, 'Claude Code', 'sample-differs')
      .getByRole('button', { name: 'Recruit' })
      .click()
    await expect.poll(heldCount).toBe(2)
    await expect(dialog).toContainText('sample-differs')
    await app.evaluate(() =>
      (globalThis as unknown as Held).held[0](new Error('Late preview failed.'))
    )
    // The rejection belongs to the closed dialog: the newer one stays, and no notice shows.
    await expect(page.getByText('Late preview failed.')).toHaveCount(0)
    await expect(dialog).toContainText('sample-differs')
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('recruit: a late preview of an earlier open of the same row is ignored', async () => {
  const { home, env } = fakeHome()
  addSamples(home)
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    // Every preview is held; the test answers them out of order.
    type Held = { held: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] }
    await app.evaluate(({ ipcMain }) => {
      const store = globalThis as unknown as Held
      store.held = []
      ipcMain.removeHandler('recruit-preview')
      ipcMain.handle(
        'recruit-preview',
        () => new Promise((resolve, reject) => void store.held.push({ resolve, reject }))
      )
    })
    const heldCount = (): Promise<number> =>
      app.evaluate(() => (globalThis as unknown as Held).held.length)
    const answer = (index: number, found: string): Promise<void> =>
      app.evaluate(
        (_electron, [i, text]) =>
          (globalThis as unknown as Held).held[i].resolve({
            ok: true,
            mode: 'in-place',
            facts: { found: text, skill: null, size: null, inLoadout: null },
            notes: [],
            needsFolder: false,
            steps: ['A step.'],
            more: []
          }),
        [index, found] as const
      )
    await page.getByRole('link', { name: 'Recon' }).click()
    const dialog = page.getByRole('dialog')
    const recruit = reconRow(page, 'Claude Code', 'sample-in-library').getByRole('button', {
      name: 'Recruit'
    })
    // Two opens of the same row close while their previews hang; the third stays open.
    for (const count of [1, 2]) {
      await recruit.click()
      await expect.poll(heldCount).toBe(count)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    }
    await recruit.click()
    await expect.poll(heldCount).toBe(3)

    await answer(0, 'First open.')
    await app.evaluate(() =>
      (globalThis as unknown as Held).held[1].reject(new Error('Late preview failed.'))
    )
    await answer(2, 'Third open.')
    // Only the answer of the open dialog shows; the late rejection neither closes it nor sets a notice.
    await expect(dialog).toContainText('Third open.')
    await expect(dialog).not.toContainText('First open.')
    await expect(page.getByText('Late preview failed.')).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})
