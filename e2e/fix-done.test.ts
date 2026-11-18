import { expect, test } from '@playwright/test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeHome } from './support/fake-home'
import { launch } from './support/synced'

test('fix done: a FIXED dialog on another page, none on the skill page, and none over another dialog', async () => {
  const { home, env } = fakeHome()
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    const nav = page.getByRole('navigation', { name: 'Main' })
    const probe = page.getByRole('article', { name: 'probe', exact: true })
    const done = page.getByRole('dialog', { name: 'FIXED' })
    const runFix = async (): Promise<void> => {
      await page.getByLabel('Actions for probe', { exact: true }).click()
      await page.getByRole('button', { name: 'Tessl fix' }).click()
      await page.getByRole('button', { name: 'Run Fix' }).click()
    }

    // On the LOADOUT page the fix ends in the dialog; LATER leaves the FIXED mark on the card.
    await runFix()
    await expect(done).toBeVisible()
    await expect(done.getByText('probe', { exact: true })).toBeVisible()
    await expect(
      done.getByText(
        'The fix changed 2 files. Read them on the FIX tab, then keep or undo the fix.'
      )
    ).toBeVisible()
    await done.getByRole('button', { name: 'LATER' }).click()
    await expect(done).toBeHidden()
    await expect(probe.getByRole('button', { name: 'Fix probe' })).toHaveText('fixed')

    // OPEN FIX opens the skill page on the FIX tab; one more changed line is one file.
    await runFix()
    await expect(
      done.getByText('The fix changed 1 file. Read it on the FIX tab, then keep or undo the fix.')
    ).toBeVisible()
    await done.getByRole('button', { name: 'OPEN FIX' }).click()
    await expect(done).toBeHidden()
    const fixTab = page.getByRole('tab', { name: 'Fix' })
    await expect(fixTab).toHaveAttribute('aria-selected', 'true')

    // On the skill's own page the fix opens the FIX tab and no dialog.
    await page.getByRole('tab', { name: 'Briefing' }).click()
    await expect(fixTab).toHaveAttribute('aria-selected', 'false')
    await runFix()
    await expect(fixTab).toHaveAttribute('aria-selected', 'true')
    await expect(done).toBeHidden()

    // A fix that ends under another dialog waits until that dialog closes.
    await nav.getByRole('link', { name: 'Loadout' }).click()
    writeFileSync(join(home, 'fix.sleep'), '3')
    await runFix()
    await expect(probe.getByText('fixing…')).toBeVisible()
    await nav.getByRole('button', { name: 'Settings' }).click()
    const settings = page.locator('dialog.settings')
    await expect(settings).toBeVisible()
    await expect(probe.getByText('fixing…')).toBeHidden({ timeout: 15_000 })
    await expect(done).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(settings).toBeHidden()
    await expect(done).toBeVisible()
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
})
