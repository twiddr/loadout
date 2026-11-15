import { _electron, expect, test } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LoadoutApi } from '../src/core/ipc'
import { fakeHome } from './support/fake-home'

declare const window: { loadout: LoadoutApi }

const ROOT = join(__dirname, '..')

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('quit: a running Fix is stopped and recorded before Loadout exits', async () => {
  const { home, env } = fakeHome()
  const bin = join(home, 'fakebin')
  const pidFile = join(home, 'fix.pid')
  const late = join(home, 'late-marker')
  // A fix that edits SKILL.md, records its PID, then writes a marker 3 s later unless it is stopped.
  const fakeTessl = readFileSync(join(bin, 'tessl'), 'utf8').replace(
    /^#!\/bin\/sh\n/,
    `#!/bin/sh\nif [ "$1 $2" = "review fix" ]; then printf 'Partial fix.\\n' >> "$3/SKILL.md"; echo $$ > '${pidFile}'; /bin/sleep 3; echo late > '${late}'; exit 0; fi\n`
  )
  writeFileSync(join(bin, 'tessl'), fakeTessl)
  const launch = (): ReturnType<typeof _electron.launch> =>
    _electron.launch({
      args: [
        `--user-data-dir=${join(home, 'electron-data')}`,
        join(ROOT, 'out', 'main', 'index.js')
      ],
      env: { ...process.env, ...env } as Record<string, string>
    })

  const app = await launch()
  const page = await app.firstWindow()
  await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({ timeout: 10000 })
  await page.evaluate(() => {
    void window.loadout.invoke('fix', { skill: 'probe' })
  })
  await expect.poll(() => existsSync(pidFile)).toBe(true)
  const pid = Number(readFileSync(pidFile, 'utf8'))
  const exited = new Promise((resolve) => app.process().once('exit', resolve))
  await app.evaluate(({ app }) => app.quit())
  await exited

  expect(alive(pid)).toBe(false)
  await new Promise((resolve) => setTimeout(resolve, 3500))
  expect(existsSync(late)).toBe(false)
  // The partial fix was recorded, so it can be undone after a restart.
  expect(existsSync(join(home, '.loadout', 'fixes', 'probe', 'fix.json'))).toBe(true)

  const again = await launch()
  try {
    const next = await again.firstWindow()
    await expect(next.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    const state = await next.evaluate(() => window.loadout.invoke('get-state'))
    expect(state).toMatchObject({ ok: true, state: { fixes: { probe: { undoable: true } } } })
  } finally {
    await again.close()
  }
})
