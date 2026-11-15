import { defineConfig } from '@playwright/test'

// Every test launches Loadout with process.env: in the background, so it never takes focus.
process.env.LOADOUT_TEST_BACKGROUND = '1'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: { screenshot: 'only-on-failure' }
})
