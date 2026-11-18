import { _electron, expect, test } from '@playwright/test'
import { join } from 'node:path'
import { fakeHome } from './support/fake-home'

const ROOT = join(__dirname, '..')

test('skill page: hides and shows the PLATOON panel', async () => {
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
    const panel = page.locator('aside.squad')
    const hide = page.getByRole('button', { name: 'Hide platoon' })
    const show = page.getByRole('button', { name: 'Show platoon' })

    // The LOADOUT page never hides the panel.
    await expect(panel).toBeVisible()
    await expect(hide).toHaveCount(0)

    await page.getByRole('button', { name: 'probe', exact: true }).click()
    const file = page.getByRole('region', { name: 'Skill file' })
    const narrow = (await file.boundingBox())!.width
    // The Hide icon's centre is on the version's line, its left edge on the PLATOON title's.
    const icon = (await hide.locator('svg').boundingBox())!
    const version = (await page.locator('.app-version').boundingBox())!
    const title = (await page.locator('.squad-title').boundingBox())!
    expect(Math.abs(icon.y + icon.height / 2 - (version.y + version.height / 2))).toBeLessThan(1.5)
    expect(Math.abs(icon.x - title.x)).toBeLessThan(1.5)
    await hide.click()
    await expect(panel).toHaveAttribute('inert', '')
    await expect(show).toBeVisible()
    // The skill file box takes the panel's width.
    await expect.poll(async () => (await file.boundingBox())!.width).toBeGreaterThan(narrow + 250)

    // The panel stays hidden on the next skill page visit, and LOADOUT still shows it.
    await page.getByRole('button', { name: 'Back to Loadout' }).click()
    await expect(panel).not.toHaveAttribute('inert')
    await expect(show).toHaveCount(0)
    await page.getByRole('button', { name: 'probe', exact: true }).click()
    await expect(show).toBeVisible()

    await show.click()
    await expect(panel).not.toHaveAttribute('inert')
    await expect(hide).toBeVisible()
    await expect(show).toHaveCount(0)
  } finally {
    await app.close()
  }
})
