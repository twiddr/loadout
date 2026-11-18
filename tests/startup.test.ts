import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/core/config'
import type { Startup } from '../src/core/ipc'
import { pathsFrom } from '../src/core/paths'
import {
  fallbackDirsFrom,
  findTool,
  recheckMsFrom,
  resolvePath,
  startupCheck,
  toolVersion
} from '../src/main/startup'

let tmp: string
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'loadout-startup-'))
})
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

async function script(name: string, body: string, dir = tmp): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, `#!/bin/sh\n${body}\n`)
  await chmod(path, 0o755)
  return path
}

describe('resolvePath', () => {
  it('uses the interactive shell and appends the fallback folders', async () => {
    const shell = await script(
      'sh1',
      `case "$1" in -ilc) printf 'banner line\\n/fake/bin:/usr/bin';; *) exit 1;; esac`
    )
    const result = await resolvePath(shell, '/usr/bin', '/h')
    expect(result.source).toBe('interactive-shell')
    expect(result.path.startsWith('/fake/bin:/usr/bin')).toBe(true)
    expect(result.path.endsWith('/h/.local/bin:/opt/homebrew/bin:/usr/local/bin')).toBe(true)
  })

  it('falls back to the login shell', async () => {
    const shell = await script('sh2', `case "$1" in -lc) printf '/login/bin';; *) exit 1;; esac`)
    const result = await resolvePath(shell, '/usr/bin', '/h')
    expect(result.source).toBe('login-shell')
    expect(result.path.startsWith('/login/bin')).toBe(true)
  })

  it('falls back to the inherited PATH', async () => {
    const shell = await script('sh3', 'exit 1')
    const result = await resolvePath(shell, '/usr/bin', '/h')
    expect(result.source).toBe('inherited')
    expect(result.path.startsWith('/usr/bin:')).toBe(true)
  })

  it('does not repeat a fallback folder already present', async () => {
    const shell = await script('sh4', 'exit 1')
    const result = await resolvePath(shell, '/opt/homebrew/bin', '/h')
    expect(result.path.split(':').filter((p) => p === '/opt/homebrew/bin')).toHaveLength(1)
  })

  // The interactive attempt hangs and hits its 5 s deadline; the login attempt exits 1.
  it('gives up on a hanging shell at the deadline', async () => {
    const shell = await script('sh5', `case "$1" in -ilc) /bin/sleep 10;; *) exit 1;; esac`)
    const started = Date.now()
    const result = await resolvePath(shell, '/usr/bin', '/h')
    expect(result.source).toBe('inherited')
    expect(Date.now() - started).toBeLessThan(6000)
  }, 10_000)
})

describe('findTool', () => {
  it('finds an executable file and skips a non-executable one', async () => {
    const a = join(tmp, 'a')
    const b = join(tmp, 'b')
    await mkdir(a)
    await mkdir(b)
    await writeFile(join(a, 'git'), 'x')
    expect(await findTool('git', `${a}:${b}`)).toBeNull()
    await script('git', 'true', b)
    expect(await findTool('git', `${a}:${b}`)).toBe(join(b, 'git'))
  })
})

describe('startupCheck', () => {
  async function setup(withTessl: boolean): Promise<{ bin: string; shell: string }> {
    const bin = join(tmp, 'bin')
    await mkdir(bin)
    await script('git', 'echo "git version 2.47.0"', bin)
    await script('claude', 'echo "1.0.0"', bin)
    await script('codex', 'exit 1', bin)
    if (withTessl) {
      await script(
        'tessl',
        `echo "$TESSL_AUTO_UPDATE_INTERVAL_MINUTES" >> "${join(tmp, 'tessl-env')}"; case "$1" in --version) pwd -P > "${join(tmp, 'tessl-cwd')}"; echo 0.119.0;; whoami) echo '{"authenticated":true,"method":"session","user":{"name":"acme-dev"}}';; esac`,
        bin
      )
    }
    const shell = await script('fakesh', `printf '%s' '${bin}'`)
    return { bin, shell }
  }

  it('finds the tools, versions and the tessl user', async () => {
    const { shell } = await setup(true)
    const home = join(tmp, 'home')
    await mkdir(join(home, '.claude', 'skills'), { recursive: true })
    await mkdir(pathsFrom(home).loadout)
    const config = structuredClone(DEFAULT_CONFIG)
    config.agents[0].enabled = true
    config.agents[1].enabled = true
    const { startup, env } = await startupCheck(
      config,
      pathsFrom(home),
      { SHELL: shell, PATH: '/usr/bin' },
      []
    )
    expect(startup.pathSource).toBe('interactive-shell')
    expect(startup.tools.git?.version).toBe('2.47.0')
    expect(startup.tools.tessl?.version).toBe('0.119.0')
    expect(startup.tools.codex).toBeNull()
    expect(startup.notRunning.codex).toBe(join(tmp, 'bin', 'codex'))
    expect(startup.tesslUser).toBe('acme-dev')
    expect(startup.folders).toEqual({ 'claude-code': true, codex: false })
    expect(env.PATH).toContain(join(tmp, 'bin'))
    // The tools run in ~/.loadout, never in the folder the app was started from.
    expect((await readFile(join(tmp, 'tessl-cwd'), 'utf8')).trim()).toBe(
      await realpath(pathsFrom(home).loadout)
    )
  })

  it('reports a missing tessl', async () => {
    const { shell } = await setup(false)
    const { startup } = await startupCheck(
      structuredClone(DEFAULT_CONFIG),
      pathsFrom(join(tmp, 'home')),
      { SHELL: shell, PATH: '/usr/bin' },
      []
    )
    expect(startup.tools.tessl).toBeNull()
    expect(startup.tesslUser).toBeNull()
    expect(startup.folders).toEqual({ 'claude-code': false, codex: false })
  })

  it('turns off the Tessl auto-update for every tool call', async () => {
    const { shell } = await setup(true)
    const home = join(tmp, 'home')
    await mkdir(pathsFrom(home).loadout, { recursive: true })
    const { env } = await startupCheck(
      structuredClone(DEFAULT_CONFIG),
      pathsFrom(home),
      { SHELL: shell, PATH: '/usr/bin', TESSL_AUTO_UPDATE_INTERVAL_MINUTES: '30' },
      []
    )
    expect(env.TESSL_AUTO_UPDATE_INTERVAL_MINUTES).toBe('0')
    const lines = (await readFile(join(tmp, 'tessl-env'), 'utf8')).trim().split('\n')
    expect(lines).toEqual(['0', '0'])
  })

  it('toolVersion reads the first line of --version', async () => {
    const { bin } = await setup(true)
    expect(await toolVersion(join(bin, 'git'), { PATH: '/usr/bin' }, tmp)).toBe('2.47.0')
    const broken = await script('broken', 'exit 1')
    expect(await toolVersion(broken, { PATH: '/usr/bin' }, tmp)).toBeNull()
  })
})

describe('fallbackDirsFrom', () => {
  it('uses the default folders when unset', () => {
    expect(fallbackDirsFrom({})).toEqual(['~/.local/bin', '/opt/homebrew/bin', '/usr/local/bin'])
  })
  it('uses no folder when empty', () => {
    expect(fallbackDirsFrom({ LOADOUT_FALLBACK_DIRS: '' })).toEqual([])
  })
  it('splits a value on colons and drops empty parts', () => {
    expect(fallbackDirsFrom({ LOADOUT_FALLBACK_DIRS: '/a::/b' })).toEqual(['/a', '/b'])
  })
})

describe('recheckMsFrom', () => {
  it('uses 20 s when unset', () => expect(recheckMsFrom({})).toBe(20_000))
  it('uses a positive integer as milliseconds', () => {
    expect(recheckMsFrom({ LOADOUT_RECHECK_MS: '500' })).toBe(500)
  })
  it('accepts the largest timer value', () => {
    expect(recheckMsFrom({ LOADOUT_RECHECK_MS: '2147483647' })).toBe(2_147_483_647)
  })
  it.each(['', '0', '-5', '1.5', 'abc', '2147483648'])('uses 20 s for %j', (value) => {
    expect(recheckMsFrom({ LOADOUT_RECHECK_MS: value })).toBe(20_000)
  })
})

describe('startupCheck facts', () => {
  // Fake bin: git exits 1 on --version; tessl sleeps 6 s; claude fine; brew optional.
  async function facts(withBrew: boolean): Promise<{ startup: Startup; bin: string }> {
    const bin = join(tmp, 'bin')
    await mkdir(bin)
    await script('git', 'exit 1', bin)
    await script('tessl', '/bin/sleep 6', bin)
    await script('claude', 'echo "2.1.0 (Claude Code)"', bin)
    if (withBrew) await script('brew', 'echo Homebrew', bin)
    const shell = await script('fakesh', `printf '%s' '${bin}'`)
    const home = join(tmp, 'home')
    await mkdir(join(home, '.codex', 'skills'), { recursive: true })
    await mkdir(pathsFrom(home).loadout)
    const config = structuredClone(DEFAULT_CONFIG)
    config.agents[0].enabled = true
    config.agents[1].enabled = false
    const { startup } = await startupCheck(
      config,
      pathsFrom(home),
      { SHELL: shell, PATH: '/usr/bin' },
      []
    )
    return { startup, bin }
  }

  it('reports a tool that does not run, Homebrew, and the folder of a disabled agent', async () => {
    const { startup, bin } = await facts(true)
    expect(startup.tools.git).toBeNull()
    expect(startup.notRunning.git).toBe(join(bin, 'git'))
    expect(startup.tools.tessl).toBeNull()
    expect(startup.notRunning.tessl).toBe(join(bin, 'tessl'))
    expect(startup.tools.claude?.version).toBe('2.1.0 (Claude Code)')
    expect(startup.notRunning.claude).toBeUndefined()
    expect(startup.tools.brew).toBeUndefined()
    expect(startup.homebrew).toBe(true)
    expect(startup.folders).toEqual({ 'claude-code': false, codex: true })
  }, 15000)

  it('reports no Homebrew without brew', async () => {
    const { startup } = await facts(false)
    expect(startup.homebrew).toBe(false)
  }, 15000)
})
