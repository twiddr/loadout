import { lstat, readdir, readlink, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { Paths } from './paths'

export type Source =
  | { type: 'local'; path: string }
  | { type: 'github'; owner: string; repo: string; subpath: string }
  | { type: 'tessl'; workspace: string; plugin: string; subpath: string }
export type EntryStatus = 'ok' | 'missing' | 'not-a-link'

export interface LibraryEntry {
  name: string
  source: Source
  status: EntryStatus
  /** Absolute. For not-a-link, the entry's own path. */
  target: string
}

/** Segments of `target` below `root`, or null when `target` is not below `root`. */
function segmentsBelow(root: string, target: string): string[] | null {
  const rel = relative(root, target)
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep)) return null
  return rel.split(sep)
}

/** `target` is absolute. Under repos/<owner>/<repo>[/sub] -> github; under tesslPlugins/<ws>/<plugin>[/sub] -> tessl; else local. */
export function classifyTarget(target: string, paths: Paths): Source {
  const repo = segmentsBelow(paths.repos, target)
  if (repo && repo.length >= 2) {
    return {
      type: 'github',
      owner: repo[0],
      repo: repo[1],
      subpath: repo.slice(2).join('/')
    }
  }
  const plugin = segmentsBelow(paths.tesslPlugins, target)
  if (plugin && plugin.length >= 2) {
    return {
      type: 'tessl',
      workspace: plugin[0],
      plugin: plugin[1],
      subpath: plugin.slice(2).join('/')
    }
  }
  return { type: 'local', path: target }
}

async function readEntry(name: string, paths: Paths): Promise<LibraryEntry> {
  const own = join(paths.library, name)
  if (!(await lstat(own)).isSymbolicLink()) {
    return { name, source: { type: 'local', path: own }, status: 'not-a-link', target: own }
  }
  const target = resolve(paths.library, await readlink(own))
  const hasSkill = await stat(join(target, 'SKILL.md')).then(
    (s) => s.isFile(),
    () => false
  )
  return {
    name,
    source: classifyTarget(target, paths),
    status: hasSkill ? 'ok' : 'missing',
    target
  }
}

/** Reads paths.library; a missing library folder yields []. Sorted by name. */
export async function readLibrary(paths: Paths): Promise<LibraryEntry[]> {
  let names: string[]
  try {
    names = (await readdir(paths.library)).filter((name) => !name.startsWith('.'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const entries = await Promise.all(names.map((name) => readEntry(name, paths)))
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
