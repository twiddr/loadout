import { spawnSync } from 'node:child_process'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  canReplace,
  finishUpdate,
  newUpdateFolder,
  prepareUpdate,
  startSwap
} from '../src/main/update'
import { plistString } from '../src/core/release'
import { tinyApp, tinyDmg } from './support/tiny-app'

const TIMEOUT = 60_000
const ENV = { PATH: '/usr/bin:/bin' }

let root: string
let server: Server
let base: string
let bundle: string
let parent: string
const dmgs: Record<string, Buffer> = {}
const restore: string[] = []
let mode: 'normal' | 'half' | 'chunked' | 'slow' | '404' = 'normal'
let serve = 'good'

async function fixture(name: string, options: { version: string; id?: string }): Promise<Buffer> {
  const dir = join(root, 'src', name)
  await mkdir(dir, { recursive: true })
  const app = tinyApp(dir, { ...options, marker: join(root, 'marker') })
  const out = join(root, 'dmg', `${name}.dmg`)
  tinyDmg(app, out)
  return readFile(out)
}

function mounts(): string {
  return spawnSync('/usr/bin/hdiutil', ['info'], { encoding: 'utf8' }).stdout
}

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'loadout-update-')))
  await mkdir(join(root, 'dmg'))
  dmgs.good = await fixture('good', { version: '0.1.6' })
  dmgs.other = await fixture('other', { version: '0.1.6', id: 'com.example.other' })
  dmgs.old = await fixture('old', { version: '0.1.5' })

  const bad = join(root, 'src', 'bad')
  await mkdir(bad, { recursive: true })
  const badApp = tinyApp(bad, { version: '0.1.6', marker: join(root, 'marker') })
  await mkdir(join(badApp, 'Contents', 'Resources'))
  await writeFile(join(badApp, 'Contents', 'Resources', 'late.txt'), 'added after signing')
  tinyDmg(badApp, join(root, 'dmg', 'bad.dmg'))
  dmgs.bad = await readFile(join(root, 'dmg', 'bad.dmg'))

  // Change bytes in the compressed data, away from the trailer. The exact middle of this small
  // image is unused space that `hdiutil verify` accepts; a quarter of the way in is data.
  const damaged = Buffer.from(dmgs.good)
  const at = Math.floor(damaged.length / 4)
  for (let i = 0; i < 64; i++) damaged[at + i] ^= 0xff
  dmgs.damaged = damaged

  server = createServer((req, res) => {
    const body = dmgs[serve]
    if (req.url === '/missing') {
      res.writeHead(404).end('no')
    } else if (mode === 'half') {
      res.writeHead(200, { 'content-length': body.length })
      res.write(body.subarray(0, Math.floor(body.length / 2)), () => res.destroy())
    } else if (mode === 'chunked') {
      res.writeHead(200)
      res.end(body)
    } else if (mode === 'slow') {
      res.writeHead(200, { 'content-length': 10_000_000 })
      const timer = setInterval(() => res.write(Buffer.alloc(1024)), 100)
      res.on('close', () => clearInterval(timer))
    } else {
      res.writeHead(200, { 'content-length': body.length })
      res.end(body)
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  parent = join(root, 'My Apps')
  await mkdir(parent)
  bundle = join(parent, 'Loadout.app')
  await mkdir(bundle)
}, 120_000)

afterEach(async () => {
  mode = 'normal'
  serve = 'good'
  for (const path of restore.splice(0)) await chmod(path, 0o755)
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
})

async function prepare(
  path: string,
  options: { latest?: string; signal?: AbortSignal } = {}
): Promise<{
  result: Awaited<ReturnType<typeof prepareUpdate>>
  dir: string
  progress: (number | null)[]
  checking: number
}> {
  const dir = await newUpdateFolder(bundle)
  const progress: (number | null)[] = []
  let checking = 0
  const result = await prepareUpdate({
    curl: '/usr/bin/curl',
    url: `${base}${path}`,
    dir,
    latest: options.latest ?? '0.1.6',
    env: ENV,
    signal: options.signal ?? new AbortController().signal,
    onProgress: (percent) => progress.push(percent),
    onChecking: () => {
      checking++
    }
  })
  return { result, dir, progress, checking }
}

async function expectClean(dir: string): Promise<void> {
  await expect(stat(dir)).rejects.toThrow()
  expect(mounts()).not.toContain(dir)
}

describe('prepareUpdate', () => {
  it(
    'downloads, checks and stages the new bundle',
    async () => {
      const { result, dir, progress, checking } = await prepare('/Loadout.dmg')
      expect(result).toEqual({ ok: true, executable: 'Loadout' })
      expect(progress).toContain(100)
      expect(checking).toBe(1)
      const staged = join(dir, 'new', 'Loadout.app')
      expect(
        spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]).status
      ).toBe(0)
      expect((await stat(join(dir, 'mnt'))).dev).toBe((await stat(dir)).dev)
      expect(mounts()).not.toContain(dir)
      await rm(dir, { recursive: true })
    },
    TIMEOUT
  )

  it(
    'shows no percent without a content-length',
    async () => {
      mode = 'chunked'
      const { result, dir, progress } = await prepare('/Loadout.dmg')
      expect(result.ok).toBe(true)
      expect(progress.every((percent) => percent === null)).toBe(true)
      await rm(dir, { recursive: true })
    },
    TIMEOUT
  )

  it(
    'reports a broken download',
    async () => {
      mode = 'half'
      const broken = await prepare('/Loadout.dmg')
      expect(broken.result).toMatchObject({ ok: false, cancelled: false })
      expect(broken.result.ok === false && broken.result.message).toMatch(/^curl: \(18\)/)
      await expectClean(broken.dir)
      mode = 'normal'
      const missing = await prepare('/missing')
      expect(missing.result).toMatchObject({
        ok: false,
        message: 'curl: (22) The requested URL returned error: 404'
      })
      await expectClean(missing.dir)
    },
    TIMEOUT
  )

  it(
    'fails a damaged DMG at hdiutil verify',
    async () => {
      serve = 'damaged'
      const { result, dir } = await prepare('/Loadout.dmg')
      expect(result).toMatchObject({
        ok: false,
        message: 'the download is damaged (hdiutil verify failed).'
      })
      await expectClean(dir)
    },
    TIMEOUT
  )

  it(
    'fails a broken signature',
    async () => {
      serve = 'bad'
      const { result, dir } = await prepare('/Loadout.dmg')
      expect(result).toMatchObject({
        ok: false,
        message: 'the app in the download has a broken signature.'
      })
      await expectClean(dir)
    },
    TIMEOUT
  )

  it(
    'fails another bundle id',
    async () => {
      serve = 'other'
      const { result, dir } = await prepare('/Loadout.dmg')
      expect(result).toMatchObject({
        ok: false,
        message: 'the download is not Loadout (com.example.other).'
      })
      await expectClean(dir)
    },
    TIMEOUT
  )

  it(
    'fails another version',
    async () => {
      serve = 'old'
      const { result, dir } = await prepare('/Loadout.dmg')
      expect(result).toMatchObject({
        ok: false,
        message: 'the downloaded app is 0.1.5, not 0.1.6.'
      })
      await expectClean(dir)
    },
    TIMEOUT
  )

  it(
    'returns a failure, and cleans up, when a step throws',
    async () => {
      const dir = await newUpdateFolder(bundle)
      await writeFile(join(dir, 'mnt'), 'a file where the mount point must be')
      const result = await prepareUpdate({
        curl: '/usr/bin/curl',
        url: `${base}/Loadout.dmg`,
        dir,
        latest: '0.1.6',
        env: ENV,
        signal: new AbortController().signal,
        onProgress: () => undefined,
        onChecking: () => undefined
      })
      expect(result).toMatchObject({ ok: false, cancelled: false })
      expect(result.ok === false && result.message).toMatch(/EEXIST/)
      await expectClean(dir)
    },
    TIMEOUT
  )

  it(
    'cancels a running download',
    async () => {
      mode = 'slow'
      const abort = new AbortController()
      setTimeout(() => abort.abort(), 300)
      const { result, dir } = await prepare('/Loadout.dmg', { signal: abort.signal })
      expect(result).toMatchObject({ ok: false, cancelled: true })
      await expectClean(dir)
    },
    TIMEOUT
  )
})

describe('canReplace', () => {
  it(
    'allows a writable bundle and parent',
    async () => {
      expect(await canReplace(bundle)).toEqual({ ok: true })
    },
    TIMEOUT
  )

  it('refuses without a bundle', async () => {
    expect(await canReplace(null)).toEqual({
      ok: false,
      reason: 'Loadout is not running from an app bundle.'
    })
  })

  it('names a parent folder that cannot be written', async () => {
    await chmod(parent, 0o555)
    restore.push(parent)
    expect(await canReplace(bundle)).toEqual({
      ok: false,
      reason: `You cannot write to ${parent}.`
    })
  })

  it('names a bundle that cannot be written', async () => {
    await chmod(bundle, 0o555)
    restore.push(bundle)
    expect(await canReplace(bundle)).toEqual({
      ok: false,
      reason: `You cannot write to ${bundle}.`
    })
  })

  it(
    'refuses a bundle on a read-only disk',
    async () => {
      const mnt = join(root, 'ro')
      await mkdir(mnt)
      await copyFile(join(root, 'dmg', 'good.dmg'), join(root, 'ro.dmg'))
      const attach = spawnSync(
        '/usr/bin/hdiutil',
        ['attach', '-nobrowse', '-readonly', '-noverify', '-mountpoint', mnt, join(root, 'ro.dmg')],
        { encoding: 'utf8' }
      )
      expect(attach.status).toBe(0)
      try {
        const inside = join(mnt, 'Loadout.app')
        expect(await canReplace(inside)).toEqual({
          ok: false,
          reason: `${inside} is on a read-only disk.`
        })
      } finally {
        spawnSync('/usr/bin/hdiutil', ['detach', '-force', mnt])
      }
    },
    TIMEOUT
  )
})

async function until(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('timed out waiting')
}

const read = (path: string): Promise<string> => readFile(path, 'utf8').catch(() => '')

async function versionOf(app: string): Promise<string | null> {
  return plistString(await read(join(app, 'Contents', 'Info.plist')), 'CFBundleShortVersionString')
}

async function swapFixture(): Promise<{
  apps: string
  install: string
  dir: string
  marker: string
}> {
  const home = await mkdtemp(join(root, 'swap-'))
  const apps = join(home, 'My Apps')
  await mkdir(apps)
  const marker = join(home, 'marker')
  const install = tinyApp(apps, { version: '0.1.5', name: 'Loadout 2.app', marker })
  const dir = await newUpdateFolder(install)
  tinyApp(join(dir, 'new'), { version: '0.1.6', marker })
  return { apps, install, dir, marker }
}

function swap(
  fixture: { install: string; dir: string },
  env: NodeJS.ProcessEnv = {}
): ReturnType<typeof startSwap> {
  return startSwap({
    dir: fixture.dir,
    bundle: fixture.install,
    executable: 'Loadout',
    args: ['--user-data-dir=/x'],
    env: { ...ENV, ...env }
  })
}

describe('the swap script', () => {
  it(
    'waits for the pipe',
    async () => {
      const f = await swapFixture()
      const child = swap(f)
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(await versionOf(f.install)).toBe('0.1.5')
      expect(await read(join(f.dir, 'swap.log'))).toBe('')
      child.stdin?.end()
      await until(async () => (await read(f.marker)).includes('started'))
    },
    TIMEOUT
  )

  it(
    'swaps the bundle and starts the new app',
    async () => {
      const f = await swapFixture()
      swap(f).stdin?.end()
      await until(async () => (await read(f.marker)).includes('started'))
      expect((await read(join(f.dir, 'swap.log'))).trimEnd().split('\n').pop()).toBe('DONE')
      expect(await versionOf(f.install)).toBe('0.1.6')
      expect(await versionOf(join(f.dir, 'old', 'Loadout 2.app'))).toBe('0.1.5')
      expect(await read(f.marker)).toBe('started 0.1.6 --user-data-dir=/x\n')
    },
    TIMEOUT
  )

  it(
    'puts the old bundle back when the second move fails',
    async () => {
      const f = await swapFixture()
      swap(f, { LOADOUT_UPDATE_FAIL: 'swap' }).stdin?.end()
      await until(async () => (await read(f.marker)).includes('started'))
      const log = await read(join(f.dir, 'swap.log'))
      expect(log).toContain('FAILED move-new')
      expect(log).toContain('RESTORED')
      expect(await versionOf(f.install)).toBe('0.1.5')
      expect(
        spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', f.install]).status
      ).toBe(0)
      expect(await read(f.marker)).toBe('started 0.1.5 --user-data-dir=/x\n')
    },
    TIMEOUT
  )

  it(
    'starts the old app when the first move fails',
    async () => {
      const f = await swapFixture()
      await chmod(f.apps, 0o555)
      restore.push(f.apps)
      swap(f).stdin?.end()
      await until(async () => (await read(f.marker)).includes('started'))
      expect(await read(join(f.dir, 'swap.log'))).toContain('FAILED move-old')
      expect(await versionOf(f.install)).toBe('0.1.5')
      expect(await read(f.marker)).toBe('started 0.1.5 --user-data-dir=/x\n')
    },
    TIMEOUT
  )
})

describe('finishUpdate', () => {
  it(
    'reports each log, finds a failure and deletes the folders',
    async () => {
      const home = await mkdtemp(join(root, 'finish-'))
      const bundleHere = join(home, 'Loadout.app')
      const plant = async (name: string, log: string | null): Promise<string> => {
        const dir = join(home, name)
        await mkdir(join(dir, 'old'), { recursive: true })
        if (log !== null) await writeFile(join(dir, 'swap.log'), log)
        return dir
      }
      const dirs = [
        await plant('.loadout-update-aaaaaaaa', 'DONE\n'),
        await plant('.loadout-update-bbbbbbbb', 'FAILED move-new 1\nRESTORED\n'),
        await plant('.loadout-update-cccccccc', null)
      ]
      const other = await plant('.loadout-other', 'DONE\n')
      expect(await finishUpdate(bundleHere)).toEqual({
        lines: ['Update: DONE', 'Update: FAILED move-new 1', 'Update: RESTORED'],
        failure: 'the restart could not replace the app (FAILED move-new 1).'
      })
      for (const dir of dirs) await expect(stat(dir)).rejects.toThrow()
      expect((await stat(other)).isDirectory()).toBe(true)
      expect(await readdir(home)).toEqual(['.loadout-other'])
    },
    TIMEOUT
  )

  it(
    'names a folder it cannot delete',
    async () => {
      const home = await mkdtemp(join(root, 'finish-'))
      const dir = join(home, '.loadout-update-dddddddd')
      await mkdir(dir)
      await writeFile(join(dir, 'swap.log'), 'DONE\n')
      await chmod(home, 0o555)
      restore.push(home)
      const result = await finishUpdate(join(home, 'Loadout.app'))
      expect(result.failure).toBeNull()
      expect(result.lines[0]).toBe('Update: DONE')
      expect(result.lines[1]).toMatch(
        new RegExp(`^Update: could not delete ${dir} \\(E[A-Z]+\\)\\.$`)
      )
      expect(result.lines).toHaveLength(2)
    },
    TIMEOUT
  )

  it(
    'detaches a leftover mount',
    async () => {
      const home = await mkdtemp(join(root, 'finish-'))
      const dir = join(home, '.loadout-update-eeeeeeee')
      const mnt = join(dir, 'mnt')
      await mkdir(mnt, { recursive: true })
      const attach = spawnSync(
        '/usr/bin/hdiutil',
        [
          'attach',
          '-nobrowse',
          '-readonly',
          '-noverify',
          '-mountpoint',
          mnt,
          join(root, 'dmg', 'good.dmg')
        ],
        { encoding: 'utf8' }
      )
      expect(attach.status).toBe(0)
      expect(mounts()).toContain(dir)
      const result = await finishUpdate(join(home, 'Loadout.app'))
      expect(result.failure).toBeNull()
      expect(mounts()).not.toContain(dir)
      await expect(stat(dir)).rejects.toThrow()
    },
    TIMEOUT
  )
})
