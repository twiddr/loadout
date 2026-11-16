import {
  chmod,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  utimes
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { readAgentFolder, type Unmanaged } from '../core/agents'
import { agentFolder, type Agent, type Config } from '../core/config'
import type { CandidateDetail, Result } from '../core/ipc'
import { displayPath, type Paths } from '../core/paths'
import {
  backupPath,
  describeStep,
  differenceLines,
  LOADOUT_LINK,
  planRecruit,
  planUndo,
  rowStatus,
  type Backup,
  type EntryFacts,
  type Preview,
  type Recruited,
  type Step,
  type UnmanagedRow
} from '../core/recruit'
import { sizeText } from '../core/size'
import { readSkillFolder } from '../core/skill'
import { frontmatterName, validateSkillFolder } from '../core/validate'
import { applyOps, inBackups, snapshot, type Snapshot } from './disk'

export type { Backup, Preview, Recruited }

export interface Compared {
  same: boolean
  files: number
  differ: string[]
  onlyA: string[]
  onlyB: string[]
}

export async function readFacts(agent: Agent, item: Unmanaged, paths: Paths): Promise<EntryFacts> {
  const path = join(agentFolder(agent, paths), item.name)
  let hasSkillMd = false
  let skillName: string | null = null
  if (item.kind !== 'file' && !item.dangling) {
    try {
      skillName = frontmatterName(await readFile(join(path, 'SKILL.md'), 'utf8'))
      hasSkillMd = true
    } catch {
      // No readable SKILL.md: the row status says so.
    }
  }
  return {
    agentId: item.agentId,
    entry: item.name,
    path,
    kind: item.kind,
    target: item.target === null ? null : item.target.replace(/(?<=.)\/+$/, ''),
    dangling: item.dangling,
    hasSkillMd,
    skillName
  }
}

/** `to` must not exist. Every name is copied, `.git` included, with modes and times kept. */
export async function copyExact(from: string, to: string): Promise<void> {
  await mkdir(to)
  await copyInto(from, to)
}

/** Fills `to`, an empty folder the caller just created, so a failure never leaves a folder Loadout did not make. */
async function copyInto(from: string, to: string): Promise<void> {
  for (const name of await readdir(from)) {
    await cp(join(from, name), join(to, name), {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true
    })
  }
  const info = await stat(from)
  await chmod(to, info.mode & 0o7777)
  await utimes(to, info.atime, info.mtime)
}

const IGNORED = new Set(['.DS_Store', '__pycache__'])

type Node =
  { kind: 'file'; path: string; exec: boolean } | { kind: 'folder' } | { kind: 'link'; to: string }

/** Relative path to node, for every path under `root` without an ignored segment. */
async function walk(
  root: string,
  rel = '',
  out = new Map<string, Node>()
): Promise<Map<string, Node>> {
  for (const name of await readdir(join(root, rel))) {
    if (IGNORED.has(name)) continue
    const child = rel ? `${rel}/${name}` : name
    const full = join(root, child)
    const info = await lstat(full)
    if (info.isDirectory()) {
      out.set(child, { kind: 'folder' })
      await walk(root, child, out)
    } else if (info.isSymbolicLink()) {
      out.set(child, { kind: 'link', to: await readlink(full) })
    } else {
      out.set(child, { kind: 'file', path: full, exec: (info.mode & 0o100) !== 0 })
    }
  }
  return out
}

export async function compareFolders(a: string, b: string): Promise<Compared> {
  const [left, right] = await Promise.all([walk(a), walk(b)])
  const result: Compared = { same: true, files: 0, differ: [], onlyA: [], onlyB: [] }
  for (const [rel, x] of left) {
    if (x.kind === 'file') result.files++
    const y = right.get(rel)
    if (!y) {
      result.onlyA.push(rel)
    } else if (x.kind !== y.kind) {
      result.differ.push(rel)
    } else if (x.kind === 'file' && y.kind === 'file') {
      const same = x.exec === y.exec && (await readFile(x.path)).equals(await readFile(y.path))
      if (!same) result.differ.push(rel)
    } else if (x.kind === 'link' && y.kind === 'link' && x.to !== y.to) {
      result.differ.push(rel)
    }
  }
  for (const rel of right.keys()) if (!left.has(rel)) result.onlyB.push(rel)
  for (const list of [result.differ, result.onlyA, result.onlyB]) list.sort()
  result.same = !result.differ.length && !result.onlyA.length && !result.onlyB.length
  return result
}

/** Relative paths of the symlinks under `folder`, sorted; [] when none. */
export async function linksInside(folder: string): Promise<string[]> {
  const found: string[] = []
  async function visit(rel: string): Promise<void> {
    for (const name of await readdir(join(folder, rel))) {
      const child = rel ? `${rel}/${name}` : name
      const info = await lstat(join(folder, child))
      if (info.isSymbolicLink()) found.push(child)
      else if (info.isDirectory()) await visit(child)
    }
  }
  await visit('')
  return found.sort()
}

/** Sorted by agent id, then entry; dot-names and plain files are skipped. */
export async function listBackups(paths: Paths): Promise<Backup[]> {
  const backups: Backup[] = []
  const agents = await readdir(paths.backups, { withFileTypes: true }).catch(() => [])
  for (const agent of agents) {
    if (agent.name.startsWith('.') || !agent.isDirectory()) continue
    const folder = join(paths.backups, agent.name)
    for (const name of await readdir(folder)) {
      if (name.startsWith('.')) continue
      const info = await lstat(join(folder, name))
      if (info.isSymbolicLink()) backups.push({ agentId: agent.name, entry: name, kind: 'link' })
      else if (info.isDirectory())
        backups.push({ agentId: agent.name, entry: name, kind: 'folder' })
    }
  }
  const order = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0)
  return backups.sort((x, y) => order(x.agentId, y.agentId) || order(x.entry, y.entry))
}

/** readFacts and rowStatus for each unmanaged entry of a snapshot. */
export async function recruitRows(
  snap: Snapshot,
  config: Config,
  paths: Paths
): Promise<UnmanagedRow[]> {
  const libraryNames = snap.entries.map((e) => e.name)
  return Promise.all(
    snap.unmanaged.map(async (item) => {
      const agent = config.agents.find((a) => a.id === item.agentId)
      if (!agent) return { ...item, recruit: { kind: 'none' as const } }
      const facts = await readFacts(agent, item, paths)
      return { ...item, recruit: rowStatus(facts, config.agents, libraryNames, paths) }
    })
  )
}

type Log = (line: string) => void
/** Test seam: called before each step with the step; a test changes the disk there to make the step fail. */
type Hooks = { before?: (step: Step) => Promise<void> }

const LABELS: Record<Step['op'], string> = {
  copy: 'Copy',
  verify: 'Verify',
  add: 'Add',
  move: 'Move',
  link: 'Link',
  unlink: 'Unlink'
}

const failure = (message: string): { ok: false; message: string } => ({ ok: false, message })
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
/** errorText with each path under the home shown from `~`, for a message passed through as it is. */
const shownError = (error: unknown, home: string): string =>
  errorText(error).replaceAll(`${home}/`, '~/')

/** `<Step> failed: <system message> at <path>.` */
function failedText(label: string, error: unknown, path: string, home: string): string {
  return `${label} failed: ${errorText(error).split(', ')[0]} at ${displayPath(path, home)}.`
}

/** The path a failed step names: the file a copy or a compare could not read, else the step's own path. */
function stepPath(step: Step, error: unknown, paths: Paths): string {
  const at = (error as NodeJS.ErrnoException).path
  switch (step.op) {
    case 'copy':
      return at ?? step.from
    case 'verify':
      return at ?? step.a
    case 'add':
      return join(paths.library, step.name)
    case 'move':
      return step.from
    case 'link':
    case 'unlink':
      return step.path
  }
}

/** `a`, `a and b`, `a, b and c`. */
function list(items: string[]): string {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** False only when nothing is at `path`; any other lstat error is thrown. */
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * The only rename in this file. `rename` replaces a file, a link or an empty folder without an error,
 * so it runs only while nothing is at `to`. Creates the parent of `to`. False when `to` exists.
 */
async function moveTo(from: string, to: string): Promise<boolean> {
  await mkdir(dirname(to), { recursive: true })
  if (await exists(to)) return false
  await rename(from, to)
  return true
}

function checkIds(agentId: string, entry: string, config: Config): Result<{ agent: Agent }> {
  const agent = config.agents.find((a) => a.id === agentId)
  if (!agent) return failure(`Unknown agent "${agentId}".`)
  if (entry === '' || entry === '.' || entry === '..' || entry.includes('/')) {
    return failure(`"${entry}" is not an entry name.`)
  }
  return { ok: true, agent }
}

/** `1 file` or `<n> files`. */
const fileCount = (n: number): string => (n === 1 ? '1 file' : `${n} files`)

/** `<n> files · <size>` of every file under `folder`, `.git` included. */
async function folderSize(folder: string): Promise<string> {
  let bytes = 0
  let files = 0
  for (const rel of await readdir(folder, { recursive: true })) {
    const info = await lstat(join(folder, rel))
    if (info.isFile()) {
      bytes += info.size
      files++
    }
  }
  return `${fileCount(files)} · ${sizeText(bytes)}`
}

/** The nearest folder from the resolved `folder` up to the home folder that holds `.git`; null when none. */
async function repoAbove(folder: string, paths: Paths): Promise<string | null> {
  const home = await realpath(paths.home)
  const under = (dir: string): boolean => dir === home || dir.startsWith(`${home}/`)
  for (let dir = await realpath(folder); under(dir); dir = dirname(dir)) {
    if (await exists(join(dir, '.git'))) return paths.home + dir.slice(home.length)
  }
  return null
}

interface Prepared {
  agent: Agent
  facts: EntryFacts
  /** The skill name; null for a dangling link. */
  name: string | null
  folder: string
  steps: Step[]
  preview: Preview
}

/** Step 0 for the preview and the run: the same reads, the same refusals, the same plan. Writes nothing. */
async function prepare(
  agentId: string,
  entry: string,
  parent: string | null,
  config: Config,
  paths: Paths
): Promise<Result<Prepared>> {
  const checked = checkIds(agentId, entry, config)
  if (!checked.ok) return checked
  const { agent } = checked
  const shown = (path: string): string => displayPath(path, paths.home)
  const snap = await snapshot(config, paths)
  const item = snap.unmanaged.find((u) => u.agentId === agent.id && u.name === entry)
  if (!item) {
    return failure(
      `No unmanaged entry at ${shown(join(agentFolder(agent, paths), entry))}. Press Rescan.`
    )
  }
  const facts = await readFacts(agent, item, paths)
  const names = snap.entries.map((e) => e.name)
  const status = rowStatus(facts, config.agents, names, paths)
  // The raw folder, not the snapshot's: there, Loadout's own link whose library entry is gone shows
  // as unmanaged, and planRecruit would call it something Loadout did not create.
  const folder = await readAgentFolder(agent, paths)
  if (status.kind === 'recruit' && status.mode === 'copy' && parent !== null) {
    // planRecruit compares the paths as written; a link to an agent folder or into ~/.loadout is refused here.
    const real = (path: string): Promise<string> => realpath(path).catch(() => path)
    const roots = await Promise.all(
      [...config.agents.map((a) => agentFolder(a, paths)), paths.loadout].map(real)
    )
    const picked = await real(parent)
    if (roots.some((root) => picked === root || picked.startsWith(`${root}/`))) {
      return failure('Pick a folder outside the agent folders and ~/.loadout.')
    }
  }
  const devices = {
    agent: (await stat(folder.folder)).dev,
    loadout: (await stat(paths.loadout)).dev
  }
  const plan = planRecruit({
    facts,
    status,
    agent,
    parent,
    library: snap.entries,
    folder,
    agents: config.agents,
    devices,
    paths
  })
  if (!plan.ok) return plan
  const { mode, steps } = plan
  const name = status.kind === 'recruit' ? status.name : null

  if ((mode === 'copy' || mode === 'library') && facts.kind === 'folder') {
    const links = await linksInside(facts.path)
    if (links.length) {
      return failure(
        `Recruit cannot copy "${entry}", because it holds symlinks: ${links.join(', ')}. Replace each link with a regular file or folder, then try again.`
      )
    }
  }
  if (mode === 'copy' && parent !== null && name !== null && (await exists(join(parent, name)))) {
    return failure(`${shown(join(parent, name))} already exists. Pick another folder.`)
  }
  const backup = backupPath(agent.id, entry, paths)
  if (await exists(backup)) {
    return failure(
      `A backup of ${shown(facts.path)} already exists at ${shown(backup)}. Undo it, or move it out of ~/.loadout/backups, then try again.`
    )
  }
  if (mode === 'in-place') {
    // rowStatus compares the link as written; a link that only resolves into ~/.loadout is refused here.
    const source = facts.target ?? facts.path
    const refusal = await inBackups(source, paths)
    if (refusal) return refusal
    const real = await realpath(source).catch(() => source)
    const loadout = await realpath(paths.loadout).catch(() => paths.loadout)
    if (real === loadout || real.startsWith(`${loadout}/`)) return failure(LOADOUT_LINK)
    const valid = await validateSkillFolder(source, names)
    if (!valid.ok) return valid
  }
  if (mode === 'library') {
    // Once the entry moves, a loadout entry whose source is the entry (its path as linked, or for a
    // folder its real path) would link the agent folder to itself. A link entry moves without its
    // target, so a loadout entry that shares only the target is fine.
    const linked = snap.entries.find((e) => e.name === name)?.target ?? ''
    const under = (path: string, root: string): boolean =>
      path === root || path.startsWith(`${root}/`)
    const loops =
      under(linked, facts.path) ||
      (facts.kind === 'folder' && under(await realpath(linked), await realpath(facts.path)))
    if (loops) {
      return failure(
        `"${name}" in your loadout is linked to this folder. Decommission the skill on the Loadout page, then recruit this folder.`
      )
    }
  }

  const notes: string[] = []
  if (name !== null && name !== entry) {
    notes.push(
      `The folder is named ${entry}, but the skill's name is ${name}. Loadout uses the skill's name for its links. Your agent can list the skill as ${name} from now on.`
    )
  }
  if (mode === 'copy' && (await exists(join(facts.path, '.git')))) {
    notes.push(
      'This folder is a git repository. The copy keeps its history. Loadout runs no git command.'
    )
  }
  const repo = await repoAbove(folder.folder, paths)
  if (repo !== null) {
    notes.push(
      `${shown(folder.folder)} is inside a git repository at ${shown(repo)}; git there will show ${entry} as changed.`
    )
  }
  let inLoadout: string | null = mode === 'backup' ? null : 'no'
  let more: string[] = []
  if (mode === 'library') {
    const target = snap.entries.find((e) => e.name === name)?.target ?? ''
    const compared = await compareFolders(facts.path, target)
    const lines = differenceLines(compared, shown(facts.path), shown(target))
    if (compared.same) {
      inLoadout = 'yes · same content'
      notes.push(
        'Your loadout already has this skill with the same content. Loadout will not make another copy.'
      )
    } else {
      inLoadout = `yes · ${fileCount(lines.length)} ${lines.length === 1 ? 'differs' : 'differ'}`
      more = lines.slice(20)
      notes.push(
        'Your copy differs from the one in your loadout:',
        ...lines.slice(0, 20),
        ...(lines.length > 20 ? [`and ${lines.length - 20} more`] : []),
        `If you continue, ${agent.label} uses the loadout's copy. Your copy moves to the backup, unchanged.`
      )
    }
  }
  if (mode === 'copy') {
    notes.push(
      'Did this skill come from GitHub? Cancel, add it with Recruit skill › Link, and open this again: you can then switch to that copy.'
    )
  }

  const found = shown(facts.path) + (facts.target === null ? '' : ` → ${shown(facts.target)}`)
  return {
    ok: true,
    agent,
    facts,
    name,
    folder: folder.folder,
    steps,
    preview: {
      mode,
      facts: {
        found,
        skill: name,
        size: mode === 'copy' || mode === 'library' ? await folderSize(facts.path) : null,
        inLoadout
      },
      notes,
      needsFolder: mode === 'copy' && parent === null,
      steps: steps.map((step) => describeStep(step, paths.home)),
      more
    }
  }
}

export async function previewRecruit(
  agentId: string,
  entry: string,
  parent: string | null,
  config: Config,
  paths: Paths
): Promise<Result<Preview>> {
  try {
    const prepared = await prepare(agentId, entry, parent, config, paths)
    return prepared.ok ? { ok: true, ...prepared.preview } : prepared
  } catch (error) {
    return failure(shownError(error, paths.home))
  }
}

/** The folder of a RECRUIT row (a link's target), read-only, for the Recon VIEW page. */
export async function candidateDetail(
  agentId: string,
  entry: string,
  config: Config,
  paths: Paths
): Promise<Result<{ detail: CandidateDetail }>> {
  try {
    const checked = checkIds(agentId, entry, config)
    if (!checked.ok) return checked
    const { agent } = checked
    const snap = await snapshot(config, paths)
    const item = snap.unmanaged.find((u) => u.agentId === agent.id && u.name === entry)
    if (!item) {
      return failure(
        `No unmanaged entry at ${displayPath(join(agentFolder(agent, paths), entry), paths.home)}. Press Rescan.`
      )
    }
    const facts = await readFacts(agent, item, paths)
    const names = snap.entries.map((e) => e.name)
    if (rowStatus(facts, config.agents, names, paths).kind !== 'recruit') {
      return failure(`"${entry}" is not a recruit candidate.`)
    }
    return { ok: true, detail: await readSkillFolder(facts.target ?? facts.path) }
  } catch (error) {
    return failure(shownError(error, paths.home))
  }
}

/** What this run made, so a failure removes exactly that. */
interface Made {
  copy?: string
  library?: { path: string; target: string }
  moved?: { from: string; to: string }
}

/** Undoes `made` in reverse (original back, library link, working copy) and adds what it did to `problem`. */
async function cleanUp(problem: string, made: Made, paths: Paths, log: Log): Promise<string> {
  const shown = (path: string): string => displayPath(path, paths.home)
  const done: string[] = []
  const failed: string[] = []
  let inBackup = false
  if (made.moved) {
    const { from, to } = made.moved
    try {
      if (await moveTo(to, from)) {
        done.push(`moved your original back to ${shown(from)}`)
        log(`Moved your original back to ${shown(from)}.`)
      } else {
        inBackup = true
        failed.push(`${shown(from)} is in use, so Loadout could not move your original back.`)
      }
    } catch (error) {
      inBackup = true
      failed.push(failedText('Move', error, to, paths.home))
    }
  }
  if (made.library) {
    const { path, target } = made.library
    try {
      await applyOps([{ op: 'unlink', path, target }])
      done.push(`removed ${shown(path)}`)
      log(`Removed ${shown(path)}.`)
    } catch (error) {
      failed.push(shownError(error, paths.home))
    }
  }
  if (made.copy) {
    try {
      await rm(made.copy, { recursive: true, force: true })
      done.push('deleted the copy')
      log(`Deleted the copy in ${shown(made.copy)}.`)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      failed.push(
        code === 'EACCES' || code === 'EPERM'
          ? `Loadout could not delete the copy in ${shown(made.copy)}: it holds a read-only folder, as your original does. Delete the copy by hand.`
          : failedText('Delete', error, made.copy, paths.home)
      )
    }
  }
  const said = done.length ? `Loadout ${list(done)}` : ''
  if (!failed.length) {
    return `${problem} ${said ? `${said}; nothing else changed.` : 'Nothing changed.'}`
  }
  const parts = [problem, ...(said ? [`${said}.`] : []), ...failed]
  if (inBackup && made.moved) {
    parts.push(`Your original is in ${shown(made.moved.to)}; UNDO on the Recon page puts it back.`)
  }
  return parts.join(' ')
}

/** `<agent link> → <library link> → <library target>`, read back from disk; null when a link cannot be read. */
async function readChain(link: string, paths: Paths): Promise<string | null> {
  try {
    const own = resolve(dirname(link), await readlink(link))
    const target = resolve(dirname(own), await readlink(own))
    return [link, own, target].map((path) => displayPath(path, paths.home)).join(' → ')
  } catch {
    return null
  }
}

/** `shown`: the notes and then the step sentences of the preview the user confirmed. */
export async function runRecruit(
  agentId: string,
  entry: string,
  parent: string | null,
  shown: string[],
  config: Config,
  paths: Paths,
  log: Log,
  hooks: Hooks = {}
): Promise<Result<Recruited>> {
  const display = (path: string): string => displayPath(path, paths.home)
  let prepared: Result<Prepared>
  try {
    prepared = await prepare(agentId, entry, parent, config, paths)
  } catch (error) {
    return failure(shownError(error, paths.home))
  }
  if (!prepared.ok) return prepared
  const { agent, facts, name, folder, steps, preview } = prepared
  const expected = [...preview.notes, ...preview.steps, ...preview.more]
  if (expected.length !== shown.length || expected.some((line, i) => line !== shown[i])) {
    return failure(`${display(facts.path)} changed after the preview. Open Recruit again.`)
  }
  if (preview.needsFolder) return failure('No folder picked.')

  const made: Made = {}
  let files: number | null = null
  for (const step of steps) {
    let problem: string | null = null
    try {
      await hooks.before?.(step)
      switch (step.op) {
        case 'copy':
          await mkdir(step.to)
          made.copy = step.to
          await copyInto(step.from, step.to)
          log(`Copied ${display(step.from)} to ${display(step.to)}.`)
          break
        case 'verify': {
          const compared = await compareFolders(step.a, step.b)
          if (!compared.same) {
            const first = differenceLines(compared, display(step.a), display(step.b))[0]
            problem = `The copy in ${display(step.b)} is not identical to ${display(step.a)}: ${first}.`
            break
          }
          files = compared.files
          log(`Verified: ${fileCount(files)}, identical.`)
          break
        }
        case 'add': {
          const path = join(paths.library, step.name)
          await symlink(step.target, path, 'dir')
          made.library = { path, target: step.target }
          log(`Added ${step.name} to your loadout, linked to ${display(step.target)}.`)
          break
        }
        case 'move':
          if (!(await moveTo(step.from, step.to))) {
            problem = `A backup of ${display(step.from)} already exists at ${display(step.to)}. Undo it, or move it out of ~/.loadout/backups, then try again.`
            break
          }
          made.moved = { from: step.from, to: step.to }
          log(`Moved your original from ${display(step.from)} to ${display(step.to)}.`)
          break
        case 'link':
          await symlink(join(paths.library, step.name), step.path, 'dir')
          log(
            `Linked ${display(step.path)} to your loadout's ${step.name}, so ${step.label} keeps loading the skill.`
          )
          break
      }
    } catch (error) {
      problem = failedText(LABELS[step.op], error, stepPath(step, error, paths), paths.home)
    }
    if (problem !== null) return failure(await cleanUp(problem, made, paths, log))
  }

  return {
    ok: true,
    name,
    files,
    backup: display(backupPath(agent.id, facts.entry, paths)),
    chain: name === null ? null : await readChain(join(folder, name), paths)
  }
}

/** The backup, the skill name read from it and the planUndo steps. Writes nothing. */
async function prepareUndo(
  agentId: string,
  entry: string,
  config: Config,
  paths: Paths
): Promise<Result<{ name: string | null; path: string; steps: Step[]; dangling: boolean }>> {
  const checked = checkIds(agentId, entry, config)
  if (!checked.ok) return checked
  const { agent } = checked
  const folder = await readAgentFolder(agent, paths)
  const path = join(folder.folder, entry)
  const backup = backupPath(agent.id, entry, paths)
  const none = failure(`No backup of ${displayPath(path, paths.home)}.`)
  let info
  try {
    info = await lstat(backup)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return none
    throw error
  }
  if (!info.isDirectory() && !info.isSymbolicLink()) return none
  // A link is read as if it were back in the agent folder (its real path), so a relative target resolves as before the move.
  const target = info.isSymbolicLink()
    ? resolve(await realpath(folder.folder).catch(() => folder.folder), await readlink(backup))
    : backup
  const dangling = await stat(target).then(
    () => false,
    () => true
  )
  const name = await readFile(join(target, 'SKILL.md'), 'utf8').then(frontmatterName, () => null)
  const plan = planUndo({ agent, entry, name, folder, paths })
  if (!plan.ok) return plan
  return { ok: true, name, path, steps: plan.steps, dangling }
}

export async function previewUndo(
  agentId: string,
  entry: string,
  config: Config,
  paths: Paths
): Promise<Result<{ steps: string[]; dangling: boolean }>> {
  try {
    const prepared = await prepareUndo(agentId, entry, config, paths)
    if (!prepared.ok) return prepared
    return {
      ok: true,
      steps: prepared.steps.map((step) => describeStep(step, paths.home)),
      dangling: prepared.dangling
    }
  } catch (error) {
    return failure(shownError(error, paths.home))
  }
}

export async function runUndo(
  agentId: string,
  entry: string,
  config: Config,
  paths: Paths,
  log: Log,
  hooks: Hooks = {}
): Promise<Result<{ path: string; off: string | null }>> {
  const display = (path: string): string => displayPath(path, paths.home)
  let prepared: Awaited<ReturnType<typeof prepareUndo>>
  try {
    prepared = await prepareUndo(agentId, entry, config, paths)
  } catch (error) {
    return failure(shownError(error, paths.home))
  }
  if (!prepared.ok) return prepared

  let unlinked: { path: string; target: string } | null = null
  for (const step of prepared.steps) {
    let problem: string | null = null
    try {
      await hooks.before?.(step)
      if (step.op === 'unlink') {
        await applyOps([{ op: 'unlink', path: step.path, target: step.target }])
        unlinked = step
        log(`Removed Loadout's link ${display(step.path)}.`)
      } else if (step.op === 'move') {
        if (await moveTo(step.from, step.to)) {
          log(`Moved your original from ${display(step.from)} back to ${display(step.to)}.`)
        } else {
          problem = `${display(step.to)} is in use, so Loadout cannot put your original back there. Move it away, then press Undo again.`
        }
      }
    } catch (error) {
      problem =
        step.op === 'unlink'
          ? shownError(error, paths.home)
          : failedText(LABELS[step.op], error, stepPath(step, error, paths), paths.home)
    }
    if (problem === null) continue
    if (unlinked) {
      try {
        await symlink(unlinked.target, unlinked.path, 'dir')
        log(`Put back Loadout's link ${display(unlinked.path)}.`)
        problem += ` Loadout put back its link ${display(unlinked.path)}.`
      } catch (error) {
        problem += ` ${failedText('Link', error, unlinked.path, paths.home)}`
      }
    }
    return failure(problem)
  }
  return { ok: true, path: display(prepared.path), off: unlinked ? prepared.name : null }
}
