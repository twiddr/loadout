import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeHome } from './support/fake-home'
import { launch } from './support/synced'

/** The `TESSL_AUTO_UPDATE_INTERVAL_MINUTES` of each `tessl whoami`, one line per call. */
function whoamiEnv(home: string): string[] {
  const file = join(home, 'tessl-whoami-env')
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').slice(0, -1) : []
}

test('Tessl updates itself after READY and the row shows UPDATING', async () => {
  const { home, env } = fakeHome()
  writeFileSync(join(home, 'tessl-update-to'), '0.120.0\n')
  writeFileSync(join(home, 'tessl-update.sleep'), '6')
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 20000
    })
    const row = page.locator('.squad .system', { hasText: 'tessl' })
    await expect(row.locator('.tool-updating')).toHaveText('UPDATING')
    await expect(row).toContainText('0.120.0', { timeout: 20000 })
    await expect(row.locator('.tool-updating')).toHaveCount(0)
    // The startup call ran with the update off; the update call with no value of its own.
    expect(whoamiEnv(home).sort()).toEqual(['', '0'])
    // The update reaches the Log page as one run.
    await page.getByRole('link', { name: 'Log' }).click()
    const card = page.getByRole('article', { name: /^Run \d+$/ })
    await expect(card).toHaveCount(1)
    await expect(card.getByText('Tessl is updating itself.')).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('no update, no UPDATING', async () => {
  const { home, env } = fakeHome()
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 20000
    })
    await expect.poll(() => whoamiEnv(home).length, { timeout: 10000 }).toBe(2)
    const row = page.locator('.squad .system', { hasText: 'tessl' })
    await expect(row).toContainText('0.119.0')
    await expect(row.locator('.tool-updating')).toHaveCount(0)
    // A launch without an update logs nothing.
    await page.getByRole('link', { name: 'Log' }).click()
    await expect(page.getByRole('article', { name: /^Run \d+$/ })).toHaveCount(0)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})
