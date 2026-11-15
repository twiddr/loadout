import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { run } from '../src/main/process'

const env = process.env

describe('run', () => {
  it('captures output, exit code and lines', async () => {
    const lines: [string, string][] = []
    const result = await run('/bin/sh', ['-c', 'echo a; echo b 1>&2; exit 3'], {
      env,
      onLine: (stream, line) => lines.push([stream, line])
    })
    expect(result.code).toBe(3)
    expect(result.stdout).toBe('a\n')
    expect(lines).toContainEqual(['stdout', 'a'])
    expect(lines).toContainEqual(['stderr', 'b'])
  })

  it('reports a spawn failure without throwing', async () => {
    const lines: [string, string][] = []
    const result = await run('/nonexistent/x', [], {
      env,
      onLine: (stream, line) => lines.push([stream, line])
    })
    expect(result.code).toBeNull()
    expect(result.cancelled).toBe(false)
    expect(result.timedOut).toBe(false)
    expect(result.stderr).toContain('ENOENT')
    // The log shows why the command did not start.
    expect(lines).toEqual([['stderr', result.stderr]])
  })

  async function grandchildGone(pidFile: string): Promise<boolean> {
    const pid = Number((await readFile(pidFile, 'utf8')).trim())
    for (let i = 0; i < 20; i++) {
      try {
        process.kill(pid, 0)
      } catch {
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return false
  }

  const withGrandchild = (pidFile: string): string[] => [
    '-c',
    `/bin/sleep 30 & echo $! > ${pidFile}; wait`
  ]

  it('stops a run and its grandchild at the deadline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loadout-process-'))
    try {
      const pidFile = join(dir, 'pid')
      const started = Date.now()
      const result = await run('/bin/sh', withGrandchild(pidFile), { env, deadlineMs: 300 })
      expect(result.timedOut).toBe(true)
      expect(result.code).toBeNull()
      expect(Date.now() - started).toBeLessThan(3000)
      expect(await grandchildGone(pidFile)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('stops a run and its grandchild on abort', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loadout-process-'))
    try {
      const pidFile = join(dir, 'pid')
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 300)
      const started = Date.now()
      const result = await run('/bin/sh', withGrandchild(pidFile), {
        env,
        signal: controller.signal
      })
      expect(result.cancelled).toBe(true)
      expect(result.code).toBeNull()
      expect(Date.now() - started).toBeLessThan(3000)
      expect(await grandchildGone(pidFile)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('truncates output past 4 MB without killing the run', async () => {
    const result = await run('/bin/sh', ['-c', 'head -c 5000000 /dev/zero | tr "\\0" x'], { env })
    expect(result.code).toBe(0)
    expect(result.timedOut).toBe(false)
    expect(result.stdout.length).toBe(4 * 1024 * 1024)
    expect(result.truncated).toBe(true)
  })

  it('does not flag output under the caps as truncated', async () => {
    const result = await run('/bin/sh', ['-c', 'echo a'], { env })
    expect(result.truncated).toBe(false)
  })
})
