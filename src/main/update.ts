// The app update in main: can this app replace itself, the download, the checks and the staging.
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { access, constants, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { AppUpdate } from '../core/ipc'
import { BUNDLE_ID, plistString, SWAP_SCRIPT } from '../core/release'
import { run, type RunResult } from './process'
import { downloadRelease } from './release'

const HDIUTIL = '/usr/bin/hdiutil'
const CODESIGN = '/usr/bin/codesign'
const DITTO = '/usr/bin/ditto'
const STEP_DEADLINE_MS = 120_000

/**
 * Deletes an update folder. Electron's `fs` reads the `app.asar` of a staged or old bundle as a
 * folder, and its `rm` stops there with ENOTEMPTY; the asar support is off for this one
 * synchronous call, so no other code runs without it.
 */
function removeFolder(dir: string): void {
  const noAsar = process.noAsar
  process.noAsar = true
  try {
    rmSync(dir, { recursive: true, force: true })
  } finally {
    process.noAsar = noAsar
  }
}

/** The four rules of the spec: a bundle, write access to it and its parent, no read-only disk. */
export async function canReplace(bundle: string | null): Promise<AppUpdate['replace']> {
  if (!bundle) return { ok: false, reason: 'Loadout is not running from an app bundle.' }
  for (const path of [bundle, dirname(bundle)]) {
    try {
      await access(path, constants.W_OK)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EROFS')
        return { ok: false, reason: `${bundle} is on a read-only disk.` }
      return { ok: false, reason: `You cannot write to ${path}.` }
    }
  }
  return { ok: true }
}

/** `<dirname(bundle)>/.loadout-update-<8 hex>`, created. */
export async function newUpdateFolder(bundle: string): Promise<string> {
  const dir = join(dirname(bundle), `.loadout-update-${randomBytes(4).toString('hex')}`)
  await mkdir(dir)
  return dir
}

type Failure = { ok: false; message: string; cancelled: boolean }

async function detachMount(mnt: string, env: NodeJS.ProcessEnv): Promise<void> {
  const plain = await run(HDIUTIL, ['detach', mnt], { env, deadlineMs: STEP_DEADLINE_MS })
  if (plain.code !== 0)
    await run(HDIUTIL, ['detach', '-force', mnt], { env, deadlineMs: STEP_DEADLINE_MS })
}

function lastLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() ?? ''
  )
}

export async function prepareUpdate(options: {
  curl: string
  url: string
  dir: string
  latest: string
  env: NodeJS.ProcessEnv
  signal: AbortSignal
  onProgress: (percent: number | null) => void
  onChecking: () => void
}): Promise<{ ok: true; executable: string } | Failure> {
  const { dir, env, signal, latest } = options
  const mnt = join(dir, 'mnt')
  const dmg = join(dir, 'Loadout.dmg')
  let attached = false

  const step = async (
    tool: string,
    args: string[]
  ): Promise<{ result: RunResult; failure: Failure | null }> => {
    const result = await run(tool, args, { env, deadlineMs: STEP_DEADLINE_MS, signal })
    const failure: Failure | null = result.cancelled
      ? { ok: false, message: 'The update was cancelled.', cancelled: true }
      : result.timedOut
        ? { ok: false, message: `${basename(tool)} timed out.`, cancelled: false }
        : null
    return { result, failure }
  }
  const detach = async (): Promise<void> => {
    await detachMount(mnt, env)
    attached = false
  }
  const fail = (message: string): Failure => ({ ok: false, message, cancelled: false })

  const attempt = async (): Promise<{ ok: true; executable: string } | Failure> => {
    const download = await downloadRelease(options.curl, {
      url: options.url,
      dir,
      env,
      signal,
      onProgress: options.onProgress
    })
    if (!download.ok) return download
    options.onChecking()

    const verify = await step(HDIUTIL, ['verify', dmg])
    if (verify.failure) return verify.failure
    if (verify.result.code !== 0) return fail('the download is damaged (hdiutil verify failed).')

    await mkdir(mnt, { recursive: true })
    const attach = await step(HDIUTIL, [
      'attach',
      '-nobrowse',
      '-readonly',
      '-noautoopen',
      '-noverify',
      '-mountpoint',
      mnt,
      dmg
    ])
    if (attach.failure) return attach.failure
    if (attach.result.code !== 0)
      return fail(`the download could not be opened: ${lastLine(attach.result.stderr)}`)
    attached = true

    const app = join(mnt, 'Loadout.app')
    const signed = await step(CODESIGN, ['--verify', '--deep', '--strict', app])
    if (signed.failure) return signed.failure
    if (signed.result.code !== 0) return fail('the app in the download has a broken signature.')

    const xml = await readFile(join(app, 'Contents', 'Info.plist'), 'utf8').catch(() => '')
    const id = plistString(xml, 'CFBundleIdentifier')
    if (id !== BUNDLE_ID) return fail(`the download is not Loadout (${id ?? 'no bundle id'}).`)
    const version = plistString(xml, 'CFBundleShortVersionString')
    if (version !== latest)
      return fail(`the downloaded app is ${version ?? 'unknown'}, not ${latest}.`)
    const executable = plistString(xml, 'CFBundleExecutable') ?? 'Loadout'

    const staged = join(dir, 'new', 'Loadout.app')
    const copy = await step(DITTO, [app, staged])
    if (copy.failure) return copy.failure
    if (copy.result.code !== 0)
      return fail(`the new version could not be copied: ${lastLine(copy.result.stderr)}`)

    await detach()

    const again = await step(CODESIGN, ['--verify', '--deep', '--strict', staged])
    if (again.failure) return again.failure
    if (again.result.code !== 0) return fail('the app in the download has a broken signature.')
    return { ok: true, executable }
  }

  let outcome: { ok: true; executable: string } | Failure
  try {
    outcome = await attempt()
  } catch (error) {
    outcome = fail((error as Error).message)
  }
  if (!outcome.ok) {
    if (attached) await detach()
    // A folder that cannot be deleted stays for the next start; the failure text must survive.
    try {
      removeFolder(dir)
    } catch {
      // The next start tries again.
    }
  }
  return outcome
}

/**
 * Writes the swap script and starts it detached. Main keeps the pipe open and quits; the script
 * runs when the pipe closes. Throws when the spawn fails, so main does not quit.
 */
export function startSwap(options: {
  dir: string
  bundle: string
  executable: string
  args: string[]
  env: NodeJS.ProcessEnv
}): ChildProcess {
  const { dir, bundle, executable, args, env } = options
  const script = join(dir, 'swap.sh')
  writeFileSync(script, SWAP_SCRIPT)
  mkdirSync(join(dir, 'old'), { recursive: true })
  const child = spawn(
    '/bin/sh',
    [script, bundle, join(dir, 'new', 'Loadout.app'), join(dir, 'old'), executable, ...args],
    { detached: true, stdio: ['pipe', 'ignore', 'ignore'], env }
  )
  child.on('error', () => undefined)
  if (child.pid === undefined) throw new Error('The swap script could not start.')
  child.unref()
  return child
}

/** The next start: report each swap log, then delete every update folder. Never rejects. */
export async function finishUpdate(
  bundle: string
): Promise<{ lines: string[]; failure: string | null }> {
  const lines: string[] = []
  let failure: string | null = null
  const parent = dirname(bundle)
  const names = await readdir(parent).catch(() => [] as string[])
  for (const name of names.filter((n) => n.startsWith('.loadout-update-')).sort()) {
    const dir = join(parent, name)
    try {
      const log = await readFile(join(dir, 'swap.log'), 'utf8').catch(() => '')
      for (const line of log.split('\n').filter((l) => l.trim())) {
        lines.push(`Update: ${line}`)
        if (failure === null && line.startsWith('FAILED'))
          failure = `the restart could not replace the app (${line}).`
      }
      const mnt = join(dir, 'mnt')
      const [inner, outer] = await Promise.all([stat(mnt).catch(() => null), stat(dir)])
      if (inner && inner.dev !== outer.dev) await detachMount(mnt, process.env)
      removeFolder(dir)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? (error as Error).message
      lines.push(`Update: could not delete ${dir} (${code}).`)
    }
  }
  return { lines, failure }
}
