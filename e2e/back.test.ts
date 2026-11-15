import { _electron, expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { fakeHome } from './support/fake-home'

const ROOT = join(__dirname, '..')

/** The mouse back button, sent through Chromium's input pipeline as a native press and release. */
async function pressBack(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  for (const type of ['mousePressed', 'mouseReleased'] as const) {
    await cdp.send('Input.dispatchMouseEvent', {
      type,
      x: 600,
      y: 400,
      button: 'back',
      clickCount: 1
    })
  }
  await cdp.detach()
}

test('mouse back button: returns to the pages seen before', async () => {
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
    const rail = (name: string): ReturnType<Page['getByRole']> => page.getByRole('link', { name })

    await rail('Recon').click()
    await rail('Log').click()
    await pressBack(page)
    await expect(rail('Recon')).toHaveAttribute('aria-current', 'page')
    await pressBack(page)
    await expect(rail('Loadout')).toHaveAttribute('aria-current', 'page')

    // A tab change is not a step back; the skill page comes back on its last tab.
    await page.getByRole('button', { name: 'probe', exact: true }).click()
    await page.getByRole('tab', { name: 'Review' }).click()
    await rail('Log').click()
    await pressBack(page)
    await expect(page.getByRole('tab', { name: 'Review' })).toHaveAttribute('aria-selected', 'true')
    await pressBack(page)
    await expect(page.getByRole('button', { name: 'probe', exact: true })).toBeVisible()

    // Logi Options+ sends Back as a macOS swipe, which Electron emits on the window as 'left'.
    await rail('Log').click()
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].emit('swipe', {}, 'left')
    })
    await expect(rail('Loadout')).toHaveAttribute('aria-current', 'page')

    // An open dialog keeps the page behind it.
    await rail('Recon').click()
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Settings' })
      .click()
    await pressBack(page)
    await expect(rail('Recon')).toHaveAttribute('aria-current', 'page')
  } finally {
    await app.close()
  }
})
