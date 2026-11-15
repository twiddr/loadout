import {
  access,
  lstat,
  mkdir,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  unlink
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AgentFolder, Unmanaged } from '../core/agents'
import { readAgentFolder } from '../core/agents'
import { DEFAULT_CONFIG, writeConfig, type Config } from '../core/config'
import { sourceKey } from '../core/checks'
import type { Entry, PackRefusal, Result } from '../core/ipc'
import { classifyTarget, readLibrary } from '../core/library'
import { scanSkills } from '../core/scan'
import { displayPath, type Paths } from '../core/paths'
import { agentRefusal, planToggle, type Op } from '../core/planner'
import { validateSkillFolder } from '../core/validate'

/** Creates paths.loadout, paths.library, paths.repos and writes DEFAULT_CONFIG when paths.config is absent. */
export async function ensureLoadout(paths: Paths): Promise<void> {
  await mkdir(paths.loadout, { recursive: true })
  await mkdir(paths.library, { recursive: true })
  await mkdir(paths.repos, { recursive: true })
  try {
    await access(paths.config)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await writeConfig(paths, DEFAULT_CONFIG)
  }
}

const OP_NAMES = { mkdir: 'Mkdir', link: 'Link', unlink: 'Unlink' } as const

/**
 * The absolute target of the link at `path`, or null when `path` is not a symlink. A relative target
 * resolves against the real path of the link's folder, as readAgentFolder reads it.
 */
async function linkTarget(path: string): Promise<string | null> {
  if (!(await lstat(path)).isSymbolicLink()) return null
  const raw = await readlink(path)
  return isAbsolute(raw) ? raw : resolve(await realpath(dirname(path)), raw)
}

/**
 * Applies in order; stops at the first failure with Error(`<Op> failed: <system message> at <path>.`).
 * An unlink first checks that the path is still the link the plan read, so an entry that replaced
 * it after the read is never deleted. The check and the unlink are two steps, not one atomic step.
 */
export async function applyOps(ops: Op[]): Promise<void> {
  for (const op of ops) {
    try {
      if (op.op === 'mkdir') await mkdir(op.path, { recursive: true })
      else if (op.op === 'link') await symlink(op.target, op.path, 'dir')
      else {
        if ((await linkTarget(op.path)) !== op.target) {
          throw new Error(
            `Unlink refused: ${op.path} changed after Loadout read it, so Loadout left it as it is. Try again.`
          )
        }
        await unlink(op.path)
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Unlink refused:')) throw error
      const text = error instanceof Error ? error.message : String(error)
      throw new Error(`${OP_NAMES[op.op]} failed: ${text.split(', ')[0]} at ${op.path}.`, {
        cause: error
      })
    }
  }
}

export interface Snapshot {
  entries: Entry[]
  unmanaged: Unmanaged[]
  folders: AgentFolder[]
}

/** readLibrary + readAgentFolder for every config agent (enabled or not); enabledFor lists agent ids with a managed link. */
export async function snapshot(config: Config, paths: Paths): Promise<Snapshot> {
  const library = await readLibrary(paths)
  const read = await Promise.all(config.agents.map((agent) => readAgentFolder(agent, paths)))
  const known = new Set(library.map((e) => e.name))
  // A managed link whose library entry is gone is shown as a dangling unmanaged link.
  const folders = read.map((f) => ({
    ...f,
    managed: f.managed.filter((name) => known.has(name)),
    unmanaged: [
      ...f.unmanaged,
      ...f.managed
        .filter((name) => !known.has(name))
        .map((name) => ({
          agentId: f.agentId,
          name,
          kind: 'link' as const,
          target: join(paths.library, name),
          dangling: true
        }))
    ]
  }))
  const entries = library.map((entry) => ({
    ...entry,
    enabledFor: folders.filter((f) => f.managed.includes(entry.name)).map((f) => f.agentId)
  }))
  return { entries, unmanaged: folders.flatMap((f) => f.unmanaged), folders }
}

type Failure = { ok: false; message: string }

const notInLibrary = (name: string): Failure => ({
  ok: false,
  message: `"${name}" is not in your loadout.`
})
const notALink = (name: string): Failure => ({
  ok: false,
  message: `"${name}" is not a symlink in your loadout. Fix it in Finder first.`
})

function failure(error: unknown): Failure {
  return { ok: false, message: error instanceof Error ? error.message : String(error) }
}

/** A folder under ~/.loadout/backups, by its real path: an UNDO would move a library source away. */
export async function inBackups(folder: string, paths: Paths): Promise<Failure | null> {
  const real = await realpath(folder).catch(() => folder)
  const backups = await realpath(paths.backups).catch(() => paths.backups)
  if (real !== backups && !real.startsWith(`${backups}/`)) return null
  return {
    ok: false,
    message: `${displayPath(folder, paths.home)} is in ${displayPath(paths.backups, paths.home)}, where Recruit keeps originals for UNDO. Use UNDO on the Recon page, or copy the skill to another folder first.`
  }
}

/** validateSkillFolder, then link paths.library/<name> -> folder. Returns the name. */
export async function addLocal(folder: string, paths: Paths): Promise<Result<{ name: string }>> {
  try {
    const backup = await inBackups(folder, paths)
    if (backup) return backup
    const existing = (await readLibrary(paths)).map((e) => e.name)
    const checked = await validateSkillFolder(folder, existing)
    if (!checked.ok) return checked
    await applyOps([{ op: 'link', path: join(paths.library, checked.name), target: folder }])
    return { ok: true, name: checked.name }
  } catch (error) {
    return failure(error)
  }
}

/** planToggle for every enabled agent with on=false, applyOps, then unlink the library entry. */
export async function removeEntry(
  name: string,
  config: Config,
  paths: Paths
): Promise<Result<{ unusedClone: string | null }>> {
  try {
    const library = await readLibrary(paths)
    const entry = library.find((e) => e.name === name)
    if (!entry) return notInLibrary(name)
    if (entry.status === 'not-a-link') return notALink(name)
    const { folders } = await snapshot(config, paths)
    const ops: Op[] = []
    const linked = (id: string): boolean =>
      folders.find((f) => f.agentId === id)?.managed.includes(name) ?? false
    for (const agent of config.agents.filter((a) => a.enabled && linked(a.id))) {
      const plan = planToggle(
        { skill: name, agentId: agent.id, on: false },
        config.agents,
        library,
        folders,
        paths
      )
      if (!plan.ok) return plan
      ops.push(...plan.ops)
    }
    ops.push({ op: 'unlink', path: join(paths.library, name), target: entry.target })
    await applyOps(ops)
    const source = entry.source
    if (source.type !== 'github') return { ok: true, unusedClone: null }
    const inUse = library.some(
      (e) =>
        e.name !== name &&
        e.source.type === 'github' &&
        e.source.owner === source.owner &&
        e.source.repo === source.repo
    )
    return {
      ok: true,
      unusedClone: inUse ? null : join(paths.repos, source.owner, source.repo)
    }
  } catch (error) {
    return failure(error)
  }
}

const packGone: Failure = { ok: false, message: 'This pack is no longer in your loadout.' }

/** planToggle + applyOps for each member of a pack, one snapshot; a refused member does not stop the others. */
export async function togglePack(
  request: { pack: string; agentId: string; on: boolean },
  config: Config,
  paths: Paths
): Promise<Result<{ changed: string[]; already: string[]; refused: PackRefusal[] }>> {
  try {
    const snap = await snapshot(config, paths)
    const members = snap.entries.filter((e) => sourceKey(e.source) === request.pack)
    if (members.length === 0) return packGone
    const noAgent = agentRefusal(config.agents, request.agentId)
    if (noAgent !== null) return { ok: false, message: noAgent }
    const changed: string[] = []
    const already: string[] = []
    const refused: PackRefusal[] = []
    for (const { name } of members) {
      try {
        const linked =
          snap.folders.find((f) => f.agentId === request.agentId)?.managed.includes(name) ?? false
        if (linked === request.on) {
          already.push(name)
          continue
        }
        const plan = planToggle(
          { skill: name, agentId: request.agentId, on: request.on },
          config.agents,
          snap.entries,
          snap.folders,
          paths
        )
        if (!plan.ok) {
          refused.push({ skill: name, message: plan.message })
          continue
        }
        await applyOps(plan.ops)
        changed.push(name)
      } catch (error) {
        refused.push({ skill: name, message: failure(error).message })
      }
    }
    return { ok: true, changed, already, refused }
  } catch (error) {
    return failure(error)
  }
}

/** removeEntry for each member of a pack; a refused member does not stop the others. unusedClone is the last non-null one. */
export async function removePack(
  pack: string,
  config: Config,
  paths: Paths
): Promise<Result<{ removed: string[]; refused: PackRefusal[]; unusedClone: string | null }>> {
  try {
    const { entries } = await snapshot(config, paths)
    const members = entries.filter((e) => sourceKey(e.source) === pack)
    if (members.length === 0) return packGone
    const removed: string[] = []
    const refused: PackRefusal[] = []
    let unusedClone: string | null = null
    for (const { name } of members) {
      const result = await removeEntry(name, config, paths)
      if (!result.ok) {
        refused.push({ skill: name, message: result.message })
        continue
      }
      removed.push(name)
      unusedClone = result.unusedClone ?? unusedClone
    }
    return { ok: true, removed, refused, unusedClone }
  } catch (error) {
    return failure(error)
  }
}

/**
 * `root` must be a clone root under paths.repos or a plugin root under paths.tesslPlugins. Re-scans it against the library and links
 * library/<name> -> the candidate folder for each name; links nothing if any name is not offered.
 */
export async function linkCandidates(
  root: string,
  names: string[],
  paths: Paths
): Promise<Result<{ added: { name: string; folder: string }[] }>> {
  try {
    const source = classifyTarget(root, paths)
    if (source.type === 'local' || source.subpath !== '') {
      return {
        ok: false,
        message: `${root} is not a repository clone under ${paths.repos} or a Tessl plugin under ${paths.tesslPlugins}.`
      }
    }
    const origin =
      source.type === 'github'
        ? `${source.owner}/${source.repo}`
        : `${source.workspace}/${source.plugin}`
    const existing = (await readLibrary(paths)).map((e) => e.name)
    const offered = new Map(
      (await scanSkills(root, existing))
        .filter((c) => c.disabled === null && c.name !== null)
        .map((c) => [c.name as string, c.subpath])
    )
    const missing = names.find((n) => !offered.has(n))
    if (missing !== undefined) {
      return {
        ok: false,
        message: `"${missing}" cannot be added from ${origin}; scan it again.`
      }
    }
    const added = names.map((name) => ({ name, folder: join(root, offered.get(name) as string) }))
    await applyOps(
      added.map((a) => ({ op: 'link', path: join(paths.library, a.name), target: a.folder }))
    )
    return { ok: true, added }
  } catch (error) {
    return failure(error)
  }
}

/** Validation without rule 5, basename must equal name, then a new link renamed over the old one, so a failure keeps the old entry. */
export async function relocateEntry(name: string, folder: string, paths: Paths): Promise<Result> {
  try {
    const entry = (await readLibrary(paths)).find((e) => e.name === name)
    if (!entry) return notInLibrary(name)
    if (entry.status === 'not-a-link') return notALink(name)
    if (basename(folder) !== name) {
      return { ok: false, message: `Folder "${basename(folder)}" must be named "${name}".` }
    }
    const backup = await inBackups(folder, paths)
    if (backup) return backup
    const checked = await validateSkillFolder(folder, [])
    if (!checked.ok) return checked
    const path = join(paths.library, name)
    // A dot name: readLibrary skips it, so a leftover from a crash never shows as an entry.
    const temporary = join(paths.library, `.${name}.relocate`)
    await rm(temporary, { force: true })
    await applyOps([{ op: 'link', path: temporary, target: folder }])
    try {
      await rename(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true })
      const text = error instanceof Error ? error.message : String(error)
      throw new Error(`Rename failed: ${text.split(', ')[0]} at ${path}.`, { cause: error })
    }
    return { ok: true }
  } catch (error) {
    return failure(error)
  }
}

/** Names of the symlinks in `folder`; [] when the folder is missing. */
export async function listLinks(folder: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(folder, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return entries.filter((e) => e.isSymbolicLink()).map((e) => e.name)
}

/**
 * Unlinks each symlink in paths.agentsSkills whose name starts with `tessl__`, is not in `before`,
 * and whose raw target, resolved against paths.agentsSkills, is pluginRoot or below it.
 * Returns the removed absolute paths, sorted. Touches nothing else; a missing folder gives [].
 */
export async function removeInstallLinks(
  before: string[],
  pluginRoot: string,
  paths: Paths
): Promise<string[]> {
  const removed: string[] = []
  for (const name of await listLinks(paths.agentsSkills)) {
    if (!name.startsWith('tessl__') || before.includes(name)) continue
    const path = join(paths.agentsSkills, name)
    if (!(await lstat(path)).isSymbolicLink()) continue
    const rel = relative(pluginRoot, resolve(paths.agentsSkills, await readlink(path)))
    if (rel === '..' || rel.startsWith('..' + sep)) continue
    await unlink(path)
    removed.push(path)
  }
  return removed.sort()
}
