import { stat } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { agentFolder, type Config } from '../core/config'
import type { Startup } from '../core/ipc'
import { expandHome, type Paths } from '../core/paths'
import { parseWhoami } from '../core/tessl'
import { run } from './process'

export const FALLBACK_DIRS = ['~/.local/bin', '/opt/homebrew/bin', '/usr/local/bin']

/** `LOADOUT_FALLBACK_DIRS`: unset uses the defaults, empty uses none, else colon-separated folders. */
export function fallbackDirsFrom(env: NodeJS.ProcessEnv): string[] {
  const value = env.LOADOUT_FALLBACK_DIRS
  return value === undefined ? FALLBACK_DIRS : value.split(':').filter(Boolean)
}

/** `LOADOUT_RECHECK_MS` (tests only): the gap between the re-checks after a pending Publish; unset or not a positive integer uses 20 s. */
export function recheckMsFrom(env: NodeJS.ProcessEnv): number {
  const value = env.LOADOUT_RECHECK_MS
  const ms = value !== undefined && /^[1-9]\d*$/.test(value) ? Number(value) : 0
  return ms > 0 && ms <= 2_147_483_647 ? ms : 20_000
}

/** Tessl's auto-update interval; `0` turns the update off for that call. */
export const AUTO_UPDATE_OFF = 'TESSL_AUTO_UPDATE_INTERVAL_MINUTES'

/** A tool's version: the first line of `--version`. A non-zero exit, or the deadline (code null), means the tool does not run. */
export async function toolVersion(
  path: string,
  env: NodeJS.ProcessEnv,
  cwd: string
): Promise<string | null> {
  const result = await run(path, ['--version'], { env, cwd, deadlineMs: 5000 })
  return result.code === 0
    ? (result.stdout
        .split('\n')[0]
        ?.trim()
        .replace(/^git version /, '') ?? '')
    : null
}

export interface ResolvedPath {
  path: string
  source: Startup['pathSource']
}

async function shellPath(shell: string, flags: string, inherited: string): Promise<string | null> {
  const result = await run(shell, [flags, 'printf %s "$PATH"'], {
    env: { ...process.env, PATH: inherited },
    deadlineMs: 5000
  })
  if (result.code !== 0) return null
  const last = result.stdout.split('\n').pop()?.trim()
  return last ? last : null
}

/** `$SHELL -ilc 'printf %s "$PATH"'` (last stdout line), 5 s; else `-lc`; else inherited. Then append the fallback folders. */
export async function resolvePath(
  shell: string | undefined,
  inherited: string,
  home: string,
  fallbackDirs: string[] = FALLBACK_DIRS
): Promise<ResolvedPath> {
  const sh = shell || '/bin/zsh'
  let path = await shellPath(sh, '-ilc', inherited)
  let source: Startup['pathSource'] = 'interactive-shell'
  if (path === null) {
    path = await shellPath(sh, '-lc', inherited)
    source = 'login-shell'
  }
  if (path === null) {
    path = inherited
    source = 'inherited'
  }
  const folders = path.split(delimiter).filter(Boolean)
  for (const dir of fallbackDirs) {
    const expanded = expandHome(dir, home)
    if (!folders.includes(expanded)) folders.push(expanded)
  }
  return { path: folders.join(delimiter), source }
}

/** First folder of pathValue holding an executable regular file named `name`; null when none. */
export async function findTool(name: string, pathValue: string): Promise<string | null> {
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, name)
    try {
      const info = await stat(candidate)
      if (info.isFile() && (info.mode & 0o111) !== 0) return candidate
    } catch {
      // Not in this folder.
    }
  }
  return null
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function startupCheck(
  config: Config,
  paths: Paths,
  env: NodeJS.ProcessEnv,
  fallbackDirs: string[] = FALLBACK_DIRS
): Promise<{ startup: Startup; env: NodeJS.ProcessEnv }> {
  const resolved = await resolvePath(env.SHELL, env.PATH ?? '', paths.home, fallbackDirs)
  // A call Loadout can kill must never start a Tessl update; see src/main/tesslupdate.ts.
  const toolEnv = { ...env, PATH: resolved.path, [AUTO_UPDATE_OFF]: '0' }
  // Loadout's own folder, never the folder the app was started from; ensureLoadout made it.
  const cwd = paths.loadout

  // The version calls and `tessl whoami` run side by side; each takes up to a second.
  const names = ['git', 'tessl', ...config.agents.map((agent) => agent.command), 'brew']
  const found = await Promise.all(names.map((name) => findTool(name, resolved.path)))
  const tesslPath = found[names.indexOf('tessl')]
  const whoami = async (): Promise<string | null> => {
    if (!tesslPath) return null
    const result = await run(tesslPath, ['whoami', '--json'], {
      env: toolEnv,
      cwd,
      deadlineMs: 5000
    })
    return result.code === 0 ? parseWhoami(result.stdout) : null
  }
  const [versions, tesslUser] = await Promise.all([
    Promise.all(
      found.map((path, i) =>
        path && names[i] !== 'brew'
          ? toolVersion(path, toolEnv, cwd)
          : Promise.resolve<string | null>('')
      )
    ),
    whoami()
  ])
  const tools: Startup['tools'] = {}
  const notRunning: Startup['notRunning'] = {}
  names.forEach((name, i) => {
    const path = found[i]
    if (name === 'brew') return
    const version = versions[i]
    if (path && version === null) notRunning[name] = path
    tools[name] = path && version !== null ? { path, version } : null
  })

  const folders: Startup['folders'] = {}
  for (const agent of config.agents) {
    folders[agent.id] = await exists(agentFolder(agent, paths))
  }

  return {
    startup: {
      pathSource: resolved.source,
      tools,
      tesslUser,
      folders,
      notRunning,
      homebrew: found[names.indexOf('brew')] !== null,
      mustering: false
    },
    env: toolEnv
  }
}
