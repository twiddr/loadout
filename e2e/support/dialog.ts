import { expect, type Locator } from '@playwright/test'

/**
 * Checks that an open dialog covers the window and that its first child is a drag strip across the
 * top, because a modal dialog stops the page's drag regions. Playwright clicks skip drag regions, so
 * only a manual walk proves that the window moves.
 */
export async function expectWindowDrag(dialog: Locator): Promise<void> {
  await expect(dialog).toBeVisible()
  const got = await dialog.evaluate((d) => {
    const r = d.getBoundingClientRect()
    const strip = d.firstElementChild
    const s = strip?.getBoundingClientRect()
    const region = (el: Element | null | undefined): string =>
      el ? getComputedStyle(el).getPropertyValue('-webkit-app-region') : ''
    return {
      covers: r.top === 0 && r.left === 0 && r.width === innerWidth && r.height === innerHeight,
      strip: !!s && s.top === 0 && s.left === 0 && s.width === innerWidth && s.height >= 28,
      stripRegion: region(strip),
      // The box comes after the strip, so its no-drag wins where the two meet.
      boxRegion: region(strip?.nextElementSibling)
    }
  })
  expect(got).toEqual({ covers: true, strip: true, stripRegion: 'drag', boxRegion: 'no-drag' })
}
