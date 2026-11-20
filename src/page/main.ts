// The entry of the download page's app: the unchanged renderer on a stand-in for the main
// process (ADR 20261119-page-web-build). `pnpm site:app` builds it into site/app/.
import sample from './sample.json'
import { createStandIn, type Sample } from './standin'

// The page's app is always dark (vite.config.ts); the appearance button reads this query.
const DARK = '(prefers-color-scheme: dark)'
const systemQuery = window.matchMedia.bind(window)
window.matchMedia = (query) =>
  query === DARK
    ? ({
        matches: true,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined
      } as unknown as MediaQueryList)
    : systemQuery(query)

window.loadout = createStandIn(sample as unknown as Sample)

// The renderer reads window.loadout when it loads, so it must load after the line above.
await import('../renderer/src/main')

const page = window.parent
if (page !== window) {
  // A wheel that no list of the app can use moves the page. The browser does not hand it on
  // inside one trackpad gesture: the gesture stays on the list it started on.
  addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.deltaY === 0) return
      for (let el = e.target instanceof Element ? e.target : null; el; el = el.parentElement) {
        if (!/auto|scroll/.test(getComputedStyle(el).overflowY)) continue
        const room = e.deltaY > 0 ? el.scrollHeight - el.clientHeight - el.scrollTop : el.scrollTop
        if (room > 1) return
      }
      if (e.cancelable) e.preventDefault()
      page.scrollBy(0, e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 40 : e.deltaY)
    },
    { passive: false }
  )

  // Space scrolls the page, as it does outside the app; the arrow keys already do.
  const CONTROLS = 'input, textarea, select, button, a, summary, [contenteditable], [role="button"]'
  addEventListener('keydown', (e) => {
    if (e.key !== ' ' || e.defaultPrevented) return
    if (e.target instanceof Element && e.target.closest(CONTROLS)) return
    e.preventDefault()
    page.scrollBy({ top: (e.shiftKey ? -0.9 : 0.9) * page.innerHeight, behavior: 'smooth' })
  })

  // The page keeps its capture over the app until the first skill card is drawn.
  const ready = (): void => {
    if (!document.querySelector('article')) return void requestAnimationFrame(ready)
    void document.fonts.ready.then(() => page.postMessage('loadout-ready', location.origin))
  }
  ready()
}
