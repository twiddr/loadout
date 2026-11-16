import { defineConfig } from '@playwright/test'

// Every test launches Loadout with process.env: in the background, so it never takes focus.
process.env.LOADOUT_TEST_BACKGROUND = '1'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // Parallel apps load slowly: a first paint can take more than the default 5 s.
  expect: { timeout: 10_000 },
  retries: 0,
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: { screenshot: 'only-on-failure' }
})
