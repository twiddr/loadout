import { expect, type Page } from '@playwright/test'

/** Closes the Briefing that opens when no agent is enabled. */
export async function skipBriefing(page: Page): Promise<void> {
  const briefing = page.getByRole('dialog', { name: 'Briefing' })
  await briefing.getByRole('button', { name: 'Skip briefing' }).click()
  await expect(briefing).toBeHidden()
}
