// The stamp of the download page's app: one hash over everything `pnpm site:app` builds from
// (ADR 20261119-page-web-build). The build writes it; `check.mjs` compares it with the source.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'

const FOLDERS = ['src/renderer', 'src/core', 'src/page']
const FILES = ['package.json', 'pnpm-lock.yaml']

/**
 * SHA-256 over the path and the bytes of every build input under `root`, in sorted order.
 * @param {string} root the repo root
 * @returns {string} 64 hex characters
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JavaScript, so that Node runs the check with no build; the JSDoc gives the type
export function sourceHash(root) {
  const files = [...FILES]
  for (const folder of FOLDERS) {
    for (const entry of readdirSync(join(root, folder), { recursive: true, withFileTypes: true })) {
      // Finder's file and a tool's cache (a test runner keeps one beside vite.config.ts) are in
      // no commit, so they must not make this checkout differ from an export.
      if (!entry.isFile() || entry.name === '.DS_Store') continue
      const file = join(entry.parentPath, entry.name).slice(root.length + 1)
      if (!file.split(sep).includes('node_modules')) files.push(file)
    }
  }
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    hash
      .update(file)
      .update('\0')
      .update(readFileSync(join(root, file)))
      .update('\0')
  }
  return hash.digest('hex')
}
