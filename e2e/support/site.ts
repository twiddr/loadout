import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const SITE = join(ROOT, 'site')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
}

/** Serves `site/` as GitHub Pages does. `blockApp`: every path under `/app/` answers 404. */
export async function serveSite(
  options: { blockApp?: boolean } = {}
): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)
    const file = join(SITE, normalize(path.endsWith('/') ? path + 'index.html' : path))
    try {
      if (!file.startsWith(SITE) || (options.blockApp && path.startsWith('/app/')))
        throw new Error()
      const body = readFileSync(file)
      response.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream'
      })
      response.end(body)
    } catch {
      response.writeHead(404).end('Not found')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}

/** Opens `url` in the repo's Electron as a plain browser, 1440 × 900, in the background. */
export async function openPage(url: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await _electron.launch({
    args: [
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'loadout-site-'))}`,
      join(__dirname, 'browser.mjs')
    ],
    env: { ...process.env, SITE_URL: url } as Record<string, string>
  })
  return { app, page: await app.firstWindow() }
}
