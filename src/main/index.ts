import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  powerMonitor,
  screen,
  shell
} from 'electron'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, realpath, rm, rmdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import {
  APPEARANCES,
  LOADOUT_VIEWS,
  readConfig,
  writeConfig,
  type Appearance,
  type Config,
  type LoadoutView
} from '../core/config'
import { readSynced } from '../core/bucket'
import {
  downloadUrl,
  mergeAppUpdate,
  newerRelease,
  nextNoon,
  noonDue,
  type Latest
} from '../core/release'
import { checkFailed, newCheck, sourceKey, tesslChecks, type SourceCheck } from '../core/checks'
import {
  LOADOUT_FOLDERS,
  MUSTER_LINE,
  type LoadoutFolder,
  type Action,
  type AppUpdate,
  type Entry,
  type Lint,
  type ManifestState,
  type LogEvent,
  type Result,
  type SkillDetail,
  type State
} from '../core/ipc'
import {
  aheadBehindArgs,
  cloneKeepReason,
  localCommitsArgs,
  localFilesArgs,
  toplevelArgs,
  branchArgs,
  cloneArgs,
  diffArgs,
  dirtyMessage,
  divergedMessage,
  fetchArgs,
  githubUrl,
  headArgs,
  historyArgs,
  incomingArgs,
  MANIFEST,
  manifestAddArgs,
  manifestCommitArgs,
  manifestStatusArgs,
  manifestUncommitted,
  publishCommitMessage,
  parseAheadBehind,
  parseCommits,
  parseHistory,
  parsePorcelain,
  parseRepo,
  pullArgs,
  REPO_INPUT_MESSAGE,
  shallowArgs,
  statusArgs,
  upstreamArgs
} from '../core/git'
import { classifyTarget, readLibrary } from '../core/library'
import { derivePacks } from '../core/packs'
import { displayPath, pathsFrom } from '../core/paths'
import { planToggle, type ToggleRequest } from '../core/planner'
import { scanSkills } from '../core/scan'
import { insideGitWorkTree, readSkillFolder } from '../core/skill'
import {
  fixArgs,
  installArgs,
  outdatedArgs,
  parseManifest,
  parsePluginInfo,
  pendingAfterPublish,
  parsePluginRef,
  parseReviewReport,
  parseReviewScore,
  PLUGIN_INPUT_MESSAGE,
  pluginInfoArgs,
  publishArgs,
  readVersionLookup,
  reviewArgs,
  unpublishArgs,
  unpublishFailure,
  unpublishLeftMessage,
  unpublishRepeatMessage,
  unpublishStoppedInFlightMessage,
  unpublishStoppedMessage,
  notOnRegistryMessage,
  walkVersions,
  TESSL_MISSING,
  parseRegistryPlugins,
  parseWorkspaces,
  searchArgs,
  WORKSPACE_MISSING,
  type Bump,
  type Manifest,
  type PluginRef,
  type RegistryStatus,
  type Workspace
} from '../core/tessl'
import {
  addLocal,
  applyOps,
  deployAdded,
  ensureLoadout,
  linkCandidates,
  listLinks,
  relocateEntry,
  removeEntry,
  removeInstallLinks,
  removePack,
  snapshot,
  togglePack
} from './disk'
import { coalesce, latestOnly } from './coalesce'
import { checkFork, forkEntry } from './fork'
import { currentFixes, deleteFix, finishFix, readFix, saveBefore, undoFix } from './fixes'
import { run, type RunResult } from './process'
import { checkLatest, curlPath } from './release'
import {
  candidateDetail,
  listBackups,
  previewRecruit,
  previewUndo,
  recruitRows,
  runRecruit,
  runUndo
} from './recruit'
import {
  compareCopies,
  currentReviews,
  deleteReview,
  editedFiles,
  fingerprint,
  hashSkill,
  readReview,
  readSkill,
  reviewFromStdout,
  saveReview,
  savedScore,
  skillTexts
} from './reviews'
import { fallbackDirsFrom, recheckMsFrom, startupCheck, toolVersion } from './startup'
import { runTesslUpdate, updateEnv } from './tesslupdate'
import { canReplace, finishUpdate, newUpdateFolder, prepareUpdate, startSwap } from './update'

const paths = pathsFrom(homedir())
// The e2e tests launch Loadout many times: in the background it never takes focus from other apps.
const BACKGROUND = process.env.LOADOUT_TEST_BACKGROUND === '1'
if (BACKGROUND) app.setActivationPolicy('accessory')

let config: Config
/** The tail of the config changes in flight: each waits for the one before it. */
let configTail: Promise<unknown> = Promise.resolve()

/** Runs `work` after every config change started before it, so no change reads a config another is about to replace. */
function inConfigOrder<T>(work: () => Promise<T>): Promise<T> {
  const done = configTail.then(work)
  configTail = done.catch(() => undefined)
  return done
}

/** Saves `edit` of the latest config, one change at a time, then sends the new state. */
async function changeConfig(edit: (current: Config) => Config): Promise<void> {
  await inConfigOrder(async () => {
    const next = edit(config)
    await writeConfig(paths, next)
    config = next
  })
  await pushState()
}
let env: NodeJS.ProcessEnv = process.env
/** Empty until the tool check ends; the window opens before it. */
let startup: State['startup'] = {
  pathSource: 'inherited',
  tools: {},
  tesslUser: null,
  folders: {},
  notRunning: {},
  homebrew: false,
  mustering: true
}
let busy: string | null = null
let abort: AbortController | null = null
let runId = 0
let window: BrowserWindow | null = null
/** The job that runs (Check, Update, Check all, Update all or Publish): `busy` stays set between its commands. */
let job: { cancelled: boolean; skipped: number } | null = null
/** The busy-channel handlers still running; quitting waits for them, so their cleanup runs. */
const running = new Set<Promise<unknown>>()
/** Set once quitting starts: no new command runs after it. */
let quitting = false
/** Last check per source, for this session only. */
const checks: Record<string, SourceCheck> = {}
/** Last registry lookup per plugin (`<workspace>/<plugin>`), for this session only. */
const registry: Record<string, RegistryStatus> = {}
/**
 * Follow-ups after a pending Publish, per plugin (`<workspace>/<plugin>`): the published version and
 * the timers of the re-checks still to run. A follow-up outlives its re-checks: it closes at the first
 * answer that is not pending, at a new Publish of the plugin, or at a restart.
 */
const followUps = new Map<string, { ref: Manifest; timers: NodeJS.Timeout[] }>()
/** True while the launch's Tessl update call runs and Tessl has started a real update. */
let tesslUpdating = false
/** A newer release a check found; never cleared during the session, never saved. */
let appUpdate: State['appUpdate'] = null
/** The app update check in flight: a second request joins it. Outside `busy` and `running`. */
let appCheck: Promise<Latest> | null = null
/** Aborted by `before-quit`, so a check in flight never delays a quit. */
const appCheckAbort = new AbortController()
/** The update job: renewed per DOWNLOAD, aborted by CANCEL and by `before-quit`. */
let updateAbort = new AbortController()
/** The folder and executable of the staged update, from stage `ready` on. */
let staged: { dir: string; executable: string } | null = null
/** A failed swap the next start found; the first `appUpdate` shows it once. */
let lastFailure: string | null = null
/** Whether this app can replace its own bundle: computed once per session. */
let replaceCheck: Promise<AppUpdate['replace']> | null = null
/** The swap script: held so its stdin pipe stays open until main exits. */
const swaps: ChildProcess[] = []
/** The start of the session's last app update check of any kind; never saved. */
let lastAppCheck: Date | null = null
/** The timer for the next noon check (ADR `20261114-app-update-noon-check`). */
let noonTimer: NodeJS.Timeout | undefined
/** The wait after a wake before the noon catch-up check, so the network is back. */
const WAKE_DELAY_MS = 60_000

/** The manifest of a skill folder, or null when the file cannot be read or does not parse. */
async function readManifest(folder: string): Promise<Manifest | null> {
  try {
    return parseManifest(await readFile(join(folder, MANIFEST), 'utf8'))
  } catch {
    return null
  }
}

async function currentManifests(entries: Entry[]): Promise<Record<string, Manifest>> {
  const local = entries.filter((e) => e.source.type === 'local' && e.status === 'ok')
  const read = await Promise.all(
    local.map(async (e) => [e.name, await readManifest(e.target)] as const)
  )
  return Object.fromEntries(read.filter((r): r is [string, Manifest] => r[1] !== null))
}

/**
 * The files newer than the manifest per skill that has one (ADR 20261111-changed-since-publish).
 * A skill whose folder, files or manifest cannot be read gets no key.
 */
async function currentEdited(
  entries: Entry[],
  manifests: Record<string, Manifest>
): Promise<Record<string, string[]>> {
  const read = await Promise.all(
    entries
      .filter((e) => Object.hasOwn(manifests, e.name))
      .map(async (e) => [e.name, await editedFiles(e.target)] as const)
  )
  return Object.fromEntries(read.filter((r) => r[1].length > 0))
}

/** Counts state builds, so the page can tell a `get-state` reply from an older or newer push. */
let stateSeq = 0

async function buildState(): Promise<State> {
  const seq = ++stateSeq
  const snap = await snapshot(config, paths)
  const manifests = await currentManifests(snap.entries)
  return {
    seq,
    home: paths.home,
    agents: config.agents,
    entries: snap.entries,
    unmanaged: await recruitRows(snap, config, paths),
    backups: await listBackups(paths),
    startup,
    busy: busy ?? (startup.mustering ? MUSTER_LINE : null),
    tesslWorkspace: config.tesslWorkspace,
    tesslWorkspaces: config.tesslWorkspaces,
    appearance: config.appearance,
    loadoutView: config.loadoutView,
    packs: derivePacks(snap.entries, paths),
    checks,
    reviews: await currentReviews(paths, snap.entries),
    fixes: await currentFixes(paths, snap.entries),
    manifests,
    edited: await currentEdited(snap.entries, manifests),
    registry,
    synced: (await readSynced(paths, config.agents))?.synced ?? null,
    appUpdate,
    tesslUpdating
  }
}

/** A state read that started before the last one sent is dropped, so old `busy` never lands last. */
const pushState = latestOnly(buildState, (state: State) => window?.webContents.send('state', state))

/** The read on window focus: never awaited by the focus handler, one at a time. */
const focusRead = coalesce(pushState)

function send(event: LogEvent): void {
  window?.webContents.send('log', event)
}

/** Sends a Loadout note as a `meta` line into `run`, or opens a new run for it when `run` is null. */
function note(action: Action, line: string, run: number | null): void {
  if (run === null) send({ runId: ++runId, action, stream: 'meta', line })
  else send({ runId: run, stream: 'meta', line })
}

/**
 * Runs one command at a time, streams its output to the Log page. Only the running job passes
 * `inJob`: its commands are not refused, and `busy` stays set after each one.
 */
async function runLogged(
  action: Action,
  command: string,
  args: string[],
  { inJob = false }: { inJob?: boolean } = {}
): Promise<{ ok: true; result: RunResult; runId: number } | { ok: false; message: string }> {
  if (quitting) return { ok: false, message: QUITTING_MESSAGE }
  if (!inJob && (busy || job || startup.mustering)) return { ok: false, message: BUSY_MESSAGE }
  const line = [command, ...args].join(' ')
  const id = ++runId
  busy = line
  abort = new AbortController()
  // A job cancelled between two commands starts no more.
  if (inJob && job?.cancelled) abort.abort()
  try {
    await pushState()
    send({ runId: id, action, command: line })
    const result = await run(command, args, {
      env,
      cwd: paths.loadout,
      signal: abort.signal,
      onLine: (stream, text) => send({ runId: id, stream, line: text })
    })
    if (result.cancelled) send({ runId: id, stream: 'meta', line: 'cancelled by user' })
    if (result.timedOut) send({ runId: id, stream: 'meta', line: 'timed out' })
    if (result.truncated) {
      send({
        runId: id,
        stream: 'meta',
        line: 'Output passed the capture cap (4 MB stdout, 64 KB stderr); Loadout read only the first part, so its result can be wrong.'
      })
    }
    if (result.code !== null) send({ runId: id, exit: result.code })
    else {
      const stopped = result.cancelled ? 'cancelled' : result.timedOut ? 'timed-out' : 'failed'
      send({ runId: id, exit: null, stopped })
    }
    return { ok: true, result, runId: id }
  } finally {
    if (!inJob) busy = null
    abort = null
    await pushState()
  }
}

/**
 * Looks one plugin up on the registry as a logged run and stores the result for this session.
 * A refusal from `runLogged` is returned as is and stores nothing.
 */
async function lookupRegistry(
  ref: PluginRef,
  action: Action,
  inJob: boolean,
  publishedVersion?: string
): Promise<Result<{ status: RegistryStatus }>> {
  const tessl = startup.tools.tessl
  if (!tessl) return { ok: false, message: TESSL_MISSING }
  const ran = await runLogged(action, tessl.path, pluginInfoArgs(ref), { inJob })
  if (!ran.ok) return ran
  const { code, stdout, stderr } = ran.result
  const parsed = parsePluginInfo(ref, code, stdout, stderr, Date.now())
  // `publishedVersion`: after a Publish, an older registry version is still pending.
  const status = publishedVersion ? pendingAfterPublish(parsed, publishedVersion) : parsed
  registry[`${ref.workspace}/${ref.plugin}`] = status
  // The `finally` in `runLogged` pushed the state before the result was stored.
  await pushState()
  return { ok: true, status }
}

function closeFollowUp(key: string): void {
  for (const timer of followUps.get(key)?.timers ?? []) clearTimeout(timer)
  followUps.delete(key)
}

/**
 * Opens the follow-up of a Publish that ended pending (replacing an open one): re-checks at 1, 2
 * and 3 intervals from now. A re-check that falls while a command runs is skipped. The follow-up
 * closes at the first answer that is not pending; after the third re-check it stays open, so a
 * refresh still reads an older registry version as pending.
 */
function openFollowUp(ref: Manifest): void {
  const key = `${ref.workspace}/${ref.plugin}`
  closeFollowUp(key)
  const gap = recheckMsFrom(process.env)
  const follow = { ref, timers: [] as NodeJS.Timeout[] }
  followUps.set(key, follow)
  for (const slot of [1, 2, 3]) {
    const timer = setTimeout(async () => {
      if (followUps.get(key) !== follow) return
      if (!(busy || job || startup.mustering)) {
        try {
          const looked = await lookupRegistry(ref, 'check', false, ref.version)
          if (looked.ok && looked.status.state !== 'pending' && followUps.get(key) === follow) {
            closeFollowUp(key)
          }
        } catch {
          // A failed re-check leaves the follow-up as it is; the next slot runs as planned.
        }
      }
    }, slot * gap)
    timer.unref()
    follow.timers.push(timer)
  }
}

/** A quiet `git` read: not logged, allowed while a command runs. Null when `git` is missing. */
async function query(args: string[]): Promise<RunResult | null> {
  const git = startup.tools.git
  if (!git) return null
  return run(git.path, args, { env, cwd: paths.loadout, deadlineMs: 15000 })
}

/**
 * After a Remove left `clone` used by no library skill: deletes it, unless cloneKeepReason keeps it.
 * Returns the sentence for the page notice when the clone stays, else null; the log gets either outcome.
 */
async function dropUnusedClone(clone: string): Promise<string | null> {
  if (!existsSync(clone)) return null
  const shown = displayPath(clone, paths.home)
  // A linked owner or repo folder can lead out of ~/.loadout/repos; such a folder is never deleted.
  const real = await realpath(clone)
  const repos = await realpath(paths.repos)
  const reason = !real.startsWith(`${repos}/`)
    ? `it is outside ${displayPath(paths.repos, paths.home)}`
    : cloneKeepReason(
        real,
        await query(toplevelArgs(clone)),
        await query(localFilesArgs(clone)),
        await query(localCommitsArgs(clone))
      )
  if (reason !== null) {
    const text = `The clone at ${shown} stays: ${reason}. Delete it by hand if you do not need it.`
    note('remove', text, null)
    return text
  }
  try {
    await rm(clone, { recursive: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? (error as Error).message
    const text = `Loadout could not delete the clone at ${shown} (${code}). Delete it by hand if you do not need it.`
    note('remove', text, null)
    return text
  }
  note('remove', `Deleted the clone at ${shown}; no skill uses it any more.`, null)
  // The owner folder goes too once it is empty; one that holds another clone stays.
  await rmdir(dirname(clone)).catch(() => undefined)
  return null
}

/**
 * Runs `work` as one job: every other command is refused until it ends, Cancel stops it, and
 * its commands pass `inJob` to `runLogged`, so `busy` stays set between them.
 */
async function asJob<T>(
  label: string,
  work: (current: { cancelled: boolean; skipped: number }) => Promise<T>
): Promise<T | { ok: false; message: string }> {
  // The channel guard ran before the handler's own awaits; a command may have started since.
  if (busy || job || startup.mustering) return { ok: false, message: BUSY_MESSAGE }
  const current = { cancelled: false, skipped: 0 }
  job = current
  busy = label
  try {
    await pushState()
    return await work(current)
  } finally {
    job = null
    busy = null
    abort = null
    await pushState()
  }
}

async function chooseFolder(): Promise<string | null> {
  const options = { properties: ['openDirectory' as const, 'createDirectory' as const] }
  const chosen = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return chosen.canceled || chosen.filePaths.length === 0 ? null : chosen.filePaths[0]
}

/** Channels that change disk or run a command; each is refused while a command runs. */
const BUSY_CHANNELS: readonly string[] = [
  'toggle',
  'toggle-pack',
  'remove-pack',
  'set-agent-enabled',
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
  'recruit',
  'recruit-undo',
  'check',
  'check-all',
  'check-registry',
  'update-all'
]

const GIT_MISSING = 'git not found. Install it, then press Refresh.'
const BUSY_MESSAGE = 'Another command is running.'
const QUITTING_MESSAGE = 'Loadout is quitting.'

/** The first library entry of each source, sorted by source key; `local` entries are left out. */
function sources(entries: Entry[]): [string, Entry][] {
  const found = new Map<string, Entry>()
  for (const entry of entries) {
    const key = sourceKey(entry.source)
    if (key && !found.has(key)) found.set(key, entry)
  }
  return [...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

/** The `github` check sequence of spec "Check": fetch logged, the local reads as `meta` lines in its run. */
async function checkGithub(owner: string, repo: string, inJob = false): Promise<SourceCheck> {
  const git = startup.tools.git
  if (!git) return newCheck(Date.now(), 'failed', { message: GIT_MISSING })
  const clone = join(paths.repos, owner, repo)
  const fetched = await runLogged('check', git.path, fetchArgs(clone), { inJob })
  if (!fetched.ok) throw new Error(fetched.message)
  const run = fetched.runId
  const done = (check: SourceCheck, line?: string): SourceCheck => {
    note('check', line ?? check.message ?? '', run)
    return check
  }
  if (fetched.result.code !== 0) return done(checkFailed(fetched.result.code, Date.now()))
  /** A quiet read; on a failure its stderr joins the run. */
  const read = async (args: string[]): Promise<RunResult | null> => {
    const result = await query(args)
    if (result?.code !== 0) {
      for (const line of (result?.stderr ?? '').split('\n')) if (line) note('check', line, run)
    }
    return result
  }
  const fail = (result: RunResult | null): SourceCheck =>
    done(checkFailed(result?.code ?? null, Date.now()))
  const status = await read(statusArgs(clone))
  if (status?.code !== 0) return fail(status)
  const files = parsePorcelain(status.stdout)
  if (files.length > 0) {
    return done(newCheck(Date.now(), 'blocked', { message: dirtyMessage(clone, files) }))
  }
  const counted = await read(aheadBehindArgs(clone))
  if (counted?.code !== 0) return fail(counted)
  const count = parseAheadBehind(counted.stdout)
  if (!count) return fail(null)
  if (count.ahead === 0 && count.behind === 0) {
    return done(newCheck(Date.now(), 'up-to-date'), 'up to date')
  }
  const tracked = await read(upstreamArgs(clone))
  if (tracked?.code !== 0) return fail(tracked)
  const upstream = tracked.stdout.trim()
  if (count.ahead > 0) {
    return done(
      newCheck(Date.now(), 'blocked', { upstream, message: divergedMessage(clone, upstream) })
    )
  }
  const head = await read(headArgs(clone))
  if (head?.code !== 0) return fail(head)
  const incoming = await read(incomingArgs(clone))
  if (incoming?.code !== 0) return fail(incoming)
  const commits = parseCommits(incoming.stdout)
  const check = newCheck(Date.now(), 'ready', {
    behind: count.behind,
    upstream,
    from: head.stdout.trim(),
    to: commits[0]?.hash ?? '',
    commits
  })
  return done(check, `${count.behind} behind ${upstream}`)
}

/** One `tessl outdated` run; stores a check for every plugin given. */
async function checkTessl(plugins: PluginRef[], inJob = false): Promise<void> {
  const keys = plugins.map((ref) => `tessl:${ref.workspace}/${ref.plugin}`)
  const tessl = startup.tools.tessl
  if (!tessl) {
    for (const key of keys) checks[key] = newCheck(Date.now(), 'failed', { message: TESSL_MISSING })
    return
  }
  const ran = await runLogged('check', tessl.path, outdatedArgs(), { inJob })
  if (!ran.ok) throw new Error(ran.message)
  const found =
    ran.result.code === 0
      ? tesslChecks(ran.result.stdout, plugins, Date.now())
      : Object.fromEntries(keys.map((key) => [key, checkFailed(ran.result.code, Date.now())]))
  plugins.forEach((ref, i) => {
    const check = found[keys[i]]
    const result =
      check.state === 'ready'
        ? `${check.from} → ${check.to}`
        : check.state === 'up-to-date'
          ? 'up to date'
          : check.message
    note('check', `${ref.workspace}/${ref.plugin}: ${result}`, ran.runId)
    checks[keys[i]] = check
  })
}

/** The commands of an Update; refusals and failures word for word as spec "Update". */
async function pullOrInstall(entry: Entry, inJob: boolean): Promise<Result<{ updated: string[] }>> {
  const entries = await readLibrary(paths)
  const skill = entry.name
  const source = entry.source
  if (source.type === 'github') {
    const git = startup.tools.git
    if (!git) return { ok: false, message: GIT_MISSING }
    const clone = join(paths.repos, source.owner, source.repo)
    const status = await runLogged('update', git.path, statusArgs(clone), { inJob })
    if (!status.ok) return status
    if (status.result.code !== 0) return exitFailure('Update', status.result.code)
    const files = parsePorcelain(status.result.stdout)
    if (files.length > 0) return { ok: false, message: dirtyMessage(clone, files) }
    const pulled = await runLogged('update', git.path, pullArgs(clone), { inJob })
    if (!pulled.ok) return pulled
    if (pulled.result.code !== 0) return exitFailure('Update', pulled.result.code)
    const updated = entries
      .filter(
        (e) =>
          e.source.type === 'github' &&
          e.source.owner === source.owner &&
          e.source.repo === source.repo
      )
      .map((e) => e.name)
    return { ok: true, updated }
  }
  if (source.type === 'tessl') {
    const tessl = startup.tools.tessl
    if (!tessl) return { ok: false, message: TESSL_MISSING }
    const installed = await installPlugin(tessl.path, source, 'update', inJob)
    if (!installed.ok) return installed
    if (installed.code !== 0) return exitFailure('Update', installed.code)
    const updated = entries
      .filter(
        (e) =>
          e.source.type === 'tessl' &&
          e.source.workspace === source.workspace &&
          e.source.plugin === source.plugin
      )
      .map((e) => e.name)
    return { ok: true, updated }
  }
  return { ok: false, message: `"${skill}" is not a GitHub or Tessl source.` }
}

/** Update of spec "Update": pull or reinstall. Sets the source's check to its result. */
async function updateSource(entry: Entry, inJob = false): Promise<Result<{ updated: string[] }>> {
  const updated = await pullOrInstall(entry, inJob)
  const key = sourceKey(entry.source)
  if (key) {
    checks[key] = updated.ok
      ? newCheck(Date.now(), 'up-to-date')
      : newCheck(Date.now(), 'failed', { message: updated.message })
  }
  return updated
}

/** Manifest check and lint run for one added skill folder. */
async function lintAdded(
  folder: string,
  action: Action,
  run: number | null
): Promise<Result<{ lint: Lint }>> {
  // The registry checked the plugin at publish; a lint of the install folder only warns about that folder.
  if (classifyTarget(folder, paths).type === 'tessl') return { ok: true, lint: 'ok' }
  let lint: Lint = 'ok'
  const tessl = startup.tools.tessl
  if (!existsSync(join(folder, '.tessl-plugin', 'plugin.json'))) {
    // Lint checks a publishable plugin; a skill without a manifest has nothing to lint.
    note(action, 'No plugin manifest; lint skipped.', run)
  } else if (tessl) {
    const linted = await runLogged(action, tessl.path, ['skill', 'lint', folder])
    if (!linted.ok) return linted
    const code = linted.result.code
    lint = code === null ? 'unfinished' : code === 0 ? 'ok' : 'problems'
  } else {
    note(action, 'tessl not found; lint skipped.', run)
  }
  return { ok: true, lint }
}

/** Runs `tessl install` for a plugin, then removes the agent links it made. */
async function installPlugin(
  tessl: string,
  ref: PluginRef,
  action: Action,
  inJob = false
): Promise<{ ok: true; code: number | null } | { ok: false; message: string }> {
  const before = await listLinks(paths.agentsSkills)
  const installed = await runLogged(action, tessl, installArgs(ref), { inJob })
  if (!installed.ok) return installed
  const root = join(paths.tesslPlugins, ref.workspace, ref.plugin)
  for (const path of await removeInstallLinks(before, root, paths)) {
    note(
      action,
      `Removed ${path}: tessl install made it, and Loadout makes the agent links itself.`,
      installed.runId
    )
  }
  return { ok: true, code: installed.result.code }
}

/** Shared checks for review, fix and publish. */
async function tesslTarget(
  skill: string,
  localOnly: boolean
): Promise<
  { ok: true; tessl: string; workspace: string; target: string } | { ok: false; message: string }
> {
  const { entries } = await snapshot(config, paths)
  const entry = entries.find((e) => e.name === skill)
  if (!entry) return { ok: false, message: `"${skill}" is not in your loadout.` }
  const tessl = startup.tools.tessl
  if (!tessl) return { ok: false, message: TESSL_MISSING }
  if (!config.tesslWorkspace) return { ok: false, message: WORKSPACE_MISSING }
  if (localOnly && entry.source.type !== 'local') {
    return {
      ok: false,
      message: `"${skill}" is not a local skill; Fix and Publish work on local skills only.`
    }
  }
  return { ok: true, tessl: tessl.path, workspace: config.tesslWorkspace, target: entry.target }
}

/** `<owner>/<repo>` or `<workspace>/<plugin>` of a pack key. */
function packLabel(key: string): string {
  return key.slice(key.indexOf(':') + 1)
}

function exitFailure(label: string, code: number | null): { ok: false; message: string } {
  return code === null
    ? { ok: false, message: `${label} failed, see the log.` }
    : { ok: false, message: `${label} failed (exit ${code}), see the log.` }
}

function handle<A extends unknown[]>(channel: string, fn: (...args: A) => Promise<Result>): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    const busyChannel = BUSY_CHANNELS.includes(channel)
    if (busyChannel && quitting) return { ok: false, message: QUITTING_MESSAGE }
    if ((busy || job || startup.mustering) && busyChannel) {
      return { ok: false, message: BUSY_MESSAGE }
    }
    const work = (async () => {
      try {
        return await fn(...(args as A))
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    })()
    if (!busyChannel) return work
    running.add(work)
    try {
      return await work
    } finally {
      running.delete(work)
    }
  })
}

/** A log function for one recruit or undo run: the first line opens the run, the rest join it. */
function recruitLog(): (line: string) => void {
  let run: number | null = null
  return (line) => {
    note('recruit', line, run)
    run ??= runId
  }
}

/** The payload checks the recruit channels share: strings, and an entry that is one path segment. */
function badRecruitPayload(payload: {
  agentId: unknown
  entry: unknown
  parent?: unknown
}): { ok: false; message: string } | null {
  const { agentId, entry, parent } = payload ?? {}
  if (typeof agentId !== 'string' || agentId === '') {
    return { ok: false, message: 'Recruit needs an agent.' }
  }
  if (
    typeof entry !== 'string' ||
    entry === '' ||
    entry === '.' ||
    entry === '..' ||
    entry.includes('/')
  ) {
    return { ok: false, message: `"${String(entry)}" is not an entry name.` }
  }
  if (parent !== undefined && (typeof parent !== 'string' || !isAbsolute(parent))) {
    return { ok: false, message: 'The folder must be an absolute path.' }
  }
  return null
}

function registerHandlers(): void {
  handle('get-state', async () => ({ ok: true, state: await buildState() }))

  handle('refresh', async () => {
    if (startup.mustering) return { ok: true }
    try {
      await inConfigOrder(async () => {
        config = await readConfig(paths)
      })
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    await muster()
    return { ok: true }
  })

  handle('toggle', async (request: ToggleRequest) => {
    const snap = await snapshot(config, paths)
    const plan = planToggle(request, config.agents, snap.entries, snap.folders, paths)
    if (!plan.ok) return plan
    await applyOps(plan.ops)
    await pushState()
    return { ok: true }
  })

  handle('toggle-pack', async (request: { pack: string; agentId: string; on: boolean }) => {
    // The channel guard refuses other commands while busy is set; no await runs before this line.
    busy = `${request.on ? 'Deploy' : 'Stow'} pack ${packLabel(request.pack)}`
    try {
      await pushState()
      return await togglePack(request, config, paths)
    } finally {
      busy = null
      await pushState()
    }
  })

  handle('set-agent-enabled', async ({ agentId, on }: { agentId: string; on: boolean }) => {
    const agent = config.agents.find((a) => a.id === agentId)
    if (!agent) return { ok: false, message: `Unknown agent "${agentId}".` }
    if (!on) {
      const snap = await snapshot(config, paths)
      const count = snap.folders.find((f) => f.agentId === agentId)?.managed.length ?? 0
      if (count > 0) {
        return {
          ok: false,
          message: `Turn off the ${count} ${count === 1 ? 'skill' : 'skills'} enabled for ${agent.label} first.`
        }
      }
    }
    await changeConfig((current) => ({
      ...current,
      agents: current.agents.map((a) => (a.id === agentId ? { ...a, enabled: on } : a))
    }))
    return { ok: true }
  })

  handle(
    'set-workspaces',
    async ({ workspaces, default: chosen }: { workspaces: string[]; default: string }) => {
      await changeConfig((current) => ({
        ...current,
        tesslWorkspaces: workspaces,
        tesslWorkspace: chosen
      }))
      return { ok: true }
    }
  )

  // A quiet read, not in the Log: Settings asks for it each time it opens.
  handle('list-workspaces', async () => {
    const tessl = startup.tools.tessl
    if (!tessl) return { ok: false, message: TESSL_MISSING }
    const result = await run(tessl.path, ['workspace', 'list', '--json'], {
      env,
      cwd: paths.loadout,
      deadlineMs: 10000
    })
    const workspaces = result.code === 0 ? parseWorkspaces(result.stdout) : null
    if (workspaces === null) {
      return {
        ok: false,
        message: `Could not list your Tessl workspaces (exit ${result.code ?? 'none'}). Check tessl login, then open Settings again.`
      }
    }
    return { ok: true, workspaces }
  })

  // A quiet read, like list-workspaces: the Registry dialog asks for it on open and on a workspace change.
  handle('list-plugins', async ({ workspace }: { workspace: Workspace }) => {
    const tessl = startup.tools.tessl
    if (!tessl) return { ok: false, message: TESSL_MISSING }
    const result = await run(tessl.path, searchArgs(workspace), {
      env,
      cwd: paths.loadout,
      deadlineMs: 15000
    })
    const plugins = result.code === 0 ? parseRegistryPlugins(result.stdout) : null
    if (plugins === null) {
      return {
        ok: false,
        message: `Could not list the plugins of that workspace (exit ${result.code ?? 'none'}). Check tessl login, then open the dialog again.`
      }
    }
    return { ok: true, plugins }
  })

  // Main writes the clipboard: the page's navigator.clipboard refuses while the window has no focus.
  handle('copy-text', async ({ text }: { text: string }) => {
    clipboard.writeText(text)
    return { ok: true }
  })

  // Opens Terminal.app only; it takes no argument and types nothing.
  handle('open-terminal', async () => {
    const terminal = '/System/Applications/Utilities/Terminal.app'
    const error = await shell.openPath(terminal)
    return error
      ? { ok: false, message: `Open Terminal failed: ${error} at ${terminal}.` }
      : { ok: true }
  })

  handle('set-appearance', async ({ appearance }: { appearance: Appearance }) => {
    if (!APPEARANCES.includes(appearance)) return { ok: false, message: 'Unknown appearance.' }
    // Electron switches prefers-color-scheme in the page and the window chrome.
    nativeTheme.themeSource = appearance
    await changeConfig((current) => ({ ...current, appearance }))
    return { ok: true }
  })

  handle('set-loadout-view', async ({ view }: { view: LoadoutView }) => {
    if (!LOADOUT_VIEWS.includes(view)) return { ok: false, message: 'Unknown view.' }
    await changeConfig((current) => ({ ...current, loadoutView: view }))
    return { ok: true }
  })

  handle('reveal-folder', async ({ folder }: { folder: LoadoutFolder }) => {
    if (!LOADOUT_FOLDERS.includes(folder)) return { ok: false, message: 'Unknown folder.' }
    const path = paths[folder]
    if (!existsSync(path)) {
      return { ok: false, message: `${displayPath(path, paths.home)} does not exist yet.` }
    }
    shell.showItemInFolder(path)
    return { ok: true }
  })

  // A file check, no git command: the Publish dialog shows Commit manifest only inside a work tree.
  handle('git-work-tree', async ({ skill }: { skill: string }) => {
    const { entries } = await snapshot(config, paths)
    const entry = entries.find((e) => e.name === skill)
    if (!entry) return { ok: false, message: `"${skill}" is not in your loadout.` }
    return { ok: true, inside: await insideGitWorkTree(entry.target) }
  })

  handle('add-local', async () => {
    const folder = await chooseFolder()
    if (!folder) return { ok: true, cancelled: true }
    const added = await addLocal(folder, paths)
    if (!added.ok) return added
    const linted = await lintAdded(folder, 'add', null)
    if (!linted.ok) return linted
    await pushState()
    return { ok: true, name: added.name, lint: linted.lint }
  })

  handle('scan-github', async ({ repo }: { repo: string }) => {
    const git = startup.tools.git
    if (!git) return { ok: false, message: GIT_MISSING }
    const parsed = parseRepo(repo)
    if (!parsed) return { ok: false, message: REPO_INPUT_MESSAGE }
    const root = join(paths.repos, parsed.owner, parsed.repo)
    if (!existsSync(root)) {
      const cloned = await runLogged('add', git.path, cloneArgs(githubUrl(parsed), root))
      if (!cloned.ok) return cloned
      if (cloned.result.code !== 0) return { ok: false, message: 'Clone failed, see the log.' }
    }
    const names = (await readLibrary(paths)).map((e) => e.name)
    const candidates = await scanSkills(root, names)
    if (candidates.length === 0) {
      return { ok: false, message: `No SKILL.md found in ${parsed.owner}/${parsed.repo}.` }
    }
    const key = sourceKey({ type: 'github', owner: parsed.owner, repo: parsed.repo, subpath: '' })
    return { ok: true, root, key, candidates }
  })

  handle(
    'add-candidates',
    async ({ root, names, agents }: { root: string; names: string[]; agents: string[] }) => {
      const linked = await linkCandidates(root, names, paths)
      if (!linked.ok) return linked
      const lint: Record<string, Lint> = {}
      for (const { name, folder } of linked.added) {
        const linted = await lintAdded(folder, 'add', null)
        if (!linted.ok) return linted
        lint[name] = linted.lint
      }
      const refused = await deployAdded(names, agents, config, paths)
      await pushState()
      return { ok: true, added: names, lint, refused }
    }
  )

  handle('update', async ({ skill }: { skill: string }) => {
    const { entries } = await snapshot(config, paths)
    const entry = entries.find((e) => e.name === skill)
    if (!entry) return { ok: false, message: `"${skill}" is not in your loadout.` }
    // A job, so no command starts between `git status` and `git pull`.
    return asJob('Update', () => updateSource(entry, true))
  })

  handle('scan-tessl', async ({ plugin }: { plugin: string }) => {
    const tessl = startup.tools.tessl
    if (!tessl) return { ok: false, message: TESSL_MISSING }
    const ref = parsePluginRef(plugin)
    if (!ref) return { ok: false, message: PLUGIN_INPUT_MESSAGE }
    const installed = await installPlugin(tessl.path, ref, 'add')
    if (!installed.ok) return installed
    if (installed.code === null) return { ok: false, message: 'Install failed, see the log.' }
    if (installed.code !== 0) return exitFailure('Install', installed.code)
    const root = join(paths.tesslPlugins, ref.workspace, ref.plugin)
    const names = (await readLibrary(paths)).map((e) => e.name)
    const candidates = await scanSkills(root, names)
    if (candidates.length === 0) {
      return { ok: false, message: `No SKILL.md found in ${ref.workspace}/${ref.plugin}.` }
    }
    const key = sourceKey({
      type: 'tessl',
      workspace: ref.workspace,
      plugin: ref.plugin,
      subpath: ''
    })
    return { ok: true, root, key, candidates }
  })

  handle('review', async ({ skill }: { skill: string }) => {
    const checked = await tesslTarget(skill, false)
    if (!checked.ok) return checked
    try {
      // Taken before the run, so an edit made while Tessl reviews makes the result stale.
      const before = await fingerprint(checked.target)
      const ran = await runLogged(
        'review',
        checked.tessl,
        reviewArgs(checked.target, checked.workspace)
      )
      if (!ran.ok) return ran
      if (ran.result.code !== 0) return exitFailure('Review', ran.result.code)
      const saved = reviewFromStdout(ran.result.stdout, before, Date.now())
      if (saved) await saveReview(paths, skill, saved)
      return { ok: true, score: parseReviewScore(ran.result.stdout), saved: saved !== null }
    } finally {
      await pushState()
    }
  })

  handle(
    'fix',
    // A job, so nothing starts between the copy Undo puts back and the record taken after the run.
    ({ skill }: { skill: string }) =>
      asJob(`Fix ${skill}`, async () => {
        const checked = await tesslTarget(skill, true)
        if (!checked.ok) return checked
        // The copy Undo puts back (ADR 20261109-fix-undo); a failed copy stops the fix.
        await saveBefore(paths, skill, checked.target)
        const ran = await runLogged(
          'fix',
          checked.tessl,
          fixArgs(checked.target, checked.workspace),
          {
            inJob: true
          }
        )
        // Recorded on any outcome, so a fix that failed half-way can still be undone.
        let files: number
        try {
          files = await finishFix(paths, skill, checked.target, Date.now())
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error)
          return {
            ok: false,
            message: `Fix ran, but Loadout could not compare the skill with its copy from before the fix (${why}). Undo is off; the copy is in ~/.loadout/fixes/${skill}/before.`
          }
        }
        if (!ran.ok) return ran
        if (ran.result.code !== 0) return exitFailure('Fix', ran.result.code)
        return { ok: true, files }
      })
  )

  handle(
    'publish',
    // A job, so no command starts between the publish and the git runs that read and commit its result.
    ({
      skill,
      bump,
      workspace,
      commit
    }: {
      skill: string
      bump: Bump
      workspace?: string
      commit?: boolean
    }) =>
      asJob(`Publish ${skill}`, async () => {
        const checked = await tesslTarget(skill, true)
        if (!checked.ok) return checked
        const ran = await runLogged(
          'publish',
          checked.tessl,
          publishArgs(checked.target, workspace || checked.workspace, bump),
          { inJob: true }
        )
        if (!ran.ok) return ran
        if (ran.result.code !== 0) return exitFailure('Publish', ran.result.code)
        const after = await readManifest(checked.target)
        const git = startup.tools.git
        // The manifest steps: a refusal from runLogged, or the manifest state.
        const settle = async (): Promise<Result<{ manifest: ManifestState }>> => {
          if (!git) return { ok: true, manifest: 'clean' }
          const status = await runLogged('publish', git.path, manifestStatusArgs(checked.target), {
            inJob: true
          })
          if (!status.ok) return status
          if (!manifestUncommitted(status.result.code, status.result.stdout))
            return { ok: true, manifest: 'clean' }
          if (!commit) return { ok: true, manifest: 'uncommitted' }
          // A failed add or commit leaves the publish done; git's error is in the log.
          const added = await runLogged('publish', git.path, manifestAddArgs(checked.target), {
            inJob: true
          })
          if (!added.ok) return added
          if (added.result.code !== 0) return { ok: true, manifest: 'commit-failed' }
          const message = publishCommitMessage(skill, after?.version ?? null)
          const committed = await runLogged(
            'publish',
            git.path,
            manifestCommitArgs(checked.target, message),
            { inJob: true }
          )
          if (!committed.ok) return committed
          return { ok: true, manifest: committed.result.code === 0 ? 'committed' : 'commit-failed' }
        }
        const settled = await settle()
        if (!settled.ok) return settled
        // A failed lookup never changes the Publish result; it shows on the skill page as a CHECK state.
        if (after) {
          const looked = await lookupRegistry(after, 'publish', true, after.version)
          if (looked.ok && looked.status.state === 'pending') openFollowUp(after)
          else closeFollowUp(`${after.workspace}/${after.plugin}`)
        }
        return {
          ok: true,
          manifest: settled.manifest,
          version: after?.version ?? null,
          workspace: after?.workspace ?? (workspace || checked.workspace)
        }
      })
  )

  handle('unpublish', ({ skill }: { skill: string }) =>
    asJob(`Unpublish ${skill}`, async (current) => {
      const { entries } = await snapshot(config, paths)
      const entry = entries.find((e) => e.name === skill)
      if (!entry) return { ok: false, message: `"${skill}" is not in your loadout.` }
      const tessl = startup.tools.tessl
      if (!tessl) return { ok: false, message: TESSL_MISSING }
      if (entry.source.type !== 'local') {
        return {
          ok: false,
          message: `"${skill}" is not a local skill; Unpublish works on local skills only.`
        }
      }
      const manifest = entry.status === 'ok' ? await readManifest(entry.target) : null
      if (!manifest) {
        return {
          ok: false,
          message: `"${skill}" has no Tessl manifest in ${displayPath(entry.target, paths.home)}.`
        }
      }
      const key = `${manifest.workspace}/${manifest.plugin}`
      const removed: string[] = []
      const fail = (message: string): { ok: false; message: string } => ({ ok: false, message })
      try {
        const stopped = (): { ok: false; message: string } => fail(unpublishStoppedMessage(removed))
        // One version: unpublish it. Null on success, else the result that ends the job.
        const unpublishOne = async (
          version: string
        ): Promise<{ ok: false; message: string } | null> => {
          const ran = await runLogged('unpublish', tessl.path, unpublishArgs(manifest, version), {
            inJob: true
          })
          if (!ran.ok) return ran
          if (ran.result.code === 0) removed.push(version)
          if (current.cancelled) {
            if (ran.result.code === null) {
              return fail(unpublishStoppedInFlightMessage(manifest, version, removed))
            }
            return stopped()
          }
          if (ran.result.code !== 0) {
            return fail(unpublishFailure(manifest, version, ran.result.code, ran.result.stderr))
          }
          return null
        }
        // The loop: unpublish the latest version until the registry names none.
        let gone = false
        for (;;) {
          if (current.cancelled) return stopped()
          const looked = await lookupRegistry(manifest, 'unpublish', true)
          if (!looked.ok) return looked
          if (current.cancelled) return stopped()
          const status = looked.status
          let next: 'unpublish' | 'walk' | 'gone' = 'walk'
          switch (status.state) {
            case 'not-found':
              if (removed.length === 0) return fail(status.message ?? '')
              next = 'gone'
              break
            case 'failed':
              return fail(status.message ?? '')
            case 'pending':
            case 'archived':
              // Both answer `latestVersion: null`: the versions answer only by number.
              next = 'walk'
              break
            case 'found':
              next = 'unpublish'
              break
            default: {
              const unhandled: never = status.state
              return fail(`Unknown registry state ${String(unhandled)}.`)
            }
          }
          if (next === 'gone') {
            gone = true
            break
          }
          if (next === 'walk') break
          if (removed.includes(status.version)) {
            return fail(unpublishRepeatMessage(manifest, status.version))
          }
          const ended = await unpublishOne(status.version)
          if (ended) return ended
        }
        // The walk: versions the registry hides from the latest-version answer.
        if (!gone) {
          for (const version of walkVersions(manifest.version)) {
            if (removed.includes(version)) continue
            if (current.cancelled) return stopped()
            const info = await runLogged(
              'unpublish',
              tessl.path,
              pluginInfoArgs(manifest, version),
              {
                inJob: true
              }
            )
            if (!info.ok) return info
            if (current.cancelled) return stopped()
            const found = readVersionLookup(manifest, version, info.result.code, info.result.stderr)
            if (found.state === 'failed') return fail(found.message)
            if (found.state === 'gone') break
            if (found.state === 'absent') continue
            const ended = await unpublishOne(version)
            if (ended) return ended
          }
          // The final lookup stores the end state as the session status.
          if (current.cancelled) return stopped()
          const last = await lookupRegistry(manifest, 'unpublish', true)
          if (!last.ok) return last
          if (current.cancelled) return stopped()
          if (last.status.state === 'failed') return fail(last.status.message ?? '')
          if (last.status.state !== 'not-found')
            return fail(unpublishLeftMessage(manifest, removed))
        }
        if (removed.length === 0) return fail(notOnRegistryMessage(manifest))
        // Gone on purpose: delete the manifest Tessl wrote (its folder too, when empty) and forget
        // the lookup, so the skill no longer reads as published.
        const file = join(entry.target, MANIFEST)
        let manifestDeleted = true
        try {
          await rm(file)
          note('unpublish', `Deleted ${displayPath(file, paths.home)}.`, null)
        } catch (error) {
          manifestDeleted = false
          note(
            'unpublish',
            `Could not delete ${displayPath(file, paths.home)}: ${(error as Error).message}`,
            null
          )
        }
        try {
          await rmdir(dirname(file))
        } catch (error) {
          // A folder that holds other files stays.
          if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') {
            note(
              'unpublish',
              `Could not delete ${displayPath(dirname(file), paths.home)}: ${(error as Error).message}`,
              null
            )
          }
        }
        delete registry[key]
        await pushState()
        return { ok: true, removed, manifestDeleted }
      } finally {
        closeFollowUp(key)
      }
    })
  )

  handle('remove', async ({ skill }: { skill: string }) => {
    // Busy, so no Scan or Add can use the clone between its git reads and its delete.
    busy = `Remove ${skill}`
    try {
      const removed = await removeEntry(skill, config, paths)
      if (removed.ok) {
        await deleteReview(paths, skill)
        await deleteFix(paths, skill)
      }
      const clone =
        removed.ok && removed.unusedClone ? await dropUnusedClone(removed.unusedClone) : null
      return removed.ok ? { ok: true, clone } : removed
    } finally {
      busy = null
      await pushState()
    }
  })

  handle('remove-pack', async ({ pack }: { pack: string }) => {
    busy = `Remove pack ${packLabel(pack)}`
    try {
      await pushState()
      const result = await removePack(pack, config, paths)
      if (!result.ok) return result
      for (const skill of result.removed) {
        await deleteReview(paths, skill)
        await deleteFix(paths, skill)
      }
      const clone = result.unusedClone ? await dropUnusedClone(result.unusedClone) : null
      return { ok: true, removed: result.removed, refused: result.refused, clone }
    } finally {
      // Every path, the zero-member refusal too, ends with a state push.
      busy = null
      await pushState()
    }
  })

  /** The library entry of a saved fix; Undo and Keep act on library skills only. */
  const fixEntry = async (skill: string): Promise<Entry | undefined> =>
    (await snapshot(config, paths)).entries.find((e) => e.name === skill)

  handle('fix-undo', ({ skill }: { skill: string }) =>
    asJob(`Undo fix of ${skill}`, async () => {
      const entry = await fixEntry(skill)
      if (!entry) return { ok: false, message: `"${skill}" is not in your loadout.` }
      return undoFix(paths, entry)
    })
  )

  handle('fix-keep', ({ skill }: { skill: string }) =>
    asJob(`Keep fix of ${skill}`, async () => {
      if (!(await fixEntry(skill)))
        return { ok: false, message: `"${skill}" is not in your loadout.` }
      await deleteFix(paths, skill)
      return { ok: true }
    })
  )

  handle('relocate', async ({ skill }: { skill: string }) => {
    const folder = await chooseFolder()
    if (!folder) return { ok: true, cancelled: true }
    const moved = await relocateEntry(skill, folder, paths)
    await pushState()
    return moved
  })

  handle('fork', async ({ skill, name }: { skill: string; name: string }) => {
    const checked = await checkFork(skill, name, paths)
    if (!checked.ok) return checked
    const parent = await chooseFolder()
    if (!parent) return { ok: true, cancelled: true }
    const outcome = await forkEntry(skill, name, parent, config, paths)
    await pushState()
    if (!outcome.ok) {
      if (outcome.deleted) {
        note('fork', outcome.message, null)
        note('fork', `Deleted ${outcome.deleted}.`, runId)
      }
      return outcome
    }
    note('fork', `Forked "${skill}" to "${name}" at ${outcome.folder}.`, null)
    const run = runId
    const log = (line: string): void => note('fork', line, run)
    if (outcome.leftOut.length > 0) log(`Left out the Tessl files: ${outcome.leftOut.join(', ')}.`)
    for (const label of outcome.moved) log(`${label}: "${name}" on, "${skill}" off.`)
    for (const f of outcome.failed) log(`${f.agent}: ${f.message} "${skill}" stays on.`)
    if (outcome.occurrences.length > 0) {
      log(
        `"${skill}" still appears in ${outcome.occurrences.length} lines of the copy; edit them by hand where they should name "${name}":`
      )
      for (const line of outcome.occurrences) log(line)
    } else log(`"${skill}" appears nowhere else in the copy.`)
    return {
      ok: true,
      name: outcome.name,
      folder: outcome.folder,
      moved: outcome.moved,
      failed: outcome.failed,
      occurrences: outcome.occurrences
    }
  })

  handle(
    'recruit-preview',
    async (payload: { agentId: string; entry: string; parent?: string }) => {
      const bad = badRecruitPayload(payload)
      if (bad) return bad
      return previewRecruit(payload.agentId, payload.entry, payload.parent ?? null, config, paths)
    }
  )

  handle('candidate-detail', async (payload: { agentId: string; entry: string }) => {
    const bad = badRecruitPayload(payload)
    if (bad) return bad
    return candidateDetail(payload.agentId, payload.entry, config, paths)
  })

  handle('choose-folder', async () => ({ ok: true, folder: await chooseFolder() }))

  handle(
    'recruit',
    async (payload: { agentId: string; entry: string; parent?: string; shown: string[] }) => {
      const bad = badRecruitPayload(payload)
      if (bad) return bad
      if (!Array.isArray(payload.shown) || payload.shown.some((line) => typeof line !== 'string')) {
        return { ok: false, message: 'Recruit needs the lines of the preview.' }
      }
      const log = recruitLog()
      const outcome = await runRecruit(
        payload.agentId,
        payload.entry,
        payload.parent ?? null,
        payload.shown,
        config,
        paths,
        log
      )
      await pushState()
      return outcome
    }
  )

  handle('undo-preview', async (payload: { agentId: string; entry: string }) => {
    const bad = badRecruitPayload(payload)
    if (bad) return bad
    return previewUndo(payload.agentId, payload.entry, config, paths)
  })

  handle('recruit-undo', async (payload: { agentId: string; entry: string }) => {
    const bad = badRecruitPayload(payload)
    if (bad) return bad
    const outcome = await runUndo(payload.agentId, payload.entry, config, paths, recruitLog())
    await pushState()
    return outcome
  })

  handle('reveal-backup', async (payload: { agentId: string; entry: string }) => {
    const bad = badRecruitPayload(payload)
    if (bad) return bad
    const { agentId, entry } = payload
    if (agentId.startsWith('.') || agentId.includes('/')) {
      return { ok: false, message: `"${agentId}" is not a backup folder.` }
    }
    const path = join(paths.backups, agentId, entry)
    if (!path.startsWith(`${paths.backups}/`)) {
      return { ok: false, message: `"${entry}" is not an entry name.` }
    }
    shell.showItemInFolder(path)
    return { ok: true }
  })

  handle('reveal', async ({ skill, root }: { skill: string; root?: boolean }) => {
    const entry = (await snapshot(config, paths)).entries.find((e) => e.name === skill)
    if (!entry) return { ok: false, message: `"${skill}" is not in your loadout.` }
    const source = entry.source
    if (root && source.type === 'github') {
      shell.showItemInFolder(join(paths.repos, source.owner, source.repo))
    } else if (root && source.type === 'tessl') {
      shell.showItemInFolder(join(paths.tesslPlugins, source.workspace, source.plugin))
    } else shell.showItemInFolder(entry.target)
    return { ok: true }
  })

  handle('skill-detail', async ({ skill }: { skill: string }) => {
    const entry = (await snapshot(config, paths)).entries.find((e) => e.name === skill)
    if (!entry) return { ok: false, message: `"${skill}" is not in your loadout.` }
    const folder = await readSkillFolder(entry.target)
    // One read of the folder for the review and the fix.
    const files = await readSkill(entry.target).catch(() => null)
    let git: SkillDetail['git'] = null
    let history: SkillDetail['history'] = null
    const source = entry.source
    if (source.type === 'github') {
      const clone = join(paths.repos, source.owner, source.repo)
      const [branch, commit, shallow, log] = await Promise.all([
        query(branchArgs(clone)),
        query(headArgs(clone)),
        query(shallowArgs(clone)),
        query(historyArgs(clone, source.subpath))
      ])
      if (branch?.code === 0 && commit?.code === 0 && shallow?.code === 0) {
        git = {
          branch: branch.stdout.trim(),
          commit: commit.stdout.trim(),
          shallow: shallow.stdout.trim() === 'true'
        }
      }
      if (log?.code === 0) history = parseHistory(log.stdout)
    }
    const found = await readReview(paths, entry, files && hashSkill(files))
    const review: SkillDetail['review'] = found && {
      report: parseReviewReport(found.saved.tessl),
      reviewedAt: found.saved.reviewedAt,
      score: savedScore(found.saved),
      stale: found.stale
    }
    const fix = await readFix(paths, entry, files)
    const live = await readSynced(paths, config.agents)
    const syncedCopy: SkillDetail['syncedCopy'] = live?.synced.skills.includes(entry.name)
      ? await compareCopies(entry.target, join(live.bucket, entry.name))
      : null
    // `tessl install` writes the manifest at the plugin root, above the skill's subpath.
    const installed =
      source.type === 'tessl'
        ? await readManifest(join(paths.tesslPlugins, source.workspace, source.plugin))
        : null
    return {
      ok: true,
      detail: {
        ...folder,
        texts: files ? skillTexts(files) : [],
        git,
        history,
        review,
        fix,
        syncedCopy,
        installed
      }
    }
  })

  handle('check', async ({ skill }: { skill: string }) => {
    const { entries } = await snapshot(config, paths)
    const entry = entries.find((e) => e.name === skill)
    if (!entry) return { ok: false, message: `"${skill}" is not in your loadout.` }
    const source = entry.source
    const key = sourceKey(source)
    if (source.type === 'local' || key === null) {
      return { ok: false, message: `"${skill}" is not a GitHub or Tessl source.` }
    }
    if (source.type === 'github' && !startup.tools.git) return { ok: false, message: GIT_MISSING }
    if (source.type === 'tessl' && !startup.tools.tessl) {
      return { ok: false, message: TESSL_MISSING }
    }
    // A job, so no Update starts between `git fetch` and the reads after it.
    return asJob('Check', async () => {
      if (source.type === 'github') {
        checks[key] = await checkGithub(source.owner, source.repo, true)
      } else {
        await checkTessl(
          sources(entries)
            .map(([, e]) => e.source)
            .filter((s) => s.type === 'tessl'),
          true
        )
      }
      const check = checks[key]
      if (check.state === 'failed' || check.state === 'blocked') {
        return { ok: false, message: check.message ?? '' }
      }
      return { ok: true, check }
    })
  })

  handle('check-registry', async ({ skill }: { skill: string }) => {
    const { entries } = await snapshot(config, paths)
    const entry = entries.find((e) => e.name === skill)
    if (!entry) return { ok: false, message: `"${skill}" is not in your loadout.` }
    // An own skill names its plugin in its manifest; a Registry skill in its source.
    const ref: PluginRef | null =
      entry.source.type === 'tessl'
        ? entry.source
        : entry.source.type === 'local' && entry.status === 'ok'
          ? await readManifest(entry.target)
          : null
    if (!ref) {
      return {
        ok: false,
        message: `"${skill}" has no Tessl manifest in ${displayPath(entry.target, paths.home)}.`
      }
    }
    if (!startup.tools.tessl) return { ok: false, message: TESSL_MISSING }
    const key = `${ref.workspace}/${ref.plugin}`
    const follow = followUps.get(key)
    const looked = await lookupRegistry(ref, 'check', false, follow?.ref.version)
    if (looked.ok && looked.status.state !== 'pending') closeFollowUp(key)
    return looked
  })

  handle('check-all', () =>
    asJob('Check all', async (current) => {
      const all = sources((await snapshot(config, paths)).entries)
      for (const [key, entry] of all) {
        if (entry.source.type !== 'github') continue
        if (current.cancelled) current.skipped++
        else {
          checks[key] = await checkGithub(entry.source.owner, entry.source.repo, true)
          await pushState()
        }
      }
      const plugins = all.map(([, e]) => e.source).filter((s) => s.type === 'tessl')
      if (plugins.length > 0) {
        if (current.cancelled) current.skipped += plugins.length
        else await checkTessl(plugins, true)
      }
      if (current.cancelled) {
        return {
          ok: false,
          message: `Check all cancelled; ${current.skipped} sources not checked.`
        }
      }
      return { ok: true }
    })
  )

  handle('update-all', () =>
    asJob('Update all', async (current) => {
      const ready = sources((await snapshot(config, paths)).entries).filter(
        ([key]) => checks[key]?.state === 'ready'
      )
      if (ready.length === 0) {
        return { ok: false, message: 'No source is ready to update; press Check all first.' }
      }
      const updated: string[] = []
      const failed: string[] = []
      for (const [key, entry] of ready) {
        if (current.cancelled) {
          current.skipped++
          continue
        }
        const result = await updateSource(entry, true)
        if (result.ok) updated.push(...result.updated)
        else failed.push(key.slice(key.indexOf(':') + 1))
        await pushState()
      }
      if (current.cancelled) {
        return {
          ok: false,
          message: `Update all cancelled; ${current.skipped} sources not updated.`
        }
      }
      return { ok: true, updated, failed }
    })
  )

  handle('skill-diff', async ({ skill }: { skill: string }) => {
    const entry = (await snapshot(config, paths)).entries.find((e) => e.name === skill)
    if (!entry) return { ok: false, message: `"${skill}" is not in your loadout.` }
    const source = entry.source
    if (source.type !== 'github' || checks[sourceKey(source) ?? '']?.state !== 'ready') {
      return { ok: true, diff: '' }
    }
    const diffed = await query(
      diffArgs(join(paths.repos, source.owner, source.repo), source.subpath)
    )
    if (!diffed) return { ok: false, message: GIT_MISSING }
    if (diffed.code !== 0) {
      return { ok: false, message: `Diff failed: ${diffed.stderr.trim().split('\n')[0]}` }
    }
    return { ok: true, diff: diffed.stdout }
  })

  handle('cancel', async () => {
    if (job) job.cancelled = true
    abort?.abort()
    return { ok: true }
  })

  // The app update: outside BUSY_CHANNELS, so it never refuses or cancels a command.
  handle('update-download', async () => {
    const bundle = ownBundle()
    if (!appUpdate?.replace.ok || !bundle) {
      return { ok: false, message: 'Loadout cannot replace itself here.' }
    }
    if (appUpdate.stage !== 'offered' && appUpdate.stage !== 'failed') {
      return { ok: false, message: 'The update is already running.' }
    }
    updateAbort = new AbortController()
    setAppUpdate({ stage: 'downloading', percent: null, message: null })
    void downloadUpdate(bundle, appUpdate.latest, updateAbort.signal)
    return { ok: true }
  })

  handle('update-cancel', async () => {
    if (appUpdate?.stage === 'downloading' || appUpdate?.stage === 'checking') {
      updateAbort.abort()
    }
    return { ok: true }
  })

  handle('update-restart', async () => {
    const bundle = ownBundle()
    if (appUpdate?.stage !== 'ready' || !staged || !bundle) {
      return { ok: false, message: 'The update is not ready.' }
    }
    // A second RESTART before the window closes must not start a second swap script.
    if (quitting || swaps.length > 0) return { ok: false, message: QUITTING_MESSAGE }
    if (busy || job || startup.mustering || running.size > 0) {
      return { ok: false, message: BUSY_MESSAGE }
    }
    // Throws when the script cannot start; then Loadout does not quit.
    swaps.push(
      startSwap({
        dir: staged.dir,
        bundle,
        executable: staged.executable,
        args: process.argv.slice(1),
        env: process.env
      })
    )
    note('app-update', `Restarting into ${appUpdate.latest}.`, null)
    app.quit()
    return { ok: true }
  })
}

// These two hex values must equal `--bg` in src/renderer/src/app.css (light and dark).
function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#2a2a2a' : '#f4f1ea'
}

/**
 * Shows the window; in the background (tests) without activating Loadout, and parked in the
 * bottom-right corner so it does not cover the user's work. A corner stays on screen: macOS marks
 * a window that is fully off screen as occluded, and Chromium then hides the page.
 */
function reveal(target: BrowserWindow): void {
  if (BACKGROUND) {
    const area = screen.getPrimaryDisplay().workArea
    target.showInactive()
    // After the show: macOS moves a window that appears off screen back onto the screen.
    target.setPosition(area.x + area.width - 40, area.y + area.height - 40)
  } else target.show()
}

function createWindow(): void {
  const area = screen.getPrimaryDisplay().workAreaSize
  window = new BrowserWindow({
    width: Math.min(1430, area.width),
    height: Math.min(900, area.height),
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Loadout',
    titleBarStyle: 'hiddenInset',
    // x centres the 60 px button group on the 105 px rail (--rail-width in app.css).
    trafficLightPosition: { x: 22, y: 16 },
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  // A link in a SKILL.md must never replace the app (ADR 20261108-markdown-with-marked).
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (url.startsWith('https:')) void shell.openExternal(url)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.once('ready-to-show', () => window && reveal(window))
  // An edit made in another app shows when the user comes back (ADR 20261109-saved-reviews).
  window.on('focus', () => focusRead())
  // Logi Options+ sends a mouse's Back button as a macOS swipe, which reaches only main; Electron names it 'left'.
  window.on('swipe', (_event, direction) => {
    if (direction === 'left') window?.webContents.send('back')
  })
  window.on('closed', () => {
    window = null
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * The app update check, or the one in flight. A newer release sets `appUpdate` and pushes the
 * state; a later failed or up-to-date check leaves it.
 */
function runAppCheck(): Promise<Latest> {
  if (appCheck) return appCheck
  lastAppCheck = new Date()
  appCheck = checkLatest(curlPath(process.env), {
    env,
    cwd: paths.loadout,
    signal: appCheckAbort.signal
  })
    .then(async (latest) => {
      const newer = latest.ok ? newerRelease(__APP_VERSION__, latest.version) : null
      if (newer) {
        replaceCheck ??= canReplace(ownBundle())
        const replace = await replaceCheck
        appUpdate = mergeAppUpdate(appUpdate, newer, () => {
          // A failed swap shows once: a later TRY AGAIN that succeeds is not overwritten.
          const message = lastFailure
          lastFailure = null
          return { replace, stage: message ? 'failed' : 'offered', percent: null, message }
        })
        await pushState().catch(() => undefined)
      }
      return latest
    })
    .finally(() => {
      appCheck = null
    })
  return appCheck
}

/**
 * The bundle the update replaces: the running one in the packaged app (three levels above the
 * executable). `LOADOUT_UPDATE_BUNDLE` is test only: an unpackaged app has no bundle of its own.
 */
function ownBundle(): string | null {
  if (app.isPackaged) {
    const bundle = dirname(dirname(dirname(app.getPath('exe'))))
    return bundle.endsWith('.app') ? bundle : null
  }
  // No trailing slash: the swap script takes the bundle name with `${bundle##*/}`.
  return process.env.LOADOUT_UPDATE_BUNDLE?.replace(/\/+$/, '') || null
}

function setAppUpdate(change: Partial<AppUpdate>): void {
  if (appUpdate) appUpdate = { ...appUpdate, ...change }
  void pushState().catch(() => undefined)
}

/** DOWNLOAD: the download, the checks and the staging, outside `busy`, `job` and `running`. */
async function downloadUpdate(bundle: string, latest: string, signal: AbortSignal): Promise<void> {
  let outcome: Awaited<ReturnType<typeof prepareUpdate>>
  try {
    const dir = await newUpdateFolder(bundle)
    outcome = await prepareUpdate({
      curl: curlPath(process.env),
      url: downloadUrl(latest),
      dir,
      latest,
      env,
      signal,
      onProgress: (percent) => {
        if (appUpdate?.stage === 'downloading') setAppUpdate({ percent })
      },
      onChecking: () => setAppUpdate({ stage: 'checking', percent: null })
    })
    if (outcome.ok) staged = { dir, executable: outcome.executable }
  } catch (error) {
    outcome = { ok: false, message: (error as Error).message, cancelled: false }
  }
  // A job stopped by a quit writes nothing; the next start cleans up.
  if (appCheckAbort.signal.aborted) return
  if (outcome.ok) {
    setAppUpdate({ stage: 'ready', percent: null })
    note('app-update', `Update ${latest} is ready.`, null)
  } else if (outcome.cancelled) {
    setAppUpdate({ stage: 'offered', percent: null, message: null })
    note('app-update', 'Update cancelled.', null)
  } else {
    setAppUpdate({ stage: 'failed', percent: null, message: outcome.message })
    note('app-update', `Update failed: ${outcome.message}`, null)
  }
}

/**
 * A check with no user action: a failure writes one Log line and shows nothing in the window; a
 * known update asks LATER or UPDATE (ADR `20261116-app-update-prompt`).
 */
function quietCheck(): void {
  void runAppCheck().then((latest) => {
    if (appCheckAbort.signal.aborted) return
    if (!latest.ok) note('app-update', `Update check failed: ${latest.message}`, null)
    else if (appUpdate) window?.webContents.send('prompt-app-update')
  })
}

/** Arms the timer for the next 12:00 local time. */
function armNoonTimer(): void {
  clearTimeout(noonTimer)
  const now = new Date()
  noonTimer = setTimeout(noonCheck, nextNoon(now).getTime() - now.getTime())
}

/** The daily check at 12:00 (ADR `20261114-app-update-noon-check`), then the next timer. */
function noonCheck(): void {
  if (appCheckAbort.signal.aborted) return
  if (appUpdate === null && lastAppCheck && noonDue(new Date(), lastAppCheck)) quietCheck()
  armNoonTimer()
}

/**
 * One check per launch, after READY, then the daily noon check: only in the packaged app, or with
 * the test switch.
 */
function launchCheck(): void {
  if (!app.isPackaged && process.env.LOADOUT_UPDATE_CHECK !== '1') return
  quietCheck()
  armNoonTimer()
  // macOS stops the app's timers while the Mac sleeps, so a missed 12:00 is caught on wake. The
  // wait gives Wi-Fi time to reconnect; noonCheck then arms the timer for the next 12:00.
  powerMonitor.on('resume', () => {
    clearTimeout(noonTimer)
    noonTimer = setTimeout(noonCheck, WAKE_DELAY_MS)
  })
}

/** Loadout › Check for Updates…: the update dialog while a newer release is known, else a box. */
async function menuCheck(): Promise<void> {
  const latest = await runAppCheck()
  if (appCheckAbort.signal.aborted) return
  if (appUpdate) {
    await pushState().catch(() => undefined)
    window?.webContents.send('open-app-update')
    return
  }
  const options = latest.ok
    ? {
        type: 'info' as const,
        message: 'Loadout is up to date.',
        detail: `You have ${__APP_VERSION__}, the latest release.`,
        buttons: ['OK']
      }
    : {
        type: 'warning' as const,
        message: 'The update check failed.',
        detail: latest.message,
        buttons: ['OK']
      }
  if (window) await dialog.showMessageBox(window, options)
  else await dialog.showMessageBox(options)
}

/** Electron's default menu, with Toggle Developer Tools in View only in development (`pnpm dev`). */
function setMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      // The role's own app menu, with Check for Updates… after About.
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { label: 'Check for Updates…', click: () => void menuCheck() },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as const]),
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      { role: 'windowMenu' },
      { role: 'help', submenu: [] }
    ])
  )
}

async function start(): Promise<void> {
  if (!app.isPackaged && process.platform === 'darwin') {
    app.dock?.setIcon(join(__dirname, '../../design/icon.png'))
  }
  // The menu labels read app.name, which comes from package.json's lower-case "name". Set it here,
  // not as a package.json productName: that would also move the user-data folder.
  app.setName('Loadout')
  setMenu()
  // An empty build version stops the About panel from showing "Version 0.1.0 (0.1.0)".
  app.setAboutPanelOptions({ applicationVersion: app.getVersion(), version: '' })
  try {
    await ensureLoadout(paths)
    config = await readConfig(paths)
  } catch (error) {
    dialog.showErrorBox(
      'Loadout cannot start',
      error instanceof Error ? error.message : String(error)
    )
    app.quit()
    return
  }
  nativeTheme.themeSource = config.appearance
  registerHandlers()
  nativeTheme.on('updated', () => window?.setBackgroundColor(windowBackground()))
  createWindow()
  // The page keeps only the Log lines it receives live, and muster() can end before it has loaded.
  const loaded = new Promise<void>((resolve) =>
    window?.webContents.once('did-finish-load', () => resolve())
  )
  // The launch check runs here, not in muster(): Refresh also calls muster(). It waits for the
  // page, as the lines of a past update's swap log do, so they reach the Log page.
  void muster().then(async (ok) => {
    if (!ok) return
    void tesslSelfUpdate()
    await loaded
    const bundle = ownBundle()
    if (bundle) {
      const finished = await finishUpdate(bundle)
      for (const line of finished.lines) note('app-update', line, null)
      lastFailure = finished.failure
    }
    launchCheck()
  })
}

/**
 * The launch's one `tessl` call that may update Tessl (src/main/tesslupdate.ts): outside `busy`
 * and `running`, with no cancel, so neither a command nor a quit stops an update half-way. When it
 * ends, the TESSL row reads the version again.
 */
async function tesslSelfUpdate(): Promise<void> {
  const tessl = startup.tools.tessl
  if (!tessl) return
  // The run reaches the Log page only when Tessl really updates; a launch without one logs nothing.
  let id: number | null = null
  const held: { stream: 'stdout' | 'stderr'; line: string }[] = []
  try {
    const result = await runTesslUpdate({
      tessl: tessl.path,
      env: updateEnv(env, process.env),
      cwd: paths.loadout,
      logFile: join(paths.home, '.tessl', 'auto-update.log'),
      onStart: () => {
        const runIdNow = ++runId
        id = runIdNow
        send({ runId: runIdNow, action: 'tessl-update', command: `${tessl.path} whoami` })
        send({ runId: runIdNow, stream: 'meta', line: 'Tessl is updating itself.' })
        for (const { stream, line } of held) send({ runId: runIdNow, stream, line })
        tesslUpdating = true
        void pushState()
      },
      onLine: (stream, line) => {
        if (id === null) held.push({ stream, line })
        else send({ runId: id, stream, line })
      }
    })
    if (id !== null) {
      if (result.timedOut) send({ runId: id, stream: 'meta', line: 'timed out' })
      if (result.code !== null) send({ runId: id, exit: result.code })
      else send({ runId: id, exit: null, stopped: result.timedOut ? 'timed-out' : 'failed' })
    }
  } finally {
    tesslUpdating = false
  }
  // A Refresh during the call owns `startup`; it reads the version itself.
  if (!startup.mustering && startup.tools.tessl?.path === tessl.path) {
    const version = await toolVersion(tessl.path, env, paths.loadout)
    if (version !== null && !startup.mustering && startup.tools.tessl?.path === tessl.path) {
      startup = { ...startup, tools: { ...startup.tools, tessl: { path: tessl.path, version } } }
    }
  }
  await pushState().catch(() => undefined)
}

/**
 * The tool check, with the window already open; the page shows MUSTERING until it ends. False when
 * it failed and Loadout quits.
 */
async function muster(): Promise<boolean> {
  startup = { ...startup, mustering: true }
  // A failed state read (an unreadable folder) shows in the page as a failed load with Refresh;
  // the tool check still runs, so MUSTERING ends and Refresh can recover.
  await pushState().catch(() => undefined)
  try {
    const checked = await startupCheck(config, paths, process.env, fallbackDirsFrom(process.env))
    startup = checked.startup
    env = checked.env
  } catch (error) {
    dialog.showErrorBox(
      'Loadout cannot start',
      error instanceof Error ? error.message : String(error)
    )
    app.quit()
    return false
  }
  await pushState().catch(() => undefined)
  return true
}

void app.whenReady().then(start)

app.on('window-all-closed', () => {
  app.quit()
})

/**
 * Quitting while a command runs: cancel it as Cancel does, wait until every busy handler has
 * finished its cleanup (a Fix records its copy, an install removes its links), then quit. The
 * child runs in its own process group, so it would outlive Loadout if Loadout did not stop it.
 */
app.on('before-quit', (event) => {
  updateAbort.abort()
  appCheckAbort.abort()
  clearTimeout(noonTimer)
  if (running.size === 0) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  for (const key of [...followUps.keys()]) closeFollowUp(key)
  if (job) job.cancelled = true
  abort?.abort()
  void Promise.allSettled([...running]).then(() => app.quit())
})
