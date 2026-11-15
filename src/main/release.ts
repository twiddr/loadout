// The app update check: one `curl` child that reads where `/releases/latest` redirects.
import { stat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LATEST_URL, contentLength, parseLatest, type Latest } from '../core/release'
import { run } from './process'

const DEADLINE_MS = 20_000

/** `LOADOUT_CURL` is test only; e2e points it at a fake so no test reaches GitHub. */
export function curlPath(env: NodeJS.ProcessEnv): string {
  return env.LOADOUT_CURL || '/usr/bin/curl'
}

/** No `-L`: curl reports the redirect and does not follow it. */
export async function checkLatest(
  curl: string,
  options: {
    env: NodeJS.ProcessEnv
    cwd: string
    signal?: AbortSignal
    deadlineMs?: number
  }
): Promise<Latest> {
  const result = await run(
    curl,
    [
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
    ],
    {
      env: options.env,
      cwd: options.cwd,
      deadlineMs: options.deadlineMs ?? DEADLINE_MS,
      signal: options.signal
    }
  )
  if (result.cancelled) return { ok: false, message: 'The check was stopped.' }
  if (result.timedOut) return { ok: false, message: 'The check timed out after 20 s.' }
  if (result.code === null) return { ok: false, message: `curl did not start at ${curl}.` }
  if (result.code !== 0) {
    const last = result.stderr
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .pop()
    return { ok: false, message: last ?? `curl exited with code ${result.code}.` }
  }
  return parseLatest(result.stdout)
}

const DOWNLOAD_DEADLINE_MS = 1_800_000

/**
 * One `curl` child that writes `<dir>/Loadout.dmg`. `run()` splits output on `\n`, and curl's
 * progress bar writes `\r`, so the percent comes from the file size and the header dump instead.
 */
export async function downloadRelease(
  curl: string,
  options: {
    url: string
    dir: string
    env: NodeJS.ProcessEnv
    signal: AbortSignal
    deadlineMs?: number
    onProgress: (percent: number | null) => void
  }
): Promise<{ ok: true } | { ok: false; message: string; cancelled: boolean }> {
  const { url, dir } = options
  const file = join(dir, 'Loadout.dmg')
  const deadlineMs = options.deadlineMs ?? DOWNLOAD_DEADLINE_MS
  let last: number | null | undefined
  let reading = false
  const tick = async (): Promise<void> => {
    if (reading) return
    reading = true
    try {
      const total = contentLength(await readFile(join(dir, 'headers'), 'utf8').catch(() => ''))
      const size = (await stat(file).catch(() => null))?.size ?? 0
      const percent = total ? Math.min(100, Math.floor((size / total) * 100)) : null
      if (percent !== last) {
        last = percent
        options.onProgress(percent)
      }
    } finally {
      reading = false
    }
  }
  const timer = setInterval(() => void tick(), 500)
  try {
    const scheme = url.slice(0, url.indexOf(':'))
    const result = await run(
      curl,
      [
        '-fsSL',
        '--proto',
        `=${scheme}`,
        '--proto-redir',
        '=https',
        '--connect-timeout',
        '15',
        '--speed-limit',
        '1024',
        '--speed-time',
        '60',
        '-D',
        join(dir, 'headers'),
        '-o',
        file,
        url
      ],
      { env: options.env, deadlineMs, signal: options.signal }
    )
    if (result.cancelled)
      return { ok: false, message: 'The update was cancelled.', cancelled: true }
    if (result.timedOut)
      return { ok: false, message: 'the download timed out after 30 min.', cancelled: false }
    if (result.code === null)
      return { ok: false, message: `curl did not start at ${curl}.`, cancelled: false }
    if (result.code !== 0) {
      const line = result.stderr
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
        .pop()
      return {
        ok: false,
        message: line ?? `curl exited with code ${result.code}.`,
        cancelled: false
      }
    }
    await tick()
    return { ok: true }
  } finally {
    clearInterval(timer)
  }
}
