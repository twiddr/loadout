// The download page with the working app in its app slot (site/app/, the committed build).
import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { openPage, serveSite } from './support/site'

const FRAME = 'iframe[title="Loadout, with sample skills"]'

/** The first scroll starts the box move and loads the app; then the app section comes into view. */
async function toApp(page: Page): Promise<void> {
  await expect(page.locator('html.motion')).toBeAttached()
  await page.mouse.move(720, 300)
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(1600)
  await page.evaluate(() => document.getElementById('app')?.scrollIntoView())
}

const slots = (frame: FrameLocator, count: number): ReturnType<FrameLocator['getByText']> =>
  frame.getByText(new RegExp(`^${count} / 15 SLOTS$`))

test("a visitor flips a switch in the page's app", async () => {
  const site = await serveSite()
  const { app, page } = await openPage(site.url)
  const fromFrame: string[] = []
  page.on('request', (request) => {
    if (request.frame() !== page.mainFrame()) fromFrame.push(request.url())
  })
  await expect(page.locator('#app-h')).toHaveText('See it here')
  await expect(page.locator('iframe')).toHaveCount(0)

  await toApp(page)
  await expect(page.locator(FRAME)).toHaveClass('on')
  await expect(page.locator('#app-h')).toHaveText('Try it here')
  await expect(page.locator('.app .head p')).toHaveText(
    'This is the real app, with sample skills.Flip a switch. Nothing is installed.'
  )
  await expect(page.locator(FRAME)).toHaveAttribute('tabindex', '-1')
  // The slot keeps its size in the pinned section: (900 - 240) x 1.6 wide, 1440 : 900.
  const slot = await page.locator('.screen').boundingBox()
  expect([Math.round(slot?.width ?? 0), Math.round(slot?.height ?? 0)]).toEqual([1056, 660])

  const frame = page.frameLocator(FRAME)
  await expect(slots(frame, 8)).toHaveCount(2)
  await frame
    .getByRole('article', { name: 'incident-report', exact: true })
    .locator('label.toggle')
    .first()
    .click()
  await expect(slots(frame, 9)).toHaveCount(1)
  expect(fromFrame.length).toBeGreaterThan(0)
  expect(fromFrame.filter((url) => !url.startsWith(site.url + 'app/'))).toEqual([])

  await page.reload()
  await toApp(page)
  await expect(page.locator(FRAME)).toHaveClass('on')
  await expect(slots(page.frameLocator(FRAME), 8)).toHaveCount(2)
  await app.close()
  await site.close()
})

test('the app keeps its state when the window size changes', async () => {
  const site = await serveSite()
  const { app, page } = await openPage(site.url)
  await toApp(page)
  await expect(page.locator(FRAME)).toHaveClass('on')
  const frame = page.frameLocator(FRAME)
  await frame
    .getByRole('article', { name: 'incident-report', exact: true })
    .locator('label.toggle')
    .first()
    .click()
  await expect(slots(frame, 9)).toHaveCount(1)
  // A resize makes ScrollTrigger measure the pinned app section again. A frame that moves in
  // the DOM for that loads again, and the app starts over from the sample.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1300, 800)
  )
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => innerWidth)).toBe(1300)
  await expect(slots(frame, 9)).toHaveCount(1)
  await app.close()
  await site.close()
})

test("the capture stays when the app's files are blocked", async () => {
  const site = await serveSite({ blockApp: true })
  const { app, page } = await openPage(site.url)
  await toApp(page)
  await expect(page.locator('iframe')).toHaveCount(1)
  await page.waitForTimeout(1500)
  await expect(page.locator('.screen img')).toBeVisible()
  await expect(page.locator('#app-h')).toHaveText('See it here')
  await expect(page.locator('iframe.on')).toHaveCount(0)
  await expect(page.locator('iframe')).toHaveCSS('opacity', '0')
  await expect(page.locator('iframe')).toHaveCSS('pointer-events', 'none')
  await app.close()
  await site.close()
})

test('one scroll gesture over the card list of the app moves the page', async () => {
  const site = await serveSite()
  const { app, page } = await openPage(site.url)
  await toApp(page)
  await expect(page.locator(FRAME)).toHaveClass('on')
  await page.waitForTimeout(400)
  // The card list has a few pixels of its own scroll. Without the wheel rule of src/page/main.ts
  // the browser keeps the whole gesture on that list, and the page does not move.
  const slot = await page.locator('.screen').boundingBox()
  if (!slot) throw new Error('the app slot is not on the screen')
  const before = await page.evaluate(() => scrollY)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.synthesizeScrollGesture', {
    x: Math.round(slot.x + slot.width * 0.45),
    y: Math.round(slot.y + slot.height * 0.6),
    yDistance: -600,
    speed: 1200,
    gestureSourceType: 'mouse'
  })
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThanOrEqual(before + 300)
  await app.close()
  await site.close()
})
