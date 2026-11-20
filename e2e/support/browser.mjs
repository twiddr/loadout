// A plain browser window for the download page tests: no Playwright browser is installed, so
// the repo's own Electron shows the page. It never takes the focus, like the app's test launches.
import { app, BrowserWindow, screen, session } from 'electron'

const url = process.env.SITE_URL
const origin = new URL(url).origin

app.setActivationPolicy('accessory')
app.on('window-all-closed', () => app.quit())

app.whenReady().then(() => {
  // A test never reaches another host: the page's release facts would spend the GitHub API limit.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^https?:/.test(details.url) && !details.url.startsWith(origin + '/') })
  })
  const window = new BrowserWindow({ width: 1440, height: 900, useContentSize: true, show: false })
  const area = screen.getPrimaryDisplay().workArea
  window.showInactive()
  // After the show: macOS moves a window that appears off screen back onto the screen.
  window.setPosition(area.x + area.width - 40, area.y + area.height - 40)
  void window.loadURL(url)
})
