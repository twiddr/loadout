import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { join } from 'node:path'
import type { Config } from '../core/config'
import { findMentions, renameFrontmatter } from '../core/fork'
import type { Result } from '../core/ipc'
import { readLibrary, type LibraryEntry } from '../core/library'
import type { Paths } from '../core/paths'
import { planToggle } from '../core/planner'
import { validateName } from '../core/validate'
import { addLocal, applyOps, snapshot } from './disk'
import { skillFiles, skillFolders } from './reviews'

/** Tessl's files at the root of a skill folder; a fork is not that package, so the copy leaves them out. */
export const TESSL_ROOT_FILES = ['.tessl-plugin', 'tile.json', 'tessl-package.json'] as const

export type ForkOutcome =
  | {
      ok: true
      name: string
      folder: string
      leftOut: string[]
      moved: string[]
      failed: { agent: string; message: string }[]
      occurrences: string[]
    }
  | { ok: false; message: string; deleted?: string }

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Copies `from` into `to` (an existing, empty folder): folders (empty ones too), files and symlinks (raw target),
 * without the skipped names at any depth and the Tessl root files. Returns the Tessl root names left out, `.tessl-plugin/` with a slash.
 */
export async function copyForFork(from: string, to: string): Promise<string[]> {
  const root = (rel: string): string => rel.split('/')[0]
  const tessl = (rel: string): boolean =>
    (TESSL_ROOT_FILES as readonly string[]).includes(root(rel))
  const folders = await skillFolders(from)
  const files = await skillFiles(from)
  for (const rel of folders.filter((r) => !tessl(r))) await mkdir(join(to, rel))
  for (const { rel, link } of files.filter((f) => !tessl(f.rel))) {
    if (link) await symlink(await readlink(join(from, rel)), join(to, rel))
    else await copyFile(join(from, rel), join(to, rel))
  }
  const present = new Set([...folders, ...files.map((f) => f.rel)].map(root))
  return TESSL_ROOT_FILES.filter((n) => present.has(n)).map((n) =>
    n === '.tessl-plugin' ? `${n}/` : n
  )
}

/** Spec steps 1 and 2: the entry is in the library with its folder there, and `name` passes validateName. */
export async function checkFork(
  skill: string,
  name: string,
  paths: Paths
): Promise<Result<{ entry: LibraryEntry }>> {
  const library = await readLibrary(paths)
  const entry = library.find((e) => e.name === skill)
  if (!entry) return { ok: false, message: `"${skill}" is not in your loadout.` }
  if (entry.status !== 'ok') {
    return {
      ok: false,
      message: `"${skill}" cannot be forked: its source folder ${entry.target} is missing.`
    }
  }
  const checked = validateName(
    name,
    library.map((e) => e.name)
  )
  if (!checked.ok) return checked
  return { ok: true, entry }
}

/** checkFork, then spec steps 4 to 10: copy to <parent>/<name>, rename, add, move the toggles, find the old name. */
export async function forkEntry(
  skill: string,
  name: string,
  parent: string,
  config: Config,
  paths: Paths
): Promise<ForkOutcome> {
  const checked = await checkFork(skill, name, paths)
  if (!checked.ok) return checked
  const folder = join(parent, name)
  if (
    await lstat(folder).then(
      () => true,
      () => false
    )
  ) {
    return { ok: false, message: `${folder} already exists. Pick another folder or name.` }
  }

  let leftOut: string[]
  let created = false
  try {
    await mkdir(folder)
    created = true
    leftOut = await copyForFork(checked.entry.target, folder)
    const skillMd = join(folder, 'SKILL.md')
    const renamed = renameFrontmatter(await readFile(skillMd, 'utf8'), name)
    if (renamed === null) {
      throw new Error(`SKILL.md of "${skill}" has no "name" line in its frontmatter.`)
    }
    await rm(skillMd) // the copy may hold a symlink; write a regular file, never through the link
    await writeFile(skillMd, renamed)
    const added = await addLocal(folder, paths)
    if (!added.ok) throw new Error(added.message)
  } catch (error) {
    // Delete only a folder this call created; step 4 refused a path that was already there.
    if (!created) return { ok: false, message: `Fork failed: ${message(error)}` }
    await rm(folder, { recursive: true, force: true })
    return { ok: false, message: `Fork failed: ${message(error)}`, deleted: folder }
  }

  // The fork is switched on first; the original goes off only where that worked, so an agent keeps one of the two.
  const { entries, folders } = await snapshot(config, paths)
  const agents = config.agents.filter(
    (a) => a.enabled && (folders.find((f) => f.agentId === a.id)?.managed.includes(skill) ?? false)
  )
  const failed: { agent: string; message: string }[] = []
  const toggle = async (agentId: string, target: string, on: boolean): Promise<string | null> => {
    const plan = planToggle({ skill: target, agentId, on }, config.agents, entries, folders, paths)
    if (!plan.ok) return plan.message
    try {
      await applyOps(plan.ops)
      return null
    } catch (error) {
      return message(error)
    }
  }
  const switched: typeof agents = []
  for (const agent of agents) {
    const problem = await toggle(agent.id, name, true)
    if (problem === null) switched.push(agent)
    else failed.push({ agent: agent.label, message: problem })
  }
  const moved: string[] = []
  for (const agent of switched) {
    const problem = await toggle(agent.id, skill, false)
    if (problem === null) moved.push(agent.label)
    else failed.push({ agent: agent.label, message: problem })
  }

  const texts: { rel: string; text: string }[] = []
  for (const { rel, link } of await skillFiles(folder)) {
    if (link) continue
    const data = await readFile(join(folder, rel))
    if (!data.includes(0)) texts.push({ rel, text: data.toString('utf8') })
  }
  return {
    ok: true,
    name,
    folder,
    leftOut,
    moved,
    failed,
    occurrences: findMentions(texts, skill)
  }
}
