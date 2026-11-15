import { defineConfig } from '@playwright/test'

// The app's windows show without taking the focus from other apps.
process.env.LOADOUT_TEST_BACKGROUND = '1'

export default defineConfig({
  testDir: '.',
  testMatch: /rehearse\.ts/,
  outputDir: 'out',
  timeout: 600_000,
  retries: 0,
  workers: 1,
  reporter: [['list']]
})
