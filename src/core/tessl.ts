export interface PluginRef {
  workspace: string
  plugin: string
}

export type Bump = 'patch' | 'minor' | 'major'

export const PLUGIN_INPUT_MESSAGE = 'Enter a Tessl plugin as workspace/plugin.'
export const TESSL_MISSING = 'tessl not found. Install it, then press Refresh.'
export const WORKSPACE_MISSING = 'Set the Tessl workspace first in Settings.'

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Trimmed input; exactly two '/'-separated segments, each matching ^[A-Za-z0-9][A-Za-z0-9._-]*$; returned lower-cased. Null otherwise. */
export function parsePluginRef(input: string): PluginRef | null {
  const parts = input.trim().split('/')
  if (parts.length !== 2 || !SEGMENT.test(parts[0]) || !SEGMENT.test(parts[1])) return null
  return { workspace: parts[0].toLowerCase(), plugin: parts[1].toLowerCase() }
}

function parseObject(text: string): Record<string, unknown> | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null
}

export interface Manifest extends PluginRef {
  version: string
  private: boolean | null
}

/** `.tessl-plugin/plugin.json` text → the manifest, or null. */
export function parseManifest(text: string): Manifest | null {
  const raw = parseObject(text)
  const ref = typeof raw?.name === 'string' ? parsePluginRef(raw.name) : null
  if (!raw || !ref || typeof raw.version !== 'string' || raw.version === '') return null
  return {
    ...ref,
    version: raw.version,
    private: typeof raw.private === 'boolean' ? raw.private : null
  }
}

/** `https://tessl.io/registry/<workspace>/<plugin>`; the one place the URL is built. */
export function registryUrl(ref: PluginRef): string {
  return `https://tessl.io/registry/${ref.workspace}/${ref.plugin}`
}

/** The SHARE message of the spec. */
export function shareMessage(skill: string, manifest: Manifest): string {
  const name = `${manifest.workspace}/${manifest.plugin}`
  return (
    `${skill} is on the Tessl Registry:\n${registryUrl(manifest)}\n\n` +
    `In Loadout: Recruit skill → Registry → ${name}\n` +
    `Without Loadout: tessl install ${name}\n` +
    (manifest.private === true
      ? `\nIt is private: you need a Tessl account in the ${manifest.workspace} workspace.\n`
      : '')
  )
}

/** Display name from `tessl whoami --json`: user.username, else name, email, id; 'logged in' when none; null when not authenticated or not JSON. */
export function parseWhoami(text: string): string | null {
  const obj = parseObject(text)
  if (obj === null || obj.authenticated !== true) return null
  const user = obj.user as Record<string, unknown> | null | undefined
  for (const key of ['username', 'name', 'email', 'id']) {
    const value = user?.[key]
    if (typeof value === 'string' && value) return value
  }
  return 'logged in'
}

export interface Workspace {
  id: string
  name: string
}

/** The workspaces in `tessl workspace list --json` (`{ workspaces: [{ id, name }] }`); null when not that shape. A row without both strings is left out. */
export function parseWorkspaces(text: string): Workspace[] | null {
  const list = parseObject(text)?.workspaces
  if (!Array.isArray(list)) return null
  const found: Workspace[] = []
  for (const item of list) {
    const row = item as Record<string, unknown> | null
    const id = row?.id
    const name = row?.name
    if (typeof id === 'string' && id !== '' && typeof name === 'string' && name !== '') {
      found.push({ id, name })
    }
  }
  return found
}

export interface RegistryPlugin extends PluginRef {
  /** `latestVersion`; null while Tessl still moderates the first version. */
  version: string | null
  hasSkills: boolean
}

/** `tessl search --json --workspace <id> <name>`: the search ranks by the query, and every plugin's fullName starts with the workspace name, so that name as the query finds them all (the registry caps a search at about 20 rows). */
export function searchArgs(workspace: Workspace): string[] {
  return ['search', '--json', '--workspace', workspace.id, workspace.name]
}

/** The `tile` rows of `tessl search --json` (`{ results: [{ type: 'tile', workspaceName, tileName, … }] }`), sorted by plugin; `tile-skill` rows are skipped. Null when not that shape. */
export function parseRegistryPlugins(text: string): RegistryPlugin[] | null {
  const list = parseObject(text)?.results
  if (!Array.isArray(list)) return null
  const found: RegistryPlugin[] = []
  for (const item of list) {
    const row = item as Record<string, unknown> | null
    if (row?.type !== 'tile') continue
    const workspace = row.workspaceName
    const plugin = row.tileName
    if (typeof workspace !== 'string' || typeof plugin !== 'string') continue
    const content = row.content as Record<string, unknown> | null | undefined
    found.push({
      workspace,
      plugin,
      version: typeof row.latestVersion === 'string' ? row.latestVersion : null,
      hasSkills: content?.hasSkills === true
    })
  }
  return found.sort((a, b) => a.plugin.localeCompare(b.plugin))
}

/** review.reviewScore when stdout is JSON and it is a finite number; else null. `review fix` output has no review. */
export function parseReviewScore(stdout: string): number | null {
  const review = parseObject(stdout)?.review as Record<string, unknown> | null | undefined
  const score = review?.reviewScore
  return typeof score === 'number' && Number.isFinite(score) ? score : null
}

export interface ReviewDimension {
  name: string
  score: number
  reasoning: string
}

export interface ReviewJudge {
  /** `description` or `content`. */
  id: string
  /** normalizedScore × 100, rounded. */
  percent: number | null
  /** The judge's weight in the score, as a rounded percent. */
  weight: number | null
  assessment: string | null
  suggestions: string[]
  dimensions: ReviewDimension[]
}

export interface ReviewCheck {
  name: string
  status: string
  message: string
}

export interface ReviewReport {
  plugin: string | null
  score: number | null
  /** Description first, then content; a missing judge is left out. */
  judges: ReviewJudge[]
  checks: ReviewCheck[]
}

type Json = Record<string, unknown>

function obj(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** The parsed `tessl review run --json` output as a report; parts with another shape are left out. Null for a non-object or one with no judge and no check. */
export function parseReviewReport(tessl: unknown): ReviewReport | null {
  const root = obj(tessl)
  if (root === null) return null
  const weights = new Map<string, number>()
  const components = obj(root.scoring)?.components
  for (const c of Array.isArray(components) ? components : []) {
    const id = str(obj(c)?.id)
    const weight = num(obj(c)?.weight)
    if (id !== null && weight !== null) weights.set(id, Math.round(weight * 100))
  }
  const judges: ReviewJudge[] = []
  for (const id of ['description', 'content']) {
    const judge = obj(obj(root.judges)?.[id])
    if (judge === null) continue
    const evaluation = obj(judge.evaluation)
    const normalized = num(judge.normalizedScore)
    const dimensions: ReviewDimension[] = []
    for (const [name, value] of Object.entries(obj(evaluation?.scores) ?? {})) {
      const score = num(obj(value)?.score)
      if (score !== null)
        dimensions.push({ name, score, reasoning: str(obj(value)?.reasoning) ?? '' })
    }
    judges.push({
      id,
      percent: normalized === null ? null : Math.round(normalized * 100),
      weight: weights.get(id) ?? null,
      assessment: str(evaluation?.overall_assessment),
      suggestions: strings(evaluation?.suggestions),
      dimensions
    })
  }
  const list = obj(root.validation)?.checks
  const checks: ReviewCheck[] = []
  for (const c of Array.isArray(list) ? list : []) {
    const name = str(obj(c)?.name)
    const status = str(obj(c)?.status)
    if (name !== null && status !== null)
      checks.push({ name, status, message: str(obj(c)?.message) ?? '' })
  }
  // No judge and no check: not the shape this parser knows, so the page says it cannot read it.
  if (judges.length === 0 && checks.length === 0) return null
  return {
    plugin: str(root['review-plugin']),
    score: num(obj(root.review)?.reviewScore),
    judges,
    checks
  }
}

export function installArgs(ref: PluginRef): string[] {
  return [
    'install',
    '--global',
    '--agent',
    'tessl-agent',
    '--yes',
    `${ref.workspace}/${ref.plugin}`
  ]
}

export function reviewArgs(target: string, workspace: string): string[] {
  return ['review', 'run', target, '--workspace', workspace, '--json']
}

export function fixArgs(target: string, workspace: string): string[] {
  return [
    'review',
    'fix',
    target,
    '--workspace',
    workspace,
    '--yes',
    '--max-iterations',
    '1',
    '--json'
  ]
}

export function publishArgs(target: string, workspace: string, bump: Bump): string[] {
  return ['skill', 'publish', target, '--workspace', workspace, '--bump', bump]
}

/** Read-only: lists every installed plugin as outdated or up to date. */
export function outdatedArgs(): string[] {
  return ['outdated', '--global', '--json']
}

/** Read-only: `plugin info <workspace>/<plugin>[@<version>] --json`. */
export function pluginInfoArgs(ref: PluginRef, version?: string): string[] {
  const at = version === undefined ? '' : `@${version}`
  return ['plugin', 'info', `${ref.workspace}/${ref.plugin}${at}`, '--json']
}

/** `plugin unpublish --plugin <workspace>/<plugin>@<version>`: removes one version. */
export function unpublishArgs(ref: PluginRef, version: string): string[] {
  return ['plugin', 'unpublish', '--plugin', `${ref.workspace}/${ref.plugin}@${version}`]
}

/** `<M>.<m>.<p>` down to `<M>.<m>.0`; any other shape gives []. */
export function walkVersions(manifestVersion: string): string[] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(manifestVersion)
  if (!m) return []
  const out: string[] = []
  for (let p = Number(m[3]); p >= 0; p--) out.push(`${m[1]}.${m[2]}.${p}`)
  return out
}

/** The sentence of the first stderr line that starts with `✘ `, without it; null when none. */
function errorSentence(stderr: string): string | null {
  const line = stderr.split('\n').find((l) => l.startsWith('✘ '))
  return line ? line.slice(2).trim() : null
}

/** The CHECK sentence for a plugin the registry does not know or the account cannot see. */
export function notOnRegistryMessage(ref: PluginRef): string {
  return `${ref.workspace}/${ref.plugin} is not on the registry, or your Tessl account has no access to it.`
}

/** The registry's answer for one version of a plugin. */
export type VersionLookup =
  | { state: 'exists' }
  | { state: 'absent' }
  | { state: 'gone' }
  | { state: 'failed'; message: string }

/** Reads `plugin info <ref>@<version>` output into a VersionLookup. */
export function readVersionLookup(
  ref: PluginRef,
  version: string,
  code: number | null,
  stderr: string
): VersionLookup {
  const name = `${ref.workspace}/${ref.plugin}@${version}`
  if (code === 0) return { state: 'exists' }
  if (code === null) {
    return { state: 'failed', message: `Could not check ${name} on the registry; see the log.` }
  }
  if (stderr.includes('has no version')) return { state: 'absent' }
  if (stderr.includes('Could not find plugin')) return { state: 'gone' }
  const sentence = errorSentence(stderr)
  if (sentence) {
    return {
      state: 'failed',
      message: `Could not check ${name} on the registry: ${sentence}`
    }
  }
  return {
    state: 'failed',
    message: `Could not check ${name} on the registry (exit ${code}); see the log.`
  }
}

/** The error shown when `plugin unpublish` fails for one version. */
export function unpublishFailure(
  ref: PluginRef,
  version: string,
  code: number | null,
  stderr: string
): string {
  const head = `Unpublish of ${ref.workspace}/${ref.plugin}@${version} failed`
  if (code === null) return `${head}; see the log.`
  const sentence = errorSentence(stderr)
  if (sentence) return `${head}: ${sentence}`
  return `${head} (exit ${code}); see the log.`
}

/** Shown when the walk ends but the registry still lists versions Loadout cannot find. */
export function unpublishLeftMessage(ref: PluginRef, removed: string[]): string {
  const done = removed.length ? removed.join(', ') : 'nothing'
  return `Unpublished ${done}, but ${ref.workspace}/${ref.plugin} still has versions that Loadout cannot find. Finish with the Tessl CLI; see the log.`
}

/** Shown when the job stops part way. */
export function unpublishStoppedMessage(removed: string[]): string {
  return `Unpublish stopped. Removed: ${removed.length ? removed.join(', ') : 'nothing'}.`
}

/** Shown when the job is cancelled while `plugin unpublish` runs: the server can have removed that version. */
export function unpublishStoppedInFlightMessage(
  ref: PluginRef,
  version: string,
  removed: string[]
): string {
  const name = `${ref.workspace}/${ref.plugin}@${version}`
  return `${unpublishStoppedMessage(removed)} ${name} was stopped while it ran and can be gone too; press refresh on the TESSL card to check.`
}

/** Shown when a version is still listed right after its unpublish. */
export function unpublishRepeatMessage(ref: PluginRef, version: string): string {
  return `Tessl still lists ${ref.workspace}/${ref.plugin}@${version} after the unpublish; see the log.`
}

/** The last registry lookup of one plugin. */
export interface RegistryStatus {
  checkedAt: number // ms since the epoch
  /**
   * pending: the registry has no version yet; Tessl is still moderating the new one.
   * archived: the whole plugin is archived, so the registry names no latest version.
   */
  state: 'found' | 'not-found' | 'failed' | 'pending' | 'archived'
  /** found: tile.latestVersion and version.createdAt (ISO); else ''. */
  version: string
  publishedAt: string
  /** found and archived: the chip's tooltip when tile.archived / tile.deprecated is true; else null. */
  archived: string | null
  deprecated: string | null
  /** not-found, failed and pending: the sentence to show. */
  message: string | null
}

function chipTooltip(tile: Json, flag: string, label: string): string | null {
  if (tile[flag] !== true) return null
  const reason = str(tile[`${flag}Reason`])
  return reason
    ? `${label} on the registry: ${reason}`
    : `${label} on the registry; no reason given.`
}

/** The sentence for the pending state; also used for a registry that is older than a Publish. */
export const PENDING_MESSAGE =
  'Tessl is checking the new version; it shows on the registry in a few minutes.'

/**
 * After a Publish: a found registry version older than `publishedVersion` is the pending state
 * (Tessl is still moderating the new version); any other status is returned as it is.
 */
export function pendingAfterPublish(
  status: RegistryStatus,
  publishedVersion: string
): RegistryStatus {
  if (status.state !== 'found' || compareVersions(publishedVersion, status.version) !== 1) {
    return status
  }
  return {
    checkedAt: status.checkedAt,
    state: 'pending',
    version: '',
    publishedAt: '',
    archived: null,
    deprecated: null,
    message: PENDING_MESSAGE
  }
}

/** `code` is null when the run was cancelled, timed out or did not start. */
export function parsePluginInfo(
  ref: PluginRef,
  code: number | null,
  stdout: string,
  stderr: string,
  checkedAt: number
): RegistryStatus {
  const name = `${ref.workspace}/${ref.plugin}`
  const failed = (state: 'not-found' | 'failed', message: string): RegistryStatus => ({
    checkedAt,
    state,
    version: '',
    publishedAt: '',
    archived: null,
    deprecated: null,
    message
  })
  if (code === 0) {
    const raw = parseObject(stdout)
    const tile = obj(raw?.tile)
    // A whole-plugin archive also answers `latestVersion: null` (research memo, probe 12).
    if (tile && tile.latestVersion === null && tile.archived === true) {
      return {
        checkedAt,
        state: 'archived',
        version: '',
        publishedAt: '',
        archived: chipTooltip(tile, 'archived', 'Archived'),
        deprecated: chipTooltip(tile, 'deprecated', 'Deprecated'),
        message: null
      }
    }
    if (tile && tile.latestVersion === null) {
      return {
        checkedAt,
        state: 'pending',
        version: '',
        publishedAt: '',
        archived: null,
        deprecated: null,
        message: PENDING_MESSAGE
      }
    }
    const version = str(tile?.latestVersion)
    const publishedAt = str(obj(raw?.version)?.createdAt)
    if (!tile || version === null || publishedAt === null) {
      return failed('failed', `Could not read the registry answer for ${name}; see the log.`)
    }
    return {
      checkedAt,
      state: 'found',
      version,
      publishedAt,
      archived: chipTooltip(tile, 'archived', 'Archived'),
      deprecated: chipTooltip(tile, 'deprecated', 'Deprecated'),
      message: null
    }
  }
  if (code === null) {
    return failed('failed', `Could not check ${name} on the registry; see the log.`)
  }
  if (stderr.includes('Could not find plugin')) {
    return failed('not-found', notOnRegistryMessage(ref))
  }
  const sentence = errorSentence(stderr)
  if (sentence) {
    return failed('failed', `Could not check ${name} on the registry: ${sentence}`)
  }
  return failed('failed', `Could not check ${name} on the registry (exit ${code}); see the log.`)
}

/**
 * Relative paths whose time is more than `toleranceMs` after `manifestMs`, newest first, ties by
 * path. Tessl rewrites the manifest at every publish (ADR 20261111-changed-since-publish).
 */
export function changedSince(
  manifestMs: number,
  files: { rel: string; mtimeMs: number }[],
  toleranceMs = 2000
): string[] {
  return files
    .filter((f) => f.mtimeMs - manifestMs > toleranceMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
    .map((f) => f.rel)
}

/** The `title` of the EDITED row: a first line, at most 20 paths, then how many more. */
export function editedTitle(version: string, files: string[]): string {
  const shown = files.slice(0, 20)
  const more = files.length - shown.length
  return [
    `Changed since publish of ${version}:`,
    ...shown,
    ...(more > 0 ? [`… and ${more} more`] : [])
  ].join('\n')
}

/** The version a `--bump` publish gives a `<n>.<n>.<n>` manifest version; null for another shape. */
export function bumpVersion(version: string, bump: Bump): string | null {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null
  const [major, minor, patch] = version.split('.').map(Number)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/** -1, 0 or 1 for two `<n>.<n>.<n>` versions; null when either is another shape. */
export function compareVersions(a: string, b: string): number | null {
  const shape = /^\d+\.\d+\.\d+$/
  if (!shape.test(a) || !shape.test(b)) return null
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1
  return 0
}
