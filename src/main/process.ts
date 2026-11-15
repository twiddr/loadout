// One child process: detached, no shell, with a deadline, cancel, output caps and line streaming.
import { spawn } from 'node:child_process'

const MAX_STDOUT_BYTES = 4 * 1024 * 1024
const MAX_STDERR_BYTES = 64 * 1024
const GRACE_MS = 1_500
const DEFAULT_DEADLINE_MS = 600_000

export interface RunOptions {
  /** Must carry the resolved PATH. */
  env: NodeJS.ProcessEnv
  cwd?: string
  deadlineMs?: number
  signal?: AbortSignal
  onLine?: (stream: 'stdout' | 'stderr', line: string) => void
}

export interface RunResult {
  /** Null when the spawn failed, or the run was cancelled or timed out. */
  code: number | null
  stdout: string
  stderr: string
  cancelled: boolean
  timedOut: boolean
  /** True when stdout passed 4 MB or stderr 64 KB; `onLine` still saw every line. */
  truncated: boolean
}

function groupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForGroup(pid: number, ms: number): Promise<void> {
  const end = Date.now() + ms
  while (groupExists(pid) && Date.now() < end) await sleep(25)
}

/** SIGTERM the process group, then SIGKILL after the grace period. */
async function stopGroup(pid: number): Promise<void> {
  if (pid <= 1 || pid === process.pid || !groupExists(pid)) return
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return
  }
  await waitForGroup(pid, GRACE_MS)
  if (groupExists(pid)) {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // The group exited during cleanup.
    }
    await waitForGroup(pid, GRACE_MS)
  }
}

/**
 * Spawns detached, shell: false, stdin closed. Never throws: a spawn failure resolves with code
 * null and the error message in stderr. Output is capped at 4 MB stdout and 64 KB stderr.
 */
export async function run(
  command: string,
  args: string[],
  options: RunOptions
): Promise<RunResult> {
  const { signal, onLine } = options
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS
  if (signal?.aborted)
    return {
      code: null,
      stdout: '',
      stderr: '',
      cancelled: true,
      timedOut: false,
      truncated: false
    }

  let pid: number | undefined
  let closed = false
  let stopping: Promise<void> | undefined
  let cancelled = false
  let timedOut = false
  const out: Buffer[] = []
  const err: Buffer[] = []
  let outBytes = 0
  let errBytes = 0
  let truncated = false
  const carry = { stdout: '', stderr: '' }

  const terminate = (): Promise<void> => {
    if (!stopping && pid && !closed) stopping = stopGroup(pid)
    return stopping ?? Promise.resolve()
  }
  const onAbort = (): void => {
    cancelled = true
    void terminate()
  }
  const timer = setTimeout(() => {
    timedOut = true
    void terminate()
  }, deadlineMs)
  signal?.addEventListener('abort', onAbort, { once: true })

  const feed = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
    if (!onLine) return
    const lines = (carry[stream] + chunk.toString('utf8')).split('\n')
    carry[stream] = lines.pop() ?? ''
    for (const line of lines) onLine(stream, line.replace(/\r$/, ''))
  }

  try {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const outcome = new Promise<{ code: number | null; spawnError: Error | null }>((resolve) => {
      let spawnError: Error | null = null
      child.once('error', (error) => {
        spawnError = error
        // A failed spawn emits no `close` event on some platforms.
        if (!child.pid) resolve({ code: null, spawnError })
      })
      child.once('close', (code) => {
        closed = true
        resolve({ code, spawnError })
      })
    })
    pid = child.pid
    if (pid) {
      child.stdout.on('data', (chunk: Buffer) => {
        const room = Math.max(0, MAX_STDOUT_BYTES - outBytes)
        if (chunk.byteLength > room) truncated = true
        if (room > 0) {
          out.push(chunk.subarray(0, room))
          outBytes += Math.min(room, chunk.byteLength)
        }
        feed('stdout', chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        const room = Math.max(0, MAX_STDERR_BYTES - errBytes)
        if (chunk.byteLength > room) truncated = true
        if (room > 0) {
          err.push(chunk.subarray(0, room))
          errBytes += Math.min(room, chunk.byteLength)
        }
        feed('stderr', chunk)
      })
      if (signal?.aborted) onAbort()
    }

    const result = await outcome
    if (result.spawnError) {
      onLine?.('stderr', result.spawnError.message)
      return {
        code: null,
        stdout: '',
        stderr: result.spawnError.message,
        cancelled: false,
        timedOut: false,
        truncated: false
      }
    }
    if (pid) await stopGroup(pid)
    if (stopping) await stopping
    if (onLine) {
      if (carry.stdout) onLine('stdout', carry.stdout)
      if (carry.stderr) onLine('stderr', carry.stderr)
    }
    return {
      code: cancelled || timedOut ? null : result.code,
      stdout: Buffer.concat(out).toString('utf8'),
      stderr: Buffer.concat(err).toString('utf8'),
      cancelled,
      timedOut,
      truncated
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    if (pid && !closed) await terminate()
  }
}
