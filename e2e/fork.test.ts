import { _electron, expect, test } from '@playwright/test'
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync
} from 'node:fs'
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

test('fork: the channel copies, moves the toggle and logs', async () => {
  const { home, env } = fakeHome()
  const parent = join(home, 'Forks')
  mkdirSync(parent)
  symlinkSync(
    join(home, '.loadout', 'skills', 'probe-gh'),
    join(home, '.claude', 'skills', 'probe-gh')
  )
  appendFileSync(
    join(home, '.loadout', 'repos', 'acme', 'tools', 'skills', 'probe-gh', 'SKILL.md'),
    'Run probe-gh now.\n'
  )
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    // The fork channel is refused while the startup check runs.
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [folder]
      })) as typeof dialog.showOpenDialog
    }, parent)

    const done = await page.evaluate(() =>
      window.loadout.invoke('fork', { skill: 'probe-gh', name: 'my-gh' })
    )
    expect(done).toMatchObject({ ok: true, name: 'my-gh', folder: join(parent, 'my-gh') })
    expect(done).toMatchObject({ moved: ['Claude Code'], failed: [] })
    expect((done as { occurrences: string[] }).occurrences).toContain(
      'SKILL.md:5: Run probe-gh now.'
    )
    expect(readFileSync(join(parent, 'my-gh', 'SKILL.md'), 'utf8')).toContain('name: my-gh')
    expect(lstatSync(join(home, '.claude', 'skills', 'my-gh')).isSymbolicLink()).toBe(true)
    expect(existsSync(join(home, '.claude', 'skills', 'probe-gh'))).toBe(false)

    await page.getByRole('link', { name: 'Log' }).click()
    const card = page.getByRole('article', { name: /^Run \d+$/ })
    await expect(card).toHaveCount(1)
    await expect(card.getByText('FORK', { exact: true })).toBeVisible()
    await expect(
      card.getByText(`Forked "probe-gh" to "my-gh" at ${join(parent, 'my-gh')}.`)
    ).toBeVisible()
    await expect(card.getByText('Claude Code: "my-gh" on, "probe-gh" off.')).toBeVisible()

    mkdirSync(join(parent, 'my-gh-2'))
    const refused = await page.evaluate(() =>
      window.loadout.invoke('fork', { skill: 'probe-gh', name: 'my-gh-2' })
    )
    expect(refused).toMatchObject({ ok: false })
    expect((refused as { message: string }).message).toContain('already exists')
    await expect(card).toHaveCount(1)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('fork: through the menu, with a refusal first', async () => {
  const { home, env } = fakeHome()
  const parent = join(home, 'Forks')
  mkdirSync(join(parent, 'taken'), { recursive: true })
  symlinkSync(
    join(home, '.loadout', 'skills', 'probe-gh'),
    join(home, '.claude', 'skills', 'probe-gh')
  )
  appendFileSync(
    join(home, '.loadout', 'repos', 'acme', 'tools', 'skills', 'probe-gh', 'SKILL.md'),
    'Run probe-gh now.\n'
  )
  const app = await _electron.launch({
    args: launchArgs(home),
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('checkbox', { name: 'probe-gh Claude Code' })).toBeChecked()
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [folder]
      })) as typeof dialog.showOpenDialog
    }, parent)

    await page.getByLabel('Actions for probe-gh', { exact: true }).click()
    await page.getByRole('button', { name: 'Fork' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('FORK', { exact: true })).toBeVisible()
    await expectWindowDrag(dialog)
    await expect(dialog.getByText(/adds the copy as a Folder skill/)).toBeVisible()
    await expect(
      dialog.getByText(
        'Updates to the original do not reach the copy; Loadout does not check the copy for updates.'
      )
    ).toBeVisible()
    const choose = dialog.getByRole('button', { name: 'Choose folder…' })
    await expect(choose).toBeDisabled()

    await dialog.getByLabel('New name').fill('taken')
    await choose.click()
    await expect(
      dialog.getByText(`${join(parent, 'taken')} already exists. Pick another folder or name.`)
    ).toBeVisible()
    await expect(dialog.getByLabel('New name')).toHaveValue('taken')

    await dialog.getByLabel('New name').fill('my-gh')
    await choose.click()
    await expect(dialog.getByText('FORKED', { exact: true })).toBeVisible()
    await expect(dialog.getByText('"my-gh" is at ~/Forks/my-gh.')).toBeVisible()
    await expect(
      dialog.getByText('Switched on for Claude Code; "probe-gh" switched off there.')
    ).toBeVisible()
    await expect(
      dialog.getByRole('heading', { name: 'OTHER MENTIONS OF "PROBE-GH"' })
    ).toBeVisible()
    await expect(dialog.getByText('SKILL.md:5: Run probe-gh now.')).toBeVisible()

    await dialog.getByRole('button', { name: 'Open skill page' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'my-gh', exact: true })).toBeVisible()

    await page.getByRole('link', { name: 'Loadout' }).click()
    await page.getByLabel('Actions for probe', { exact: true }).click()
    await page.getByRole('button', { name: 'Fork' }).click()
    await expect(dialog.getByText('FORK', { exact: true })).toBeVisible()
    await expect(dialog.getByText(/adds the copy as a Folder skill/)).toBeVisible()
    await expect(dialog.getByText(/Updates to the original/)).toHaveCount(0)
    await expect(dialog.getByLabel('New name')).toHaveValue('')
    await expect(dialog.getByText(/already exists/)).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    await expect(page.getByRole('checkbox', { name: 'probe-gh Claude Code' })).not.toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'my-gh Claude Code' })).toBeChecked()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('fork: the dialog stays open while a fork runs', async () => {
  const { home, env } = fakeHome()
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
      ipcMain.removeHandler('fork')
      ipcMain.handle(
        'fork',
        () =>
          new Promise((resolve) => {
            ;(globalThis as unknown as { release: () => void }).release = () =>
              resolve({ ok: false, message: 'Held run.' })
          })
      )
    })
    const dialog = page.getByRole('dialog')
    await page.getByLabel('Actions for probe-gh', { exact: true }).click()
    await page.getByRole('button', { name: 'Fork' }).click()
    await expect(dialog.getByText('FORK', { exact: true })).toBeVisible()

    // Escape closes the dialog while nothing runs.
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await page.getByLabel('Actions for probe-gh', { exact: true }).click()
    await page.getByRole('button', { name: 'Fork' }).click()
    await dialog.getByLabel('New name').fill('my-gh')
    await dialog.getByRole('button', { name: 'Choose folder…' }).click()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Choose folder…' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await app.evaluate(() => (globalThis as unknown as { release: () => void }).release())
    await expect(dialog.getByText('Held run.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})
