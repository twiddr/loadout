import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CONFIG, serializeConfig } from '../src/core/config'
import type { LoadoutApi } from '../src/core/ipc'
import { VIEWS, worldTransform } from '../src/renderer/src/briefing'
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

/** The scale and the offsets in a `scale(k) translate(xpx, ypx)` transform. */
function parts(transform: string): number[] {
  return (transform.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number)
}

/** Waits until the world shows the view of card `step` at the current screen width. */
async function expectView(page: Page, step: number): Promise<void> {
  await expect(async () => {
    const { got, width } = await page.evaluate(() => {
      const world = document.querySelector<HTMLElement>('.brief-world')
      const view = document.querySelector<HTMLElement>('.brief-view')
      return { got: world?.style.transform ?? '', width: view?.clientWidth ?? 0 }
    })
    expect(width).toBeGreaterThan(0)
    const want = parts(worldTransform(VIEWS[step - 1], width))
    const have = parts(got)
    expect(have).toHaveLength(3)
    // The browser rounds the numbers it stores in the style.
    have.forEach((n, i) => expect(n).toBeCloseTo(want[i], 3))
  }).toPass({ timeout: 5000 })
}

const layer = (page: Page, name: string): Locator => page.locator(`[data-layer="${name}"]`).first()

test('briefing: the tablet shows the map and the frame', async () => {
  await withApp(false, async (page) => {
    await expect(dialog(page).locator('img.brief-frame')).toBeVisible()
    await expect(async () => {
      const widths = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLImageElement>('.brief-pad img')].map(
          (img) => img.naturalWidth
        )
      )
      // The map, the frame, two trucks, the drone and the helicopter.
      expect(widths).toHaveLength(6)
      expect(widths.every((w) => w > 0)).toBe(true)
    }).toPass({ timeout: 5000 })
  })
})

test('briefing: the map view and the layers follow the card', async () => {
  await withApp(false, async (page) => {
    const next = dialog(page).getByRole('button', { name: 'Next' })
    await expectView(page, 1)
    await expect(layer(page, 'supply')).not.toHaveClass(/\bon\b/)
    await next.click()
    await expectView(page, 2)
    await expect(layer(page, 'supply')).toHaveClass(/\bon\b/)
    await expect(layer(page, 'trucks')).toHaveClass(/\bon\b/)
    await next.click()
    await expectView(page, 3)
    await expect(layer(page, 'trucks')).not.toHaveClass(/\bon\b/)
    await expect(layer(page, 'recon')).toHaveClass(/\bon\b/)
    await next.click()
    await expectView(page, 4)
    await expect(layer(page, 'supply')).not.toHaveClass(/\bon\b/)
    await expect(layer(page, 'intel')).toHaveClass(/\bon\b/)
    await next.click()
    await expectView(page, 5)
    for (const name of ['supply', 'intel', 'publish', 'heli']) {
      await expect(layer(page, name)).toHaveClass(/\bon\b/)
    }
    await expect(layer(page, 'recon')).not.toHaveClass(/\bon\b/)
  })
})

test('briefing: fits the minimum window and keeps the view after a resize', async () => {
  await withApp(false, async (page, app) => {
    await dialog(page).getByRole('button', { name: 'Next' }).click()
    await expectView(page, 2)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 640))
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1024)
    await expectView(page, 2)
    const fit = await page.evaluate(() => {
      const d = document.querySelector<HTMLElement>('dialog.briefing .brief-card')
      const r = d?.getBoundingClientRect()
      return {
        inside:
          !!r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        noScroll: !!d && d.scrollHeight <= d.clientHeight && d.scrollWidth <= d.clientWidth
      }
    })
    expect(fit).toEqual({ inside: true, noScroll: true })
    await expect(dialog(page).getByRole('button', { name: 'Next' })).toBeInViewport({ ratio: 1 })
  })
})

test('briefing: the power-up waits for the images and plays at every open', async () => {
  await withApp(true, async (page) => {
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    const button = page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Briefing' })
    const view = dialog(page).locator('.brief-view')
    for (let i = 0; i < 2; i++) {
      await button.click()
      // The screen is dark first; the power-up starts a moment after the images are there.
      await expect(view).toBeVisible()
      await expect(view).not.toHaveClass(/\bboot\b/)
      await expect(view).toHaveClass(/\bboot\b/)
      const loaded = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLImageElement>('.brief-mapimg, .brief-frame')].every(
          (img) => img.complete && img.naturalWidth > 0
        )
      )
      expect(loaded).toBe(true)
      await dialog(page).getByRole('button', { name: 'Skip briefing' }).click()
    }
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

test('briefing: the page behind is dimmed and blurred, and the window can still be dragged', async () => {
  await withApp(false, async (page) => {
    await expect(heading(page, 'ONE KIT')).toBeVisible()
    const got = await page.evaluate(() => {
      const d = document.querySelector<HTMLElement>('dialog.briefing')
      const strip = document.querySelector<HTMLElement>('dialog.briefing .dialog-drag')
      const style = d ? getComputedStyle(d) : null
      const r = d?.getBoundingClientRect()
      const s = strip?.getBoundingClientRect()
      return {
        // The dialog covers the window, so its own drag strip lies over the title bar area.
        covers: !!r && r.width === innerWidth && r.height === innerHeight,
        blur: style?.backdropFilter ?? '',
        dim: Number(style?.backgroundColor.match(/[\d.]+(?=\)$)/)?.[0] ?? 0),
        strip: !!s && s.top === 0 && s.left === 0 && s.width === innerWidth && s.height >= 28,
        region: strip ? getComputedStyle(strip).getPropertyValue('-webkit-app-region') : ''
      }
    })
    expect(got.covers).toBe(true)
    expect(got.blur).toMatch(/blur\(/)
    expect(got.dim).toBeGreaterThanOrEqual(0.55)
    expect(got.strip).toBe(true)
    expect(got.region).toBe('drag')
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
