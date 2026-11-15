import type { Source } from './library'
import type { PluginRef } from './tessl'

/** The last check of one source: a clone or a Tessl plugin. */
export interface SourceCheck {
  /** ms since the epoch */
  checkedAt: number
  state: 'ready' | 'up-to-date' | 'blocked' | 'failed'
  /** github: commits behind; tessl: 0. */
  behind: number
  /** github: the upstream name, e.g. `origin/main`; tessl: ''. */
  upstream: string
  /** github: short commit hashes; tessl: versions. Empty unless ready. */
  from: string
  to: string
  /** github, ready: `HEAD..@{u}`, newest first. */
  commits: { hash: string; subject: string }[]
  /** blocked or failed: the sentence to show. */
  message: string | null
}

/** A check with every field not given empty. */
export function newCheck(
  checkedAt: number,
  state: SourceCheck['state'],
  fields: Partial<SourceCheck> = {}
): SourceCheck {
  return {
    checkedAt,
    state,
    behind: 0,
    upstream: '',
    from: '',
    to: '',
    commits: [],
    message: null,
    ...fields
  }
}

/** `github:<owner>/<repo>`, `tessl:<workspace>/<plugin>`, or null for a `local` source. */
export function sourceKey(source: Source): string | null {
  if (source.type === 'github') return `github:${source.owner}/${source.repo}`
  if (source.type === 'tessl') return `tessl:${source.workspace}/${source.plugin}`
  return null
}

/** `code` is null when the command was cancelled or did not start. */
export function checkFailed(code: number | null, checkedAt: number): SourceCheck {
  const message =
    code === null ? 'Check failed, see the log.' : `Check failed (exit ${code}), see the log.`
  return newCheck(checkedAt, 'failed', { message })
}

interface OutdatedItem {
  name: string
  current: string
  latest: string
}

/** `<workspace>/<plugin>` in lower case and the two versions; null when a field is missing. */
function readItem(raw: unknown): OutdatedItem | null {
  const item = raw as
    | {
        current?: { tile?: { workspaceName?: unknown; tileName?: unknown; version?: unknown } }
        latest?: { version?: unknown }
      }
    | null
    | undefined
  const tile = item?.current?.tile
  const latest = item?.latest?.version
  if (
    typeof tile?.workspaceName !== 'string' ||
    typeof tile.tileName !== 'string' ||
    typeof tile.version !== 'string' ||
    typeof latest !== 'string'
  ) {
    return null
  }
  return {
    name: `${tile.workspaceName}/${tile.tileName}`.toLowerCase(),
    current: tile.version,
    latest
  }
}

/** One check per plugin from `tessl outdated --global --json` stdout, keyed by `sourceKey`. */
export function tesslChecks(
  stdout: string,
  plugins: PluginRef[],
  checkedAt: number
): Record<string, SourceCheck> {
  let parsed: { outdated?: unknown; upToDate?: unknown } | null = null
  try {
    parsed = JSON.parse(stdout) as { outdated?: unknown; upToDate?: unknown } | null
  } catch {
    // Not JSON: every plugin fails below.
  }
  const checks: Record<string, SourceCheck> = {}
  const keys = plugins.map((ref) => `tessl:${ref.workspace}/${ref.plugin}`)
  if (!Array.isArray(parsed?.outdated) || !Array.isArray(parsed.upToDate)) {
    for (const key of keys) checks[key] = checkFailed(null, checkedAt)
    return checks
  }
  const outdated = parsed.outdated.map(readItem)
  const upToDate = parsed.upToDate.map(readItem)
  plugins.forEach((ref, i) => {
    const name = `${ref.workspace}/${ref.plugin}`
    const ready = outdated.find((item) => item?.name === name.toLowerCase())
    if (ready) {
      checks[keys[i]] = newCheck(checkedAt, 'ready', { from: ready.current, to: ready.latest })
    } else if (upToDate.some((item) => item?.name === name.toLowerCase())) {
      checks[keys[i]] = newCheck(checkedAt, 'up-to-date')
    } else {
      checks[keys[i]] = newCheck(checkedAt, 'failed', {
        message: `${name} is missing from the tessl outdated list; see the log.`
      })
    }
  })
  return checks
}
