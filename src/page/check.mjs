// `pnpm site:app:check`: fails when site/app was built from another source than this tree holds.
// The export runs it at each release as the named check PAGE-APP (docs/releasing.md).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sourceHash } from './stamp.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let built = null
try {
  built = JSON.parse(readFileSync(join(root, 'site', 'app', 'build.json'), 'utf8')).source
} catch {
  // No stamp, or not JSON: the page has no build of this source.
}

if (built === sourceHash(root)) {
  console.log('PAGE-APP: site/app matches the source')
} else {
  console.error("site/app is older than the app's source. Run pnpm site:app.")
  process.exit(1)
}
