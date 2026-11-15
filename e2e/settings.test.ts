import { _electron, expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LoadoutApi } from '../src/core/ipc'
import { fakeHome } from './support/fake-home'

declare const window: { loadout: LoadoutApi }

const ROOT = join(__dirname, '..')

test('settings: changes sent together are all saved', async () => {
  const { home, env } = fakeHome()
  const app = await _electron.launch({
    args: [`--user-data-dir=${join(home, 'electron-data')}`, join(ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    const replies = await page.evaluate(() =>
      Promise.all([
        window.loadout.invoke('set-agent-enabled', { agentId: 'codex', on: true }),
        window.loadout.invoke('set-agent-enabled', { agentId: 'claude-code', on: false }),
        window.loadout.invoke('set-appearance', { appearance: 'light' }),
        window.loadout.invoke('set-workspaces', { workspaces: ['acme', 'beta'], default: 'acme' })
      ])
    )
    expect(replies.map((r) => r.ok)).toEqual([true, false, true, true])
    const saved = JSON.parse(readFileSync(join(home, '.loadout', 'config.json'), 'utf8'))
    expect(saved.agents.map((a: { enabled: boolean }) => a.enabled)).toEqual([true, true])
    expect(saved.appearance).toBe('light')
    expect(saved.tesslWorkspaces).toEqual(['acme', 'beta'])
  } finally {
    await app.close()
  }
})

test('settings: a second workspace click waits for the first save', async () => {
  const { home, env } = fakeHome()
  const app = await _electron.launch({
    args: [`--user-data-dir=${join(home, 'electron-data')}`, join(ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Settings' })
      .click()
    const workspaces = page.getByRole('dialog').getByRole('group', { name: 'Workspaces' })
    await expect(workspaces.getByRole('checkbox', { name: 'beta' })).toBeVisible()
    // Pick beta, then, before the state comes back, unpick acme: the second click read an old list.
    await page.evaluate(async () => {
      const box = (name: string): HTMLInputElement =>
        [
          ...document.querySelectorAll<HTMLInputElement>(
            '[aria-label="Workspaces"] input[type=checkbox]'
          )
        ].find((b) => b.parentElement?.textContent?.trim() === name) as HTMLInputElement
      box('beta').click()
      await new Promise((r) => setTimeout(r, 0))
      box('acme').click()
    })
    await expect(workspaces.getByRole('checkbox', { name: 'beta' })).toBeChecked()
    await expect(workspaces.getByRole('checkbox', { name: 'beta' })).toBeEnabled()
    const saved = JSON.parse(readFileSync(join(home, '.loadout', 'config.json'), 'utf8'))
    expect(saved.tesslWorkspaces).toContain('beta')
  } finally {
    await app.close()
  }
})

test('settings: in a short window the first agent switch still gets the focus', async () => {
  const { home, env } = fakeHome()
  const app = await _electron.launch({
    args: [`--user-data-dir=${join(home, 'electron-data')}`, join(ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, ...env } as Record<string, string>
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    // At the minimum window height the Settings box scrolls, and a scrolling box can take the focus.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1024, 640)
    )
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(640)
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Settings' })
      .click()
    const settings = page.getByRole('dialog')
    const scrolls = await settings
      .locator('.dialog-box')
      .evaluate((box) => box.scrollHeight > box.clientHeight)
    expect(scrolls).toBe(true)
    await expect(settings.getByRole('checkbox', { name: 'Enable Claude Code' })).toBeFocused()
  } finally {
    await app.close()
  }
})
