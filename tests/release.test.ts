import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BUNDLE_ID,
  INSTALL_COMMAND,
  LATEST_URL,
  compareVersions,
  contentLength,
  downloadUrl,
  lastNoon,
  mergeAppUpdate,
  newerRelease,
  nextNoon,
  noonDue,
  parseLatest,
  parseVersion,
  plistString,
  releaseNotesUrl
} from '../src/core/release'
import type { AppUpdate } from '../src/core/ipc'
import { tinyApp, tinyDmg } from './support/tiny-app'
import { checkLatest, curlPath } from '../src/main/release'

const TAG = 'https://github.com/twiddr/loadout/releases/tag/v0.1.5'

describe('parseVersion', () => {
  it('reads three numbers', () => {
    expect(parseVersion('0.1.4')).toEqual([0, 1, 4])
    expect(parseVersion('10.0.0')).toEqual([10, 0, 0])
  })
  it.each(['v0.1.4', '0.1', '0.1.4-beta', '01.a.2', ''])('rejects %j', (text) => {
    expect(parseVersion(text)).toBeNull()
  })
})

describe('compareVersions', () => {
  it('orders numerically', () => {
    expect(compareVersions('0.1.9', '0.1.10')).toBeLessThan(0)
    expect(compareVersions('0.1.4', '0.1.4')).toBe(0)
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0)
  })
  it('throws when a side does not parse', () => {
    expect(() => compareVersions('x', '0.1.4')).toThrow(Error)
    expect(() => compareVersions('0.1.4', '')).toThrow(Error)
  })
})

describe('newerRelease', () => {
  it.each([
    ['0.1.4', '0.1.5', '0.1.5'],
    ['0.1.4', '0.1.4', null],
    ['0.1.5', '0.1.4', null],
    ['0.1.9', '0.1.10', '0.1.10'],
    ['0.1.10', '0.2.0', '0.2.0'],
    ['0.1.10', '1.0.0', '1.0.0'],
    ['44.10.2x', '0.1.5', null],
    ['0.1.4', 'latest', null]
  ])('(%s, %s) is %s', (current, latest, expected) => {
    expect(newerRelease(current, latest)).toBe(expected)
  })
})

describe('parseLatest', () => {
  it.each(['', '\n', '\r\n'])('reads a redirect to a tag (suffix %j)', (end) => {
    expect(parseLatest(`302 ${TAG}${end}`)).toEqual({ ok: true, version: '0.1.5' })
  })
  it.each(['301', '303', '307', '308'])('accepts the redirect code %s', (code) => {
    expect(parseLatest(`${code} ${TAG}`)).toEqual({ ok: true, version: '0.1.5' })
  })
  it('refuses a tag URL with code 200', () => {
    expect(parseLatest(`200 ${TAG}`)).toEqual({
      ok: false,
      message: `GitHub did not point at a release tag (${TAG}).`
    })
  })
  it.each([
    [
      '302 https://github.com/twiddr/loadout/releases',
      'https://github.com/twiddr/loadout/releases'
    ],
    [
      '302 https://github.com/twiddr/loadout/releases/tag/latest',
      'https://github.com/twiddr/loadout/releases/tag/latest'
    ],
    [`302 ${TAG}/`, `${TAG}/`],
    [`302 ${TAG}?x=1`, `${TAG}?x=1`],
    [
      '302 https://github.com/twiddr/loadout-dev/releases/tag/v0.1.5',
      'https://github.com/twiddr/loadout-dev/releases/tag/v0.1.5'
    ],
    [
      '302 https://github.com/other/repo/releases/tag/v0.1.5',
      'https://github.com/other/repo/releases/tag/v0.1.5'
    ],
    ['200 ', '200'],
    ['', 'no answer']
  ])('refuses %j', (output, shown) => {
    expect(parseLatest(output)).toEqual({
      ok: false,
      message: `GitHub did not point at a release tag (${shown}).`
    })
  })
})

describe('constants', () => {
  it('keeps INSTALL_COMMAND equal to the README', async () => {
    const readme = await readFile(join(__dirname, '..', 'README.md'), 'utf8')
    expect(readme).toContain(INSTALL_COMMAND)
  })
  it('builds the release notes URL', () => {
    expect(releaseNotesUrl('0.1.5')).toBe(TAG)
  })
})

async function fakeCurl(body: string): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'loadout-release-'))
  const path = join(dir, 'curl')
  await writeFile(path, `#!/bin/sh\n${body}\n`)
  await chmod(path, 0o755)
  return { dir, path }
}

describe('checkLatest', () => {
  const env = { PATH: '' }

  it('runs curl without following the redirect and reads the version', async () => {
    const { dir, path } = await fakeCurl(
      `for a in "$@"; do /bin/echo "$a"; done > "${'$'}0.args"\n/bin/echo '302 ${TAG}'`
    )
    expect(await checkLatest(path, { env, cwd: dir })).toEqual({ ok: true, version: '0.1.5' })
    expect((await readFile(`${path}.args`, 'utf8')).trimEnd().split('\n')).toEqual([
      '-sS',
      '-o',
      '/dev/null',
      '-w',
      '%{http_code} %{redirect_url}',
      '--proto',
      '=https',
      '--max-time',
      '15',
      LATEST_URL
    ])
  })

  it('reports the last stderr line when curl fails', async () => {
    const { dir, path } = await fakeCurl(
      "/bin/echo 'curl: (6) Could not resolve host: github.com' >&2; exit 6"
    )
    expect(await checkLatest(path, { env, cwd: dir })).toEqual({
      ok: false,
      message: 'curl: (6) Could not resolve host: github.com'
    })
  })

  it('names the exit code when stderr is empty', async () => {
    const { dir, path } = await fakeCurl('exit 7')
    expect(await checkLatest(path, { env, cwd: dir })).toEqual({
      ok: false,
      message: 'curl exited with code 7.'
    })
  })

  it('times out and names the real deadline', async () => {
    const { dir, path } = await fakeCurl('/bin/sleep 5')
    expect(await checkLatest(path, { env, cwd: dir, deadlineMs: 200 })).toEqual({
      ok: false,
      message: 'The check timed out after 20 s.'
    })
  })

  it('stops when the signal aborts', async () => {
    const { dir, path } = await fakeCurl('/bin/sleep 5')
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 100)
    expect(await checkLatest(path, { env, cwd: dir, signal: controller.signal })).toEqual({
      ok: false,
      message: 'The check was stopped.'
    })
  })

  it('says when curl did not start', async () => {
    expect(await checkLatest('/nonexistent/curl', { env, cwd: tmpdir() })).toEqual({
      ok: false,
      message: 'curl did not start at /nonexistent/curl.'
    })
  })
})

describe('curlPath', () => {
  it.each([
    [{}, '/usr/bin/curl'],
    [{ LOADOUT_CURL: '' }, '/usr/bin/curl'],
    [{ LOADOUT_CURL: '/x/curl' }, '/x/curl']
  ])('for %j gives %s', (env, expected) => {
    expect(curlPath(env)).toBe(expected)
  })
})

describe('downloadUrl', () => {
  it('names the tagged DMG, never latest', () => {
    expect(downloadUrl('0.1.6')).toBe(
      'https://github.com/twiddr/loadout/releases/download/v0.1.6/Loadout.dmg'
    )
  })
})

describe('BUNDLE_ID', () => {
  it('is the Loadout bundle identifier', () => {
    expect(BUNDLE_ID).toBe('com.twiddr.loadout')
  })
})

describe('contentLength', () => {
  it('reads the header of a 200', () => {
    expect(contentLength('HTTP/2 200\r\ncontent-length: 130627933\r\n\r\n')).toBe(130627933)
  })
  it('reads the last response after a redirect', () => {
    const headers =
      'HTTP/2 302\r\ncontent-length: 0\r\nlocation: https://x\r\n\r\n' +
      'HTTP/2 200\r\nContent-Length: 5\r\n\r\n'
    expect(contentLength(headers)).toBe(5)
  })
  it('gives null without the header', () => {
    expect(contentLength('HTTP/2 200\r\ncontent-type: x\r\n\r\n')).toBeNull()
  })
})

describe('mergeAppUpdate', () => {
  const fresh = (): Omit<AppUpdate, 'latest'> => ({
    replace: { ok: true },
    stage: 'offered',
    percent: null,
    message: null
  })
  const held = (stage: AppUpdate['stage']): AppUpdate => ({
    latest: '0.1.6',
    replace: { ok: true },
    stage,
    percent: 40,
    message: null
  })

  it('creates the update from fresh when there is none', () => {
    expect(mergeAppUpdate(null, '0.1.6', fresh)).toEqual({ latest: '0.1.6', ...fresh() })
  })
  it.each(['downloading', 'checking', 'ready'] as const)('keeps a %s update unchanged', (stage) => {
    const current = held(stage)
    expect(mergeAppUpdate(current, '0.1.7', fresh)).toBe(current)
  })
  it.each(['offered', 'failed'] as const)('replaces latest of a %s update', (stage) => {
    const current: AppUpdate = { ...held(stage), message: stage === 'failed' ? 'boom' : null }
    expect(mergeAppUpdate(current, '0.1.7', fresh)).toEqual({ ...current, latest: '0.1.7' })
  })
})

describe('plistString and the tiny app', () => {
  let home: string
  let app: string
  let dmg: string
  let xml: string

  beforeAll(async () => {
    home = await realpath(await mkdtemp(join(tmpdir(), 'loadout-tiny-')))
    app = tinyApp(join(home), { version: '0.1.6', marker: join(home, 'marker') })
    dmg = tinyDmg(app, join(home, 'Loadout.dmg'))
    xml = await readFile(join(app, 'Contents', 'Info.plist'), 'utf8')
  }, 120_000)

  afterAll(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it('reads the version and the identifier', () => {
    expect(plistString(xml, 'CFBundleShortVersionString')).toBe('0.1.6')
    expect(plistString(xml, 'CFBundleIdentifier')).toBe(BUNDLE_ID)
    expect(plistString(xml, 'CFBundleExecutable')).toBe('Loadout')
  })
  it('gives null for an absent key', () => {
    expect(plistString(xml, 'CFBundleMissing')).toBeNull()
  })
  it('is not fooled by another key between', () => {
    const odd = '<key>A</key><true/><key>B</key><string>wrong</string>'
    expect(plistString(odd, 'A')).toBeNull()
    expect(plistString(odd, 'B')).toBe('wrong')
  })
  it('builds an app that codesign accepts', () => {
    const result = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
    expect(result.status).toBe(0)
  }, 60_000)
  it('builds a DMG that hdiutil verifies', () => {
    const result = spawnSync('/usr/bin/hdiutil', ['verify', dmg])
    expect(result.status).toBe(0)
  }, 60_000)
})

/** A local time in November 2026, so the tests hold in any timezone. */
const at = (d: number, h: number, min = 0, s = 0, ms = 0): Date =>
  new Date(2026, 10, d, h, min, s, ms)

describe('lastNoon', () => {
  it('is today at 12:00 from the afternoon', () => {
    expect(lastNoon(at(14, 15))).toEqual(at(14, 12))
  })
  it('is today at 12:00 at exactly 12:00', () => {
    expect(lastNoon(at(14, 12))).toEqual(at(14, 12))
  })
  it('is yesterday at 12:00 from the morning', () => {
    expect(lastNoon(at(14, 9))).toEqual(at(13, 12))
  })
  it('is yesterday at 12:00 two ms before noon', () => {
    expect(lastNoon(at(14, 11, 59, 59, 998))).toEqual(at(13, 12))
  })
})

describe('nextNoon', () => {
  it('is today at 12:00 from the morning', () => {
    expect(nextNoon(at(14, 8))).toEqual(at(14, 12))
  })
  it('is today at 12:00 two ms before noon', () => {
    expect(nextNoon(at(14, 11, 59, 59, 998))).toEqual(at(14, 12))
  })
  it('is tomorrow at 12:00 at exactly 12:00', () => {
    expect(nextNoon(at(14, 12))).toEqual(at(15, 12))
  })
  it('is tomorrow at 12:00 from the afternoon', () => {
    expect(nextNoon(at(14, 18))).toEqual(at(15, 12))
  })
  it('stays at 12:00 local time across a daylight saving change', () => {
    expect(nextNoon(new Date(2026, 2, 28, 13))).toEqual(new Date(2026, 2, 29, 12))
  })
  it('crosses a month end', () => {
    expect(nextNoon(new Date(2026, 10, 30, 13))).toEqual(new Date(2026, 11, 1, 12))
  })
})

describe('noonDue', () => {
  it('is due at 12:00 after a launch check at 08:00', () => {
    expect(noonDue(at(14, 12), at(14, 8))).toBe(true)
  })
  it('is not due at 12:00 after a launch check at 11:50', () => {
    expect(noonDue(at(14, 12), at(14, 11, 50))).toBe(false)
  })
  it('is due at exactly one hour', () => {
    expect(noonDue(at(14, 12), at(14, 11))).toBe(true)
  })
  it('is due on a wake at 14:00 after a launch check at 08:00', () => {
    expect(noonDue(at(14, 14), at(14, 8))).toBe(true)
  })
  it('is not due on a wake at 14:00 when a check ran after 12:00', () => {
    expect(noonDue(at(14, 14), at(14, 13, 30))).toBe(false)
  })
  it('is due until 17:59 and not from 18:00', () => {
    expect(noonDue(at(14, 17, 59, 59, 999), at(14, 8))).toBe(true)
    expect(noonDue(at(14, 18), at(14, 8))).toBe(false)
  })
  it('is not due on a morning wake', () => {
    expect(noonDue(at(14, 8, 30), at(13, 8, 30))).toBe(false)
  })
  it('is not due on a night wake after a missed 12:00', () => {
    expect(noonDue(at(14, 23), at(14, 8, 30))).toBe(false)
  })
  it('is due once on an afternoon wake three days later', () => {
    expect(noonDue(at(17, 15), at(14, 8))).toBe(true)
  })
  it('is due from 12:00 by the wall clock, not a few ms before', () => {
    expect(noonDue(at(14, 11, 59, 59, 998), at(14, 8))).toBe(false)
    expect(noonDue(at(14, 12), at(14, 8))).toBe(true)
  })
  it('checks at 12:00 each day for a morning launcher who sleeps the Mac every night', () => {
    // [moment, due]; a due moment starts a check, so it becomes the last check.
    const days: [Date, boolean][] = [
      [at(16, 12), true],
      [at(17, 8, 31), false],
      [at(17, 12), true],
      [at(18, 8, 31), false],
      [at(18, 12), true],
      [at(18, 23, 1), false],
      [at(19, 8, 31), false],
      [at(19, 12), true]
    ]
    let last = at(16, 8, 30)
    for (const [moment, due] of days) {
      expect(noonDue(moment, last), moment.toString()).toBe(due)
      if (due) last = moment
    }
  })
})
