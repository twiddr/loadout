import type { SourceCheck } from './checks'
import type { Agent, Appearance, LoadoutView } from './config'
import type { LibraryEntry } from './library'
import type { ToggleRequest } from './planner'
import type { Backup, Preview, Recruited, UnmanagedRow } from './recruit'
import type { Pack } from './packs'
import type { Candidate } from './scan'
import type { Synced } from './synced'
import type {
  Bump,
  Manifest,
  RegistryPlugin,
  RegistryStatus,
  ReviewReport,
  Workspace
} from './tessl'

export type { Candidate } from './scan'
export type { SourceCheck } from './checks'
export type {
  Bump,
  Manifest,
  RegistryPlugin,
  RegistryStatus,
  ReviewReport,
  Workspace
} from './tessl'

export interface Entry extends LibraryEntry {
  enabledFor: string[]
}

export interface Startup {
  pathSource: 'interactive-shell' | 'login-shell' | 'inherited'
  /** Keys: 'git', 'tessl', and each agent command. */
  tools: Record<string, { path: string; version: string } | null>
  tesslUser: string | null
  /** Agent id -> folder exists, for every agent in the config, enabled or not. */
  folders: Record<string, boolean>
  /** Tool -> path, for a tool found on PATH whose `--version` exits non-zero or passes its deadline; its `tools` entry is null. */
  notRunning: Record<string, string>
  /** True when `brew` is on the resolved PATH. */
  homebrew: boolean
  /** True while the tool check runs, after launch and after Refresh; the fields above are empty then. */
  mustering: boolean
}

/** A newer Loadout release a check found, and where its download and replace stand. */
export type AppUpdate = {
  latest: string
  /** Whether this app can replace its own bundle; the reason when not. Fixed for the session. */
  replace: { ok: true } | { ok: false; reason: string }
  stage: 'offered' | 'downloading' | 'checking' | 'ready' | 'failed'
  /** Whole percent while downloading, when the size is known; else null. */
  percent: number | null
  /** The failure text in stage 'failed'; else null. */
  message: string | null
}

export interface State {
  /** Taken when main starts building the state; the page drops a state older than the one it shows. */
  seq: number
  /** For displayPath in the renderer. */
  home: string
  agents: Agent[]
  entries: Entry[]
  unmanaged: UnmanagedRow[]
  /** Originals Loadout moved out of an agent folder, read at each state build. */
  backups: Backup[]
  startup: Startup
  /** The running command line, MUSTER_LINE while the tool check runs, or null. */
  busy: string | null
  /** The default workspace, always one of tesslWorkspaces when set. */
  tesslWorkspace: string
  tesslWorkspaces: string[]
  appearance: Appearance
  loadoutView: LoadoutView
  /** One pack per Link or Registry source with two or more library skills. */
  packs: Pack[]
  /** Last check per source this session; key `github:<owner>/<repo>` or `tessl:<workspace>/<plugin>`. */
  checks: Record<string, SourceCheck>
  /** The saved Tessl review per skill, only when it is current (the folder did not change since). */
  reviews: Record<string, { score: number | null; reviewedAt: number }>
  /** The saved fix per skill (the copy taken before the last Tessl fix). */
  fixes: Record<string, { fixedAt: number; undoable: boolean }>
  /** The Tessl manifest of each local skill whose folder holds a valid one; read at each state build, never saved. */
  manifests: Record<string, Manifest>
  /** Per local skill with a manifest: the files more than 2 s newer than the manifest, newest first. Read at each state build, never saved. */
  edited: Record<string, string[]>
  /** The last registry lookup per plugin this session, keyed by `<workspace>/<plugin>`; never on disk. */
  registry: Record<string, RegistryStatus>
  /** The claude.ai synced skills of the live bucket; null when Loadout cannot name or read it. Read at each state build, never saved. */
  synced: Synced | null
  /** A newer Loadout release a check found this session; never cleared until a restart, never saved. */
  appUpdate: AppUpdate | null
}

/** The Loadout folders Settings can reveal; main maps each key to its own path. */
export const LOADOUT_FOLDERS = ['config', 'library', 'repos', 'tesslPlugins'] as const
export type LoadoutFolder = (typeof LOADOUT_FOLDERS)[number]

/** `busy` while the tool check runs, so every action waits for it like for a running command. */
export const MUSTER_LINE = 'Mustering git, tessl and agents…'

export type FixChange = 'added' | 'changed' | 'removed'

/** One file a Tessl fix changed; a text is null on the side where the file is absent, or when binary. */
export interface FixFile {
  path: string
  change: FixChange
  before: string | null
  after: string | null
  binary: boolean
}

/** The saved fix of a skill (ADR 20261109-fix-undo). */
export interface FixView {
  fixedAt: number
  /** The folder still has the fingerprint taken after the fix. */
  undoable: boolean
  /** The skill folder or the saved copy could not be read; `files` is empty. */
  unreadable: boolean
  files: FixFile[]
}

export interface SkillDetail {
  /** Null when the target or SKILL.md is missing. */
  skillMd: string | null
  files: { name: string; folder: boolean }[]
  size: { bytes: number; files: number } | null
  /** `github` only; null when a query failed. */
  git: { branch: string; commit: string; shallow: boolean } | null
  /** `github` only; null when the query failed. */
  history: { hash: string; date: string; subject: string }[] | null
  /** The saved Tessl review; `report` is null when its JSON has another shape. Null when none. */
  /** The saved fix; null when none. */
  fix: FixView | null
  review: {
    report: ReviewReport | null
    reviewedAt: number
    score: number | null
    stale: boolean
  } | null
  /** The library copy against the synced copy; null when the skill is not also synced. */
  syncedCopy: 'same' | 'differs' | 'unreadable' | null
  /** `tessl` only: the installed plugin's `.tessl-plugin/plugin.json`; null when unreadable. */
  installed: Manifest | null
}

/** A pack member a pack job left as it was, with the reason. */
export interface PackRefusal {
  skill: string
  message: string
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string }

export const INVOKE_CHANNELS = [
  'get-state',
  'refresh',
  'toggle',
  'set-agent-enabled',
  'set-workspaces',
  'list-workspaces',
  'list-plugins',
  'set-appearance',
  'set-loadout-view',
  'toggle-pack',
  'remove-pack',
  'copy-text',
  'open-terminal',
  'reveal-folder',
  'git-work-tree',
  'add-local',
  'scan-github',
  'add-candidates',
  'update',
  'scan-tessl',
  'review',
  'fix',
  'fix-undo',
  'fix-keep',
  'publish',
  'unpublish',
  'remove',
  'relocate',
  'fork',
  'reveal',
  'recruit-preview',
  'choose-folder',
  'recruit',
  'undo-preview',
  'recruit-undo',
  'reveal-backup',
  'skill-detail',
  'check',
  'check-all',
  'check-registry',
  'update-all',
  'skill-diff',
  'cancel',
  'update-download',
  'update-cancel',
  'update-restart'
] as const

export const LISTEN_CHANNELS = ['state', 'log', 'back', 'open-app-update'] as const

/** The skill's manifest in git after a publish. `clean` also covers a folder outside git and a missing git. */
export type ManifestState = 'clean' | 'uncommitted' | 'committed' | 'commit-failed'

export type Action =
  | 'add'
  | 'check'
  | 'update'
  | 'review'
  | 'fix'
  | 'publish'
  | 'unpublish'
  | 'remove'
  | 'fork'
  | 'recruit'
  | 'app-update'

export interface LogEvent {
  runId: number
  action?: Action
  command?: string
  line?: string
  stream?: 'stdout' | 'stderr' | 'meta'
  exit?: number | null
  /** Set with `exit: null`: how the run ended without an exit code. */
  stopped?: Stopped
}

/** `failed`: the command did not start, or a signal ended it. */
export type Stopped = 'cancelled' | 'timed-out' | 'failed'

/** The lint after an add: `ok` also when lint was skipped; `unfinished` when it was cancelled, timed out or did not start. */
export type Lint = 'ok' | 'problems' | 'unfinished'

/** A done fork: `moved` and `failed[].agent` are agent labels; `occurrences` are `<file>:<line>: <text>` lines. */
export interface Forked {
  name: string
  folder: string
  moved: string[]
  failed: { agent: string; message: string }[]
  occurrences: string[]
}

export interface LoadoutApi {
  invoke(channel: 'get-state'): Promise<Result<{ state: State }>>
  invoke(channel: 'refresh'): Promise<Result>
  invoke(channel: 'toggle', payload: ToggleRequest): Promise<Result>
  invoke(channel: 'set-agent-enabled', payload: { agentId: string; on: boolean }): Promise<Result>
  invoke(
    channel: 'set-workspaces',
    payload: { workspaces: string[]; default: string }
  ): Promise<Result>
  invoke(channel: 'list-workspaces'): Promise<Result<{ workspaces: Workspace[] }>>
  invoke(
    channel: 'list-plugins',
    payload: { workspace: Workspace }
  ): Promise<Result<{ plugins: RegistryPlugin[] }>>
  invoke(channel: 'set-appearance', payload: { appearance: Appearance }): Promise<Result>
  invoke(channel: 'set-loadout-view', payload: { view: LoadoutView }): Promise<Result>
  invoke(
    channel: 'toggle-pack',
    payload: { pack: string; agentId: string; on: boolean }
  ): Promise<Result<{ changed: string[]; already: string[]; refused: PackRefusal[] }>>
  invoke(
    channel: 'remove-pack',
    payload: { pack: string }
  ): Promise<Result<{ removed: string[]; refused: PackRefusal[]; clone: string | null }>>
  invoke(channel: 'copy-text', payload: { text: string }): Promise<Result>
  invoke(channel: 'open-terminal'): Promise<Result>
  invoke(channel: 'reveal-folder', payload: { folder: LoadoutFolder }): Promise<Result>
  invoke(channel: 'git-work-tree', payload: { skill: string }): Promise<Result<{ inside: boolean }>>
  invoke(channel: 'add-local'): Promise<Result<{ name: string; lint: Lint } | { cancelled: true }>>
  invoke(
    channel: 'scan-github',
    payload: { repo: string }
  ): Promise<Result<{ root: string; candidates: Candidate[] }>>
  invoke(
    channel: 'add-candidates',
    payload: { root: string; names: string[] }
  ): Promise<Result<{ added: string[]; lint: Record<string, Lint> }>>
  invoke(channel: 'update', payload: { skill: string }): Promise<Result<{ updated: string[] }>>
  invoke(
    channel: 'scan-tessl',
    payload: { plugin: string }
  ): Promise<Result<{ root: string; candidates: Candidate[] }>>
  invoke(
    channel: 'review',
    payload: { skill: string }
  ): Promise<Result<{ score: number | null; saved: boolean }>>
  invoke(channel: 'fix', payload: { skill: string }): Promise<Result<{ changed: boolean }>>
  invoke(channel: 'fix-undo', payload: { skill: string }): Promise<Result>
  invoke(channel: 'fix-keep', payload: { skill: string }): Promise<Result>
  invoke(
    channel: 'publish',
    payload: { skill: string; bump: Bump; workspace?: string; commit?: boolean }
  ): Promise<Result<{ manifest: ManifestState; version: string | null; workspace: string }>>
  invoke(
    channel: 'unpublish',
    payload: { skill: string }
  ): Promise<Result<{ removed: string[]; manifestDeleted: boolean }>>
  /** `clone`: the notice sentence when a clone the Remove left unused stays on disk. */
  invoke(channel: 'remove', payload: { skill: string }): Promise<Result<{ clone: string | null }>>
  invoke(channel: 'relocate', payload: { skill: string }): Promise<Result<{ cancelled?: true }>>
  invoke(
    channel: 'fork',
    payload: { skill: string; name: string }
  ): Promise<Result<{ cancelled: true } | Forked>>
  invoke(channel: 'reveal', payload: { skill: string; root?: boolean }): Promise<Result>
  invoke(
    channel: 'recruit-preview',
    payload: { agentId: string; entry: string; parent?: string }
  ): Promise<Result<Preview>>
  invoke(channel: 'choose-folder'): Promise<Result<{ folder: string | null }>>
  invoke(
    channel: 'recruit',
    payload: { agentId: string; entry: string; parent?: string; shown: string[] }
  ): Promise<Result<Recruited>>
  invoke(
    channel: 'undo-preview',
    payload: { agentId: string; entry: string }
  ): Promise<Result<{ steps: string[]; dangling: boolean }>>
  invoke(
    channel: 'recruit-undo',
    payload: { agentId: string; entry: string }
  ): Promise<Result<{ path: string; off: string | null }>>
  invoke(channel: 'reveal-backup', payload: { agentId: string; entry: string }): Promise<Result>
  invoke(
    channel: 'skill-detail',
    payload: { skill: string }
  ): Promise<Result<{ detail: SkillDetail }>>
  invoke(channel: 'check', payload: { skill: string }): Promise<Result<{ check: SourceCheck }>>
  invoke(channel: 'check-all'): Promise<Result>
  invoke(
    channel: 'check-registry',
    payload: { skill: string }
  ): Promise<Result<{ status: RegistryStatus }>>
  invoke(channel: 'update-all'): Promise<Result<{ updated: string[]; failed: string[] }>>
  invoke(channel: 'skill-diff', payload: { skill: string }): Promise<Result<{ diff: string }>>
  invoke(channel: 'cancel'): Promise<Result>
  invoke(channel: 'update-download'): Promise<Result>
  invoke(channel: 'update-cancel'): Promise<Result>
  invoke(channel: 'update-restart'): Promise<Result>
  on(channel: 'state', handler: (state: State) => void): () => void
  on(channel: 'log', handler: (event: LogEvent) => void): () => void
  /** A back gesture main received: a mouse's Back from Logi Options+ arrives as a swipe. */
  on(channel: 'back', handler: () => void): () => void
  /** A menu check found a newer release, or one is already known: the page opens the update dialog. */
  on(channel: 'open-app-update', handler: () => void): () => void
}
