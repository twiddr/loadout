import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runTesslUpdate, updateEnv } from '../src/main/tesslupdate'

/** While `hold` is set, every `open` of the module under test waits for it: a poll stays in flight. */
const gate = vi.hoisted(() => ({ hold: null as Promise<void> | null }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    open: async (...args: Parameters<typeof real.open>) => {
      if (gate.hold) await gate.hold
      return real.open(...args)
    }
  }
})

let tmp: string
let log: string
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'loadout-tesslupdate-'))
  log = join(tmp, 'auto-update.log')
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function fakeTessl(body: string): Promise<string> {
  const path = join(tmp, 'tessl')
  await writeFile(path, `#!/bin/sh\n${body}\n`)
  await chmod(path, 0o755)
  return path
}

const START = '=== Auto-update started at x ==='

/** Runs the update call and counts `onStart`; `startedAt` is the time of the first call. */
async function update(
  tessl: string
): Promise<{ starts: number; startedAt: number; endedAt: number }> {
  let starts = 0
  let startedAt = 0
  await runTesslUpdate({
    tessl,
    env: { PATH: '/usr/bin' },
    cwd: tmp,
    logFile: log,
    pollMs: 50,
    onStart: () => {
      starts += 1
      if (!startedAt) startedAt = Date.now()
    }
  })
  return { starts, startedAt, endedAt: Date.now() }
}

describe('updateEnv', () => {
  const toolEnv = { X: '1', TESSL_AUTO_UPDATE_INTERVAL_MINUTES: '0' }

  it('drops the variable when the user has none', () => {
    const env = updateEnv(toolEnv, {})
    expect('TESSL_AUTO_UPDATE_INTERVAL_MINUTES' in env).toBe(false)
    expect(env.X).toBe('1')
  })

  it.each(['0', '30'])('keeps the user value %s', (value) => {
    expect(updateEnv(toolEnv, { TESSL_AUTO_UPDATE_INTERVAL_MINUTES: value })).toEqual({
      X: '1',
      TESSL_AUTO_UPDATE_INTERVAL_MINUTES: value
    })
  })
})

describe('runTesslUpdate', () => {
  it('calls onStart once while Tessl updates', async () => {
    const tessl = await fakeTessl(
      `echo '${START}' >> '${log}'; /bin/sleep 1; echo '${START}' >> '${log}'; /bin/sleep 1`
    )
    const { starts, startedAt, endedAt } = await update(tessl)
    expect(starts).toBe(1)
    expect(endedAt - startedAt).toBeGreaterThan(500)
  })

  it('never calls onStart after the run ended', async () => {
    let release = (): void => undefined
    gate.hold = new Promise((resolve) => (release = resolve))
    const tessl = await fakeTessl(`echo '${START}' >> '${log}'; /bin/sleep 0.3`)
    let ended = false
    let lateStarts = 0
    try {
      await runTesslUpdate({
        tessl,
        env: { PATH: '/usr/bin' },
        cwd: tmp,
        logFile: log,
        pollMs: 50,
        onStart: () => {
          if (ended) lateStarts += 1
        }
      })
      ended = true
    } finally {
      gate.hold = null
      release()
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(lateStarts).toBe(0)
  })

  it('starts from a missing log', async () => {
    const tessl = await fakeTessl(`echo '${START}' > '${log}'; /bin/sleep 0.5`)
    expect((await update(tessl)).starts).toBe(1)
  })

  it('ignores a start line already in the log', async () => {
    await writeFile(log, `${START}\n`)
    const tessl = await fakeTessl(`echo other >> '${log}'; /bin/sleep 0.5`)
    expect((await update(tessl)).starts).toBe(0)
  })

  it('reads a log that shrank', async () => {
    await writeFile(log, 'x'.repeat(200))
    const tessl = await fakeTessl(`echo '${START}' > '${log}'; /bin/sleep 0.5`)
    expect((await update(tessl)).starts).toBe(1)
  })

  it('passes the env through', async () => {
    const out = join(tmp, 'env')
    const tessl = await fakeTessl(`echo "$TESSL_AUTO_UPDATE_INTERVAL_MINUTES" > '${out}'`)
    await runTesslUpdate({
      tessl,
      env: updateEnv({ PATH: '/usr/bin', TESSL_AUTO_UPDATE_INTERVAL_MINUTES: '0' }, {}),
      cwd: tmp,
      logFile: log,
      onStart: () => undefined
    })
    expect(await readFile(out, 'utf8')).toBe('\n')
  })

  it('runs tessl whoami', async () => {
    const out = join(tmp, 'args')
    const tessl = await fakeTessl(`echo "$*" > '${out}'`)
    await update(tessl)
    expect(await readFile(out, 'utf8')).toBe('whoami\n')
  })
})
