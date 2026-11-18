// The one `tessl` call per launch that may update Tessl. Tessl updates itself only at the end of a
// command, inside that process, and gives the update 30 s. Loadout kills a call's process group when
// the call ends or passes its deadline, so every other call turns the update off (AUTO_UPDATE_OFF),
// and this call runs long enough for an update to finish.
import { open, stat } from 'node:fs/promises'
import { run, type RunResult } from './process'
import { AUTO_UPDATE_OFF } from './startup'

export const TESSL_UPDATE_DEADLINE_MS = 60_000

/** The line Tessl adds to `auto-update.log` when a real update starts (not a version check). */
const START_LINE = '=== Auto-update started'

/** The tool env with the user's own update interval back, or none when the user has not set one. */
export function updateEnv(
  toolEnv: NodeJS.ProcessEnv,
  userEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const env = { ...toolEnv }
  const value = userEnv[AUTO_UPDATE_OFF]
  if (value === undefined) delete env[AUTO_UPDATE_OFF]
  else env[AUTO_UPDATE_OFF] = value
  return env
}

async function sizeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).size
  } catch {
    return 0
  }
}

/** The text added to `file` after `from` bytes; the whole file when it is now shorter. */
async function addedSince(file: string, from: number): Promise<string> {
  try {
    const handle = await open(file, 'r')
    try {
      const size = (await handle.stat()).size
      const start = size < from ? 0 : from
      const buffer = Buffer.alloc(size - start)
      await handle.read(buffer, 0, buffer.length, start)
      return buffer.toString('utf8')
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

/**
 * Runs `tessl whoami` with the update deadline and no cancel, so a quit leaves it to finish. Calls
 * `onStart` once when `logFile` gains a start line during the run.
 */
export async function runTesslUpdate(options: {
  tessl: string
  env: NodeJS.ProcessEnv
  cwd: string
  logFile: string
  onStart: () => void
  onLine?: (stream: 'stdout' | 'stderr', line: string) => void
  pollMs?: number
}): Promise<RunResult> {
  const { tessl, env, cwd, logFile, onStart, onLine, pollMs = 500 } = options
  const before = await sizeOf(logFile)
  let started = false
  let reading = false
  // Set when the run ends: a poll still reading then must not call onStart after the caller cleared it.
  let done = false
  const poll = async (): Promise<void> => {
    if (started || reading) return
    reading = true
    const added = await addedSince(logFile, before)
    reading = false
    if (!done && added.includes(START_LINE)) {
      started = true
      onStart()
    }
  }
  const timer = setInterval(() => void poll(), pollMs)
  try {
    return await run(tessl, ['whoami'], { env, cwd, deadlineMs: TESSL_UPDATE_DEADLINE_MS, onLine })
  } finally {
    done = true
    clearInterval(timer)
  }
}
