// Renders background.html to build/background.png (1x) and build/background@2x.png.
// Run through design/dmg/render.sh, which starts the repository's own Electron.
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')

app.whenReady().then(async () => {
  fs.mkdirSync(path.join(root, 'build'), { recursive: true })
  for (const [scale, name] of [
    [1, 'background.png'],
    [2, 'background@2x.png']
  ]) {
    const win = new BrowserWindow({
      width: 540 * scale,
      height: 380 * scale,
      show: false,
      useContentSize: true
    })
    await win.loadFile(path.join(import.meta.dirname, 'background.html'))
    win.webContents.setZoomFactor(scale)
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
    await new Promise((r) => setTimeout(r, 300))
    const image = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: 540 * scale,
      height: 380 * scale
    })
    fs.writeFileSync(path.join(root, 'build', name), image.toPNG())
    console.log(name, image.getSize())
  }
  app.quit()
})
