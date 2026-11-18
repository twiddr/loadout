import { expect, test } from '@playwright/test'
import { rmSync } from 'node:fs'
import { fakeHome } from './support/fake-home'
import { launch } from './support/synced'

test('tips: a hover shows the tip, it describes its control, and only cut text gets one', async () => {
  const { home, env } = fakeHome()
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 20000
    })
    const probe = page.getByRole('article', { name: 'probe', exact: true })
    const box = probe.getByRole('checkbox', { name: 'probe Claude Code' })
    await expect(box).toHaveAccessibleDescription('Claude Code: deployed')
    const tip = page.locator(`#${await box.getAttribute('aria-describedby')}`)
    await expect(tip).toBeHidden()
    await probe.locator('label.toggle').first().hover()
    await expect(tip).toBeVisible()
    // (0, 0) is a drag region, which sends no pointerleave; the tip still hides.
    await page.mouse.move(0, 0)
    await expect(tip).toBeHidden()

    // The card path fits, so its tip stays shut.
    const path = probe.getByText('~/Code/Skills/probe', { exact: true })
    await path.hover()
    await expect(page.locator(`#${await path.getAttribute('aria-describedby')}`)).toBeHidden()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})
