import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CONFIG, serializeConfig } from '../src/core/config'
import type { LoadoutApi } from '../src/core/ipc'
import { fakeHome } from './support/fake-home'
import { launch } from './support/synced'

declare const window: { loadout: LoadoutApi; innerWidth: number }
declare const innerWidth: number
declare const innerHeight: number

const TITLES = ['ONE KIT', 'DEPLOY', 'RECON', 'INTEL', 'INSPECTION']

/** Runs `body` on a fake home; `agents: false` leaves no agent enabled, so the Briefing opens. */
async function withApp(
  agents: boolean,
  body: (page: Page, app: ElectronApplication) => Promise<void>
): Promise<void> {
  const { home, env } = fakeHome()
  if (!agents) {
    writeFileSync(join(home, '.loadout', 'config.json'), serializeConfig(DEFAULT_CONFIG))
  }
  const app = await launch(home, env)
  try {
    await body(await app.firstWindow(), app)
  } finally {
    await app.close()
    rmSync(home, { recursive: true, force: true })
  }
}

const dialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Briefing' })
const heading = (page: Page, title: string): Locator =>
  dialog(page).getByRole('heading', { name: title, exact: true })

test('briefing: opens over BOOT CAMP when no agent is enabled', async () => {
  await withApp(false, async (page) => {
    const briefing = dialog(page)
    await expect(heading(page, 'ONE KIT')).toBeVisible()
    await expect(briefing.getByText('1 OF 5')).toBeVisible()
    // The first focus is the dialog, not the first chevron.
    await expect(briefing).toBeFocused()
    await expect(briefing.getByRole('button', { name: 'Back' })).toBeDisabled()
    await expect(page.getByRole('link', { name: 'BOOT CAMP' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    for (const title of TITLES.slice(1)) {
      await briefing.getByRole('button', { name: 'Next' }).click()
      await expect(heading(page, title)).toBeVisible()
    }
    await expect(briefing.getByText('5 OF 5')).toBeVisible()
    await expect(briefing.getByRole('button', { name: 'Next' })).toHaveCount(0)
    await briefing.getByRole('button', { name: 'Report to Boot Camp' }).click()
    await expect(briefing).toBeHidden()
    await expect(
      page.getByRole('region', { name: 'BOOT CAMP' }).getByRole('heading', { name: 'BOOT CAMP' })
    ).toBeVisible()
  })
})

test('briefing: Skip briefing closes it', async () => {
  await withApp(false, async (page) => {
    await dialog(page).getByRole('button', { name: 'Skip briefing' }).click()
    await expect(dialog(page)).toBeHidden()
  })
})

test('briefing: Escape closes it', async () => {
  await withApp(false, async (page) => {
    await expect(heading(page, 'ONE KIT')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
  })
})

test('briefing: stays closed with an agent enabled; the rail button opens it', async () => {
  await withApp(true, async (page) => {
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    await expect(dialog(page)).toBeHidden()
    const rail = page.getByRole('navigation', { name: 'Main' })
    await rail.getByRole('button', { name: 'Briefing' }).click()
    await expect(heading(page, 'ONE KIT')).toBeVisible()
    for (let i = 0; i < 4; i++) await dialog(page).getByRole('button', { name: 'Next' }).click()
    await dialog(page).getByRole('button', { name: 'Dismissed' }).click()
    await expect(dialog(page)).toBeHidden()
    await expect(rail.getByRole('link', { name: 'LOADOUT' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })
})

test('briefing: arrow keys and pips move between the cards', async () => {
  await withApp(false, async (page) => {
    await expect(heading(page, 'ONE KIT')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(heading(page, 'DEPLOY')).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(heading(page, 'ONE KIT')).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Card 4: INTEL' }).click()
    await expect(heading(page, 'INTEL')).toBeVisible()
    // A held key must end on the last card, never close the Briefing.
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
    await expect(heading(page, 'INSPECTION')).toBeVisible()
    await expect(dialog(page)).toHaveAttribute('data-step', '5')
  })
})

test('briefing: a state push does not move it or open it again', async () => {
  await withApp(false, async (page) => {
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    await dialog(page).getByRole('button', { name: 'Next' }).click()
    await dialog(page).getByRole('button', { name: 'Next' }).click()
    await page.evaluate(() => window.loadout.invoke('refresh'))
    await expect(heading(page, 'RECON')).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Skip briefing' }).click()
    await expect(dialog(page)).toBeHidden()
    await page.evaluate(() => window.loadout.invoke('refresh'))
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    await expect(dialog(page)).toBeHidden()
  })
})

test('briefing: opens on the first card again after a close', async () => {
  await withApp(true, async (page) => {
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    const button = page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Briefing' })
    await button.click()
    await dialog(page).getByRole('button', { name: 'Next' }).click()
    await dialog(page).getByRole('button', { name: 'Next' }).click()
    await expect(heading(page, 'RECON')).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Skip briefing' }).click()
    await button.click()
    await expect(heading(page, 'ONE KIT')).toBeVisible()
  })
})

const SPREADS = ['one-kit', 'deploy', 'recon', 'intel', 'inspection']

/** The file names of the spreads that show; the build adds a hash to each name. */
const shownSpreads = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLImageElement>('dialog.briefing .brief-art img')]
      .filter((img) => !img.hidden && img.naturalWidth === 1280 && img.naturalHeight === 720)
      .map((img) => img.src.split('/').pop() ?? '')
  )

/** Waits until card `step` shows its own spread, and only that one. */
async function expectSpread(page: Page, step: number): Promise<void> {
  await expect
    .poll(() => shownSpreads(page))
    .toEqual([expect.stringMatching(new RegExp(`^${SPREADS[step - 1]}-[\\w-]+\\.webp$`))])
}

/** Waits until all five spreads are decoded, so a move between cards can draw a page turn. */
async function spreadsReady(page: Page): Promise<void> {
  await expect(dialog(page).locator('.brief-art img')).toHaveCount(5)
  await page.evaluate(() =>
    Promise.all(
      [...document.querySelectorAll<HTMLImageElement>('dialog.briefing .brief-art img')].map(
        (img) => img.decode()
      )
    )
  )
}

const leaf = (page: Page): Locator => dialog(page).locator('canvas.brief-leaf')

/**
 * Clicks the Briefing buttons named in `names`, one quickly after the other, well inside one page
 * turn; then tells whether the page turn shows and which card the Briefing shows.
 */
function click(page: Page, ...names: string[]): Promise<{ turning: boolean; title: string }> {
  return page.evaluate(async (names) => {
    for (const name of names) {
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('dialog.briefing button')]
      const button = buttons.find(
        (b) => b.textContent?.trim() === name || b.getAttribute('aria-label') === name
      )
      if (!button) throw new Error(`no button ${name}`)
      button.click()
      // The page updates before the next click, as it does between two clicks of a person.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const canvas = document.querySelector<HTMLCanvasElement>('dialog.briefing canvas.brief-leaf')
    return {
      turning: !!canvas && !canvas.hidden,
      title: document.querySelector('dialog.briefing h2')?.textContent ?? ''
    }
  }, names)
}

test('briefing: each card shows its field-manual spread', async () => {
  await withApp(false, async (page) => {
    await expectSpread(page, 1)
    for (let step = 2; step <= 5; step++) {
      await dialog(page).getByRole('button', { name: 'Next' }).click()
      await expectSpread(page, step)
    }
    await expect(leaf(page)).toBeHidden()
  })
})

test('briefing: a page turn plays between cards, and the latest input wins', async () => {
  await withApp(false, async (page) => {
    await spreadsReady(page)
    // The text and the controls of the next card are there while the page turns.
    expect(await click(page, 'Next')).toEqual({ turning: true, title: 'DEPLOY' })
    await expect(leaf(page)).toBeHidden()
    expect(await click(page, 'Back')).toEqual({ turning: true, title: 'ONE KIT' })
    await expect(leaf(page)).toBeHidden()
    // A quick reversal: the second click starts a new turn and ends on its card.
    expect(await click(page, 'Next', 'Back')).toEqual({ turning: true, title: 'ONE KIT' })
    await expect(leaf(page)).toBeHidden()
    await expect(dialog(page)).toHaveAttribute('data-step', '1')
    await expectSpread(page, 1)
    // A direct jump makes one turn to its card.
    expect(await click(page, 'Card 4: INTEL')).toEqual({ turning: true, title: 'INTEL' })
    await expect(leaf(page)).toBeHidden()
    await expectSpread(page, 4)
  })
})

test('briefing: a close during a turn cancels it, and a replay starts on ONE KIT', async () => {
  await withApp(false, async (page) => {
    await spreadsReady(page)
    const got = await page.evaluate(async () => {
      const d = document.querySelector<HTMLDialogElement>('dialog.briefing')
      const canvas = (): HTMLCanvasElement | null => document.querySelector('canvas.brief-leaf')
      const next = [...document.querySelectorAll<HTMLButtonElement>('dialog.briefing button')].find(
        (b) => b.textContent?.trim() === 'Next'
      )
      next?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      const before = !canvas()?.hidden
      // What Escape sends to a modal dialog.
      d?.dispatchEvent(new Event('cancel', { cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
      return { before, after: !canvas()?.hidden }
    })
    expect(got).toEqual({ before: true, after: false })
    await expect(dialog(page)).toBeHidden()
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Briefing' })
      .click()
    await expect(heading(page, 'ONE KIT')).toBeVisible()
    await expect(dialog(page)).toHaveAttribute('data-step', '1')
    await expectSpread(page, 1)
    await expect(leaf(page)).toBeHidden()
  })
})

test('briefing: with reduced motion the destination shows at once', async () => {
  await withApp(false, async (page) => {
    await spreadsReady(page)
    expect(await click(page, 'Next')).toEqual({ turning: true, title: 'DEPLOY' })
    await expect(leaf(page)).toBeHidden()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await click(page, 'Next')).toEqual({ turning: false, title: 'RECON' })
    await expectSpread(page, 3)
    expect(await click(page, 'Card 1: ONE KIT')).toEqual({ turning: false, title: 'ONE KIT' })
    await expectSpread(page, 1)
  })
})

test('briefing: fits the minimum window with the whole spread in view', async () => {
  await withApp(false, async (page, app) => {
    await dialog(page).getByRole('button', { name: 'Next' }).click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 640))
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1024)
    await expectSpread(page, 2)
    const fit = await page.evaluate(() => {
      const d = document.querySelector<HTMLElement>('dialog.briefing .brief-card')
      const r = d?.getBoundingClientRect()
      const art = document.querySelector<HTMLElement>('dialog.briefing .brief-art')
      const a = art?.getBoundingClientRect()
      return {
        inside:
          !!r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        noScroll: !!d && d.scrollHeight <= d.clientHeight && d.scrollWidth <= d.clientWidth,
        art:
          !!r &&
          !!a &&
          a.width > 400 &&
          Math.abs(a.width / a.height - 16 / 9) < 0.01 &&
          a.left >= r.left &&
          a.right <= r.right &&
          a.top >= r.top &&
          a.bottom <= r.bottom
      }
    })
    expect(fit).toEqual({ inside: true, noScroll: true, art: true })
    await expect(dialog(page).getByRole('button', { name: 'Next' })).toBeInViewport({ ratio: 1 })
  })
})

test('briefing: arrow keys work after a click removed or disabled the focused button', async () => {
  await withApp(false, async (page) => {
    for (let i = 0; i < 4; i++) await dialog(page).getByRole('button', { name: 'Next' }).click()
    await expect(heading(page, 'INSPECTION')).toBeVisible()
    // The clicked Next button is gone on the last card.
    await page.keyboard.press('ArrowLeft')
    await expect(heading(page, 'INTEL')).toBeVisible()
    for (let i = 0; i < 3; i++) await dialog(page).getByRole('button', { name: 'Back' }).click()
    await expect(heading(page, 'ONE KIT')).toBeVisible()
    // The clicked Back button is disabled on the first card.
    await page.keyboard.press('ArrowRight')
    await expect(heading(page, 'DEPLOY')).toBeVisible()
  })
})

test('briefing: a double-click on Next on card 4 stops on the last card', async () => {
  await withApp(false, async (page) => {
    const next = dialog(page).getByRole('button', { name: 'Next' })
    for (let i = 0; i < 3; i++) await next.click()
    await expect(heading(page, 'INTEL')).toBeVisible()
    const box = await next.boundingBox()
    if (!box) throw new Error('no Next button')
    // The second click of the pair lands on the button that replaces Next.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 2 })
    await expect(heading(page, 'INSPECTION')).toBeVisible()
    await page.waitForTimeout(300)
    await expect(dialog(page)).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Report to Boot Camp' }).click()
    await expect(dialog(page)).toBeHidden()
  })
})

test('briefing: the page behind is dimmed and blurred, the card is dark, and the window can still be dragged', async () => {
  await withApp(false, async (page) => {
    await expect(heading(page, 'ONE KIT')).toBeVisible()
    const got = await page.evaluate(() => {
      const d = document.querySelector<HTMLElement>('dialog.briefing')
      const strip = document.querySelector<HTMLElement>('dialog.briefing .dialog-drag')
      const card = document.querySelector<HTMLElement>('dialog.briefing .brief-card')
      const style = d ? getComputedStyle(d) : null
      const r = d?.getBoundingClientRect()
      const s = strip?.getBoundingClientRect()
      return {
        // The dialog covers the window, so its own drag strip lies over the title bar area.
        covers: !!r && r.width === innerWidth && r.height === innerHeight,
        blur: style?.backdropFilter ?? '',
        dim: Number(style?.backgroundColor.match(/[\d.]+(?=\)$)/)?.[0] ?? 0),
        strip: !!s && s.top === 0 && s.left === 0 && s.width === innerWidth && s.height >= 28,
        region: strip ? getComputedStyle(strip).getPropertyValue('-webkit-app-region') : '',
        card: card ? getComputedStyle(card).backgroundColor : ''
      }
    })
    expect(got.covers).toBe(true)
    expect(got.blur).toMatch(/blur\(/)
    expect(got.dim).toBeGreaterThanOrEqual(0.55)
    expect(got.strip).toBe(true)
    expect(got.region).toBe('drag')
    // Playwright runs the app in the light appearance; the card stays dark.
    expect(got.card).toBe('rgb(48, 48, 48)')
  })
})

test('briefing: it fades out before it closes', async () => {
  await withApp(false, async (page) => {
    await expect(heading(page, 'ONE KIT')).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Skip briefing' }).click()
    // Still open while the card and the blur fade.
    await expect(dialog(page)).toHaveClass(/\bclosing\b/)
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page)).toBeHidden()
    // Escape takes the same way out.
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Briefing' })
      .click()
    await expect(heading(page, 'ONE KIT')).toBeVisible()
    await expect(dialog(page)).not.toHaveClass(/\bclosing\b/)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveClass(/\bclosing\b/)
    await expect(dialog(page)).toBeHidden()
  })
})
