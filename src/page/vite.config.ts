// `pnpm site:app`: the web build of the renderer for the download page, written to site/app/
// and committed (ADR 20261119-page-web-build). Renewed only at a release (docs/releasing.md).
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import pkg from '../../package.json'
import { sourceHash } from './stamp.mjs'

const repo = resolve(__dirname, '..', '..')
const out = join(repo, 'site', 'app')

/** The page is dark, so the app's dark colours apply whatever the visitor's system says. */
const alwaysDark: Plugin = {
  name: 'always-dark',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/src/renderer/src/app.css')) return null
    const query = '@media (prefers-color-scheme: dark)'
    const scheme = 'color-scheme: light dark;'
    if (!code.includes(query) || !code.includes(scheme)) {
      throw new Error('app.css: the colour scheme block was not found')
    }
    return code.replace(query, '@media all').replace(scheme, 'color-scheme: dark;')
  }
}

/**
 * `pnpm site:app:check` compares this hash with the source (check.mjs). Written with the bundle:
 * a build that fails writes neither, so the old build keeps its old stamp.
 */
const stamp: Plugin = {
  name: 'stamp',
  writeBundle() {
    const text = JSON.stringify({ version: pkg.version, source: sourceHash(repo) }, null, 2)
    writeFileSync(join(out, 'build.json'), text + '\n')
  }
}

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [svelte({ configFile: join(repo, 'svelte.config.mjs') }), alwaysDark, stamp],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    outDir: out,
    emptyOutDir: true,
    // The app's CSP has no `data:` source, so no font may be inlined.
    assetsInlineLimit: 0,
    target: 'es2022'
  }
})
