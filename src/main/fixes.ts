import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  rmdir,
  symlink,
  writeFile
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { FixFile, FixView, Result } from '../core/ipc'
import type { LibraryEntry } from '../core/library'
import type { Paths } from '../core/paths'
import {
  fingerprint,
  hashSkill,
  readSkill,
  skillFiles,
  skillFolders,
  type SkillFile
} from './reviews'

type Named = Pick<LibraryEntry, 'name' | 'target'>

/** A library name is one path segment; anything else could point `rm` outside ~/.loadout/fixes. */
function dir(paths: Paths, skill: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(skill)) throw new Error(`Not a skill name: "${skill}"`)
  return join(paths.fixes, skill)
}
const beforeDir = (paths: Paths, skill: string): string => join(dir(paths, skill), 'before')
const record = (paths: Paths, skill: string): string => join(dir(paths, skill), 'fix.json')

/** Copies one file or symlink from `from` to `to`, replacing a file that is there. */
async function copyEntry(from: string, to: string, link: boolean): Promise<void> {
  await mkdir(dirname(to), { recursive: true })
  await rm(to, { force: true })
  if (link) await symlink(await readlink(from), to)
  else await copyFile(from, to)
}

/**
 * Deletes an earlier copy, then copies the skill folder without the skipped names; empty folders too.
 * Refuses a folder that holds a symlink, before it deletes anything: a copied link points at the
 * same file as the original, so a fix that writes through the link would leave nothing to undo from.
 */
export async function saveBefore(paths: Paths, skill: string, folder: string): Promise<void> {
  const files = await skillFiles(folder)
  const links = files.filter((f) => f.link).map((f) => f.rel)
  if (links.length > 0) {
    throw new Error(
      `Fix cannot save a copy of "${skill}" to undo from, because it holds symlinks: ${links.sort().join(', ')}. Replace each link with a regular file or folder, then run Fix again.`
    )
  }
  await rm(dir(paths, skill), { recursive: true, force: true })
  const to = beforeDir(paths, skill)
  await mkdir(to, { recursive: true })
  for (const rel of await skillFolders(folder)) await mkdir(join(to, rel), { recursive: true })
  for (const { rel, link } of files) {
    await copyEntry(join(folder, rel), join(to, rel), link)
  }
}

const byPath = (files: SkillFile[]): Map<string, SkillFile> => new Map(files.map((f) => [f.rel, f]))
const binary = (f: SkillFile | undefined): boolean =>
  f !== undefined && !f.link && f.data.includes(0)

/** Files that differ between two reads; SKILL.md first, then by path. */
function compare(old: SkillFile[], now: SkillFile[]): FixFile[] {
  const a = byPath(old)
  const b = byPath(now)
  const files: FixFile[] = []
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(path)
    const y = b.get(path)
    if (x && y && x.link === y.link && x.data.equals(y.data)) continue
    const isBinary = binary(x) || binary(y)
    files.push({
      path,
      change: !x ? 'added' : !y ? 'removed' : 'changed',
      before: x && !isBinary ? x.data.toString('utf8') : null,
      after: y && !isBinary ? y.data.toString('utf8') : null,
      binary: isBinary
    })
  }
  const rank = (p: string): string => (p === 'SKILL.md' ? '' : p)
  return files.sort((p, q) => (rank(p.path) < rank(q.path) ? -1 : 1))
}

async function writeRecord(
  paths: Paths,
  skill: string,
  fixedAt: number,
  after: string
): Promise<void> {
  await writeFile(record(paths, skill), JSON.stringify({ fixedAt, after }, null, 2) + '\n')
}

/**
 * After a fix ran: records it when the folder differs from the copy, else deletes the copy. When a
 * read fails, the fix is recorded as not undoable before the error is thrown, so the FIX tab shows
 * it and KEEP FIX deletes the copy.
 */
export async function finishFix(
  paths: Paths,
  skill: string,
  folder: string,
  now: number
): Promise<boolean> {
  let current: SkillFile[]
  let old: SkillFile[]
  try {
    ;[current, old] = await Promise.all([readSkill(folder), readSkill(beforeDir(paths, skill))])
  } catch (error) {
    await writeRecord(paths, skill, now, '')
    throw error
  }
  if (compare(old, current).length === 0) {
    await deleteFix(paths, skill)
    return false
  }
  await writeRecord(paths, skill, now, hashSkill(current))
  return true
}

async function readRecord(
  paths: Paths,
  skill: string
): Promise<{ fixedAt: number; after: string } | null> {
  try {
    const raw = JSON.parse(await readFile(record(paths, skill), 'utf8')) as Record<string, unknown>
    if (typeof raw?.fixedAt !== 'number' || typeof raw.after !== 'string') return null
    return { fixedAt: raw.fixedAt, after: raw.after }
  } catch {
    return null
  }
}

/** `current` is the folder read when the caller has it already (null: unreadable). */
export async function readFix(
  paths: Paths,
  entry: Named,
  current?: SkillFile[] | null
): Promise<FixView | null> {
  const saved = await readRecord(paths, entry.name)
  if (!saved) return null
  const unreadable = { fixedAt: saved.fixedAt, undoable: false, unreadable: true, files: [] }
  try {
    const now = current === undefined ? await readSkill(entry.target) : current
    if (now === null) return unreadable
    return {
      fixedAt: saved.fixedAt,
      undoable: saved.after !== '' && hashSkill(now) === saved.after,
      unreadable: false,
      files: compare(await readSkill(beforeDir(paths, entry.name)), now)
    }
  } catch {
    return unreadable
  }
}

export async function currentFixes(
  paths: Paths,
  entries: Named[]
): Promise<Record<string, { fixedAt: number; undoable: boolean }>> {
  const rows = await Promise.all(
    entries.map(async (e) => {
      const saved = await readRecord(paths, e.name)
      if (!saved) return null
      const undoable = saved.after !== '' && (await fingerprint(e.target)) === saved.after
      return { name: e.name, fixedAt: saved.fixedAt, undoable }
    })
  )
  const out: Record<string, { fixedAt: number; undoable: boolean }> = {}
  for (const row of rows) if (row) out[row.name] = { fixedAt: row.fixedAt, undoable: row.undoable }
  return out
}

/**
 * Puts the saved copy back. The check and the work list come from one read of the folder, so an
 * edit made after the check is not overwritten. Added files go first, then the folders they leave
 * empty, then the old files are copied back: so a rename that only changes letter case and a file
 * replaced by a folder (or the reverse) are undone without one step deleting another's result.
 */
export async function undoFix(paths: Paths, entry: Named): Promise<Result> {
  const saved = await readRecord(paths, entry.name)
  if (!saved) return { ok: false, message: `"${entry.name}" has no saved fix to undo.` }
  const current = await readSkill(entry.target)
  if (saved.after === '' || hashSkill(current) !== saved.after) {
    return {
      ok: false,
      message: `The skill changed after the fix, so Undo would erase those edits. Keep the fix, or restore by hand from ~/.loadout/fixes/${entry.name}/before.`
    }
  }
  const from = beforeDir(paths, entry.name)
  const old = await readSkill(from)
  const files = compare(old, current)
  const added = files.filter((f) => f.change === 'added')
  for (const f of added) await rm(join(entry.target, f.path), { force: true })
  // Folders that were there before, by exact name; others an added file leaves empty go.
  const oldFolders = new Set(await skillFolders(from))
  const created = new Set<string>()
  for (const f of added) for (let d = dirname(f.path); d !== '.'; d = dirname(d)) created.add(d)
  for (const d of [...created].sort((a, b) => b.length - a.length)) {
    if (oldFolders.has(d)) continue
    const left = await readdir(join(entry.target, d)).catch(() => null)
    if (left && left.length === 0) await rmdir(join(entry.target, d))
  }
  const links = byPath(old)
  for (const f of files.filter((x) => x.change !== 'added')) {
    await copyEntry(
      join(from, f.path),
      join(entry.target, f.path),
      links.get(f.path)?.link ?? false
    )
  }
  await deleteFix(paths, entry.name)
  return { ok: true }
}

export async function deleteFix(paths: Paths, skill: string): Promise<void> {
  await rm(dir(paths, skill), { recursive: true, force: true })
}
