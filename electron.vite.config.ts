import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import pkg from './package.json'

export default defineConfig({
  main: {
    define: { __APP_VERSION__: JSON.stringify(pkg.version) }
  },
  preload: {},
  renderer: {
    plugins: [svelte()],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    build: {
      rolldownOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
