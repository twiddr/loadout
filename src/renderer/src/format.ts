import { sourceKey } from '../../core/checks'
import { displayPath } from '../../core/paths'
import { sizeText } from '../../core/size'
import { isCollection, isMap, isScalar, parseDocument, stringify } from 'yaml'
import type { LoadoutView } from '../../core/config'
import type { Pack } from '../../core/packs'
import type {
  Action,
  Entry,
  Lint,
  LogEvent,
  Manifest,
  ManifestState,
  PackRefusal,
  SourceCheck,
  Stopped
} from '../../core/ipc'

export type Filter = 'all' | 'local' | 'github' | 'tessl' | 'stowed'

/** `SK-01` for position 0; three digits above 99. */
export function serial(index: number): string {
  return `SK-${String(index + 1).padStart(2, '0')}`
}

/** `just now`, `<n> min ago`, `<n> hour(s) ago` or `<n> day(s) ago`. */
export function ago(then: number, now: number): string {
  const s = (now - then) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  const hours = Math.floor(s / 3600)
  if (s < 86_400) return `${hours} ${plural(hours, 'hour', 'hours')} ago`
  const days = Math.floor(s / 86_400)
  return `${days} ${plural(days, 'day', 'days')} ago`
}

/** The local date of an ISO time as `YYYY-MM-DD`. */
export function localDate(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** `94/100`, or `reviewed` without a score. */
export function scoreText(score: number | null): string {
  return score === null ? 'reviewed' : `${score}/100`
}

/** The colour class of a review score: `good` from 80, `fair` from 40 to 79, `poor` below 40. */
export function scoreTone(score: number | null): 'good' | 'fair' | 'poor' | null {
  if (score === null) return null
  if (score >= 80) return 'good'
  return score >= 40 ? 'fair' : 'poor'
}

/** `fixed · 2 days ago`, or `fixed` without the age; the card upper-cases it in CSS. */
export function fixLabel(fix: { fixedAt: number }, now: number, withAge: boolean): string {
  return withAge ? `fixed · ${ago(fix.fixedAt, now)}` : 'fixed'
}

/** A row text for an action that still runs (`reviewing…`, `checking…`). */
export function isRunning(text: string): boolean {
  return text.endsWith('…')
}

/** How long a finished row text stays on the card. */
export const RESULT_TTL_MS = 15 * 60_000

/** A row text that sends the reader to the Log (`see the log`, `(see Log)`). */
export function pointsToLog(text: string): boolean {
  return /see the log|\(see log\)/i.test(text)
}

/** The card top line shows an age only when the review score, the fix or the update is alone on it. */
export function showAges(review: boolean, fix: boolean, intel: boolean): boolean {
  return [review, fix, intel].filter(Boolean).length === 1
}

/** A finished row text set at `at` has stayed its 15 min; a running one never expires. */
export function expired(text: string, at: number | undefined, now: number): boolean {
  return !isRunning(text) && at !== undefined && now - at >= RESULT_TTL_MS
}

export type Remote = Extract<Entry['source'], { type: 'github' | 'tessl' }>

/** A clone or a Tessl plugin with its library skills and its last check this session. */
export interface SourceGroup {
  key: string
  source: Remote
  /** `<owner>/<repo>` or `<workspace>/<plugin>`. */
  name: string
  skills: string[]
  check: SourceCheck | undefined
}

/** The `github` and `tessl` sources of the library, by name. */
export function sourceGroups(entries: Entry[], checks: Record<string, SourceCheck>): SourceGroup[] {
  const groups = new Map<string, SourceGroup>()
  for (const entry of entries) {
    const key = sourceKey(entry.source)
    if (key === null || entry.source.type === 'local') continue
    const s = entry.source
    let group = groups.get(key)
    if (!group) {
      const name = s.type === 'github' ? `${s.owner}/${s.repo}` : `${s.workspace}/${s.plugin}`
      group = { key, source: s, name, skills: [], check: checks[key] }
      groups.set(key, group)
    }
    group.skills.push(entry.name)
  }
  return [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/** The path line of a skill: local path with `~`, `owner/repo/subpath`, `workspace/plugin/subpath`. */
export function sourceLine(entry: Entry, home: string): string {
  const s = entry.source
  if (s.type === 'local') return displayPath(s.path, home)
  if (s.type === 'github') return [s.owner, s.repo, s.subpath].filter(Boolean).join('/')
  return [s.workspace, s.plugin, s.subpath].filter(Boolean).join('/')
}

/** Search text (name or path line, case-insensitive) AND the filter chip. */
export function matches(entry: Entry, home: string, search: string, filter: Filter): boolean {
  const text = search.trim().toLowerCase()
  if (
    text &&
    !entry.name.toLowerCase().includes(text) &&
    !sourceLine(entry, home).toLowerCase().includes(text)
  )
    return false
  if (filter === 'all') return true
  if (filter === 'stowed') return entry.enabledFor.length === 0
  return entry.source.type === filter
}

export type GridItem =
  { kind: 'skill'; entry: Entry; index: number } | { kind: 'pack'; pack: Pack; members: Entry[] }

/**
 * The cards of the grid. An open pack shows its members, filtered by search and `all` or `stowed`.
 * The `skills` view, a search and the `stowed` chip give flat skills; otherwise a pack with a member
 * that passes the chip is one item at its first member.
 */
export function gridItems(
  entries: Entry[],
  packs: Pack[],
  home: string,
  view: LoadoutView,
  open: string | null,
  search: string,
  filter: Filter
): GridItem[] {
  const skill = (entry: Entry): GridItem => ({
    kind: 'skill',
    entry,
    index: entries.indexOf(entry)
  })
  if (open !== null) {
    const chip = filter === 'stowed' ? 'stowed' : 'all'
    return entries
      .filter((e) => sourceKey(e.source) === open && matches(e, home, search, chip))
      .map(skill)
  }
  if (view === 'skills' || search.trim() !== '' || filter === 'stowed') {
    return entries.filter((e) => matches(e, home, search, filter)).map(skill)
  }
  const byKey = new Map(packs.map((p) => [p.key, p]))
  const seen = new Set<string>()
  const items: GridItem[] = []
  for (const entry of entries) {
    if (!matches(entry, home, '', filter)) continue
    const key = sourceKey(entry.source)
    const pack = key === null ? undefined : byKey.get(key)
    if (!pack) items.push(skill(entry))
    else if (!seen.has(pack.key)) {
      seen.add(pack.key)
      items.push({
        kind: 'pack',
        pack,
        members: entries.filter((e) => sourceKey(e.source) === pack.key)
      })
    }
  }
  // Each card by the name it shows, so a recruit or remove inside a pack never moves the pack.
  const title = (item: GridItem): string =>
    (item.kind === 'pack' ? item.pack.name : item.entry.name).toLowerCase()
  return items.sort((a, b) => (title(a) < title(b) ? -1 : title(a) > title(b) ? 1 : 0))
}

/** The notice after a pack toggle that refused a skill; null when nothing was refused. */
export function packToggleText(
  r: { changed: string[]; already: string[]; refused: PackRefusal[] },
  on: boolean,
  agentLabel: string
): string | null {
  if (r.refused.length === 0) return null
  const done = r.changed.length + r.already.length
  const total = done + r.refused.length
  const why = r.refused.map((x) => `${x.skill}: ${x.message}`).join('; ')
  return `${done} of ${total} ${on ? 'deployed to' : 'stowed from'} ${agentLabel}; ${why}`
}

/** The notice after a pack Remove that refused a skill; null when nothing was refused. */
export function packRemoveText(
  r: { removed: string[]; refused: PackRefusal[] },
  name: string
): string | null {
  if (r.refused.length === 0) return null
  const total = r.removed.length + r.refused.length
  const why = r.refused.map((x) => `${x.skill}: ${x.message}`).join('; ')
  return `Removed ${r.removed.length} of ${total} skills of ${name}; ${why}`
}

export type Run = {
  runId: number
  action?: Action
  command?: string
  lines: { text: string; stream: 'stdout' | 'stderr' | 'meta' }[]
  /** `undefined` while running, `null` when it ended without an exit code. */
  exit?: number | null
  stopped?: Stopped
}

/** How a run without an exit code ended, as words. */
export function stoppedText(run: Run): string {
  return run.stopped === 'timed-out' ? 'timed out' : (run.stopped ?? 'cancelled')
}

/** A run that exited non-zero, timed out or did not start; a cancelled run is not failed. */
export function isFailed(run: Run): boolean {
  if (run.exit === null) return run.stopped !== 'cancelled'
  return typeof run.exit === 'number' && run.exit !== 0
}

/** The row text after an add, by lint result. */
export function addedText(lint: Lint): string {
  if (lint === 'problems') return 'Added. tessl skill lint reported problems, see the log.'
  if (lint === 'unfinished') return 'Added. tessl skill lint did not finish, see the log.'
  return 'Added'
}

/** A run as plain text for the clipboard: `$ <command>`, every output line, then how it ended. */
export function runText(run: Run): string {
  const lines = run.lines.map((line) => line.text)
  if (run.command !== undefined) lines.unshift(`$ ${run.command}`)
  if (run.exit === null) lines.push(stoppedText(run))
  else if (run.exit !== undefined) lines.push(`exit ${run.exit}`)
  return lines.join('\n') + '\n'
}

/** Drops the leading events whose run id is `maxRuns` or more below the last event's run id. */
export function trimLog(log: LogEvent[], maxRuns: number): void {
  const newest = log.at(-1)?.runId ?? 0
  const drop = log.findIndex((e) => newest - e.runId < maxRuns)
  if (drop > 0) log.splice(0, drop)
}

/** Groups log events into runs, newest first. */
export function runs(log: LogEvent[]): Run[] {
  const byId = new Map<number, Run>()
  for (const e of log) {
    let run = byId.get(e.runId)
    if (!run) {
      run = { runId: e.runId, lines: [] }
      byId.set(e.runId, run)
    }
    if (e.action !== undefined) run.action = e.action
    if (e.command !== undefined) run.command = e.command
    if (e.line !== undefined) run.lines.push({ text: e.line, stream: e.stream ?? 'stdout' })
    if (e.exit !== undefined) run.exit = e.exit
    if (e.stopped !== undefined) run.stopped = e.stopped
  }
  return [...byId.values()].reverse()
}

/** The version number in a `--version` line ("2.1.319 (Claude Code)", "codex-cli 0.163.0"). */
export const versionNumber = (raw: string): string => /\d+(?:\.\d+)+/.exec(raw)?.[0] ?? ''

export type InstallTool = 'git' | 'tessl' | 'claude' | 'codex'

/** The one source for install commands: BOOT CAMP, the SYSTEMS tooltips and the README. */
export const INSTALL_COMMANDS: Record<InstallTool, { brew: string[]; direct: string[] }> = {
  git: { brew: ['brew install git'], direct: ['xcode-select --install'] },
  tessl: {
    brew: ['brew tap tesslio/tap', 'brew trust tesslio/tap', 'brew install tesslio/tap/tessl'],
    direct: ['curl -fsSL https://get.tessl.io | sh']
  },
  claude: {
    brew: ['brew install --cask claude-code'],
    direct: ['curl -fsSL https://claude.ai/install.sh | bash']
  },
  codex: {
    brew: ['brew install --cask codex'],
    direct: ['curl -fsSL https://chatgpt.com/codex/install.sh | sh']
  }
}

export const LOGIN_COMMANDS: Record<'tessl' | 'claude' | 'codex', string> = {
  tessl: 'tessl login',
  claude: 'claude auth login',
  codex: 'codex login'
}

const TOOL_NAMES: Record<InstallTool, string> = {
  git: 'git',
  tessl: 'Tessl',
  claude: 'Claude Code',
  codex: 'Codex'
}

/** How to install each tool Loadout looks for; shown when it is not found. */
export const INSTALL_HINTS: Record<string, string> = Object.fromEntries(
  (Object.keys(INSTALL_COMMANDS) as InstallTool[]).map((tool) => {
    const login = tool === 'git' ? '' : `, then ${LOGIN_COMMANDS[tool]}`
    const direct = INSTALL_COMMANDS[tool].direct.join('; ')
    return [tool, `Install ${TOOL_NAMES[tool]}: ${direct}${login}. Press Refresh afterwards.`]
  })
)

const AGENT_CODES: Record<string, string> = { 'claude-code': 'CC', codex: 'CX' }

/** The short code on a card toggle: the mapped code, else the first two letters of the label. */
export function agentCode(agent: { id: string; label: string }): string {
  return AGENT_CODES[agent.id] ?? agent.label.slice(0, 2).toUpperCase()
}

/**
 * The leading `---` block as `key` and display value pairs, and the rest of the text. The block is
 * read as YAML with the failsafe schema, so every scalar stays as written (`1.0`, `true`) and a block
 * scalar (`>-`, `|`) gives its whole value. A nested map or list shows as its YAML: a flow one
 * (`[a, b]`) on the key line, a block one indented on the lines below its key. A block that is not a
 * valid YAML map falls back to one `key: value` pair per line (quotes and `\r` stripped).
 */
export function splitFrontmatter(text: string): { fields: [string, string][]; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!match) return { fields: [], body: text }
  return { fields: yamlFields(match[1]) ?? lineFields(match[1]), body: text.slice(match[0].length) }
}

function yamlFields(block: string): [string, string][] | null {
  const doc = parseDocument(block, { schema: 'failsafe' })
  if (doc.errors.length > 0 || !isMap(doc.contents)) return null
  return doc.contents.items.map((pair) => {
    if (pair.value === null || isScalar(pair.value)) {
      return [String(pair.key), String(pair.value?.value ?? '').trimEnd()]
    }
    const yaml = stringify(pair.value, { schema: 'failsafe', lineWidth: 0 }).trimEnd()
    if (isCollection(pair.value) && pair.value.flow) return [String(pair.key), yaml]
    return [
      String(pair.key),
      yaml
        .split('\n')
        .map((line) => `\n  ${line}`)
        .join('')
    ]
  })
}

function lineFields(block: string): [string, string][] {
  const fields: [string, string][] = []
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const value = line
      .slice(colon + 1)
      .replace(/\r/g, '')
      .trim()
      .replace(/^(["'])(.*)\1$/, '$2')
    fields.push([line.slice(0, colon).trim(), value])
  }
  return fields
}

export function formatSize(size: { bytes: number; files: number }): string {
  const { bytes, files } = size
  return `${sizeText(bytes)} · ${files === 1 ? '1 file' : `${files} files`}`
}

/** The transient result text after a Publish. */
export function publishedText(manifest: ManifestState, version: string | null): string {
  const note = manifest === 'commit-failed' ? '; manifest commit failed (see Log)' : ''
  return `published${version === null ? '' : ` ${version}`}${note}`
}

/**
 * Who can see a skill after Publish to `workspace`, from the local manifest only (no live check).
 * Without a manifest it gives Tessl's documented default for a new plugin.
 */
export function publishVisibility(
  manifest: Manifest | null,
  workspace: string
): { text: string; isPublic: boolean } {
  if (!manifest) return { text: "private · Tessl's default for a new skill", isPublic: false }
  if (manifest.workspace !== workspace) {
    return { text: `unknown · the manifest is for ${manifest.workspace}`, isPublic: false }
  }
  if (manifest.private === null)
    return { text: 'unknown · the manifest does not say', isPublic: false }
  return manifest.private
    ? { text: 'private · workspace members', isPublic: false }
    : { text: 'public · anyone can see and install it', isPublic: true }
}

export type DiffKind = 'add' | 'del' | 'hunk' | ''
export interface DiffFile {
  path: string
  lines: { line: string; kind: DiffKind }[]
}

/** The path after an `a/` or `b/` prefix; null for `/dev/null`. */
function diffPath(header: string): string | null {
  const path = header.slice(4).replace(/\t.*$/, '')
  return path === '/dev/null' ? null : path.replace(/^[ab]\//, '')
}

/**
 * `git diff` output split per file. A `diff --git` line, or a `--- ` line followed by a `+++ ` line,
 * starts a file; the header lines (`diff --git`, `index`, `---`, `+++`) are left out and give the path.
 */
export function diffFiles(text: string): DiffFile[] {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let body = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('diff --git ')) {
      file = { path: line.split(' b/').at(-1) ?? '', lines: [] }
      files.push(file)
      body = false
      continue
    }
    if (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
      if (!file || body) {
        file = { path: '', lines: [] }
        files.push(file)
        body = false
      }
      file.path = diffPath(lines[i + 1]) ?? diffPath(line) ?? file.path
      i++
      continue
    }
    if (!file) {
      file = { path: '', lines: [] }
      files.push(file)
    }
    if (!body && line.startsWith('index ')) continue
    const kind: DiffKind = line.startsWith('@@')
      ? 'hunk'
      : line.startsWith('+')
        ? 'add'
        : line.startsWith('-')
          ? 'del'
          : ''
    if (kind === 'hunk') body = true
    file.lines.push({ line, kind })
  }
  return files
}
