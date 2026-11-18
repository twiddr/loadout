import { createHash, type Hash } from 'node:crypto'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { join } from 'node:path'
import type { SkillText } from '../core/ipc'
import type { LibraryEntry } from '../core/library'
import { changedSince } from '../core/tessl'
import type { Paths } from '../core/paths'

/** The file `~/.loadout/reviews/<skill>.json` (ADR 20261109-saved-reviews). */
export interface SavedReview {
  reviewedAt: number
  /** SHA-256 of the skill folder before the review ran; '' when it could not be read. */
  fingerprint: string
  /** The parsed `tessl review run --json` stdout. */
  tessl: Record<string, unknown>
}

type Named = Pick<LibraryEntry, 'name' | 'target'>

/** Folders and files that tools write into a skill folder; a change in them is not a skill change. */
const SKIPPED_FOLDERS = new Set(['.git', '__pycache__', 'node_modules'])
const SKIPPED_FILES = new Set(['.DS_Store'])

/** Relative paths of every file and symlink below `folder`, the skipped names left out at any depth. */
export async function skillFiles(
  folder: string,
  prefix = ''
): Promise<{ rel: string; link: boolean }[]> {
  const found: { rel: string; link: boolean }[] = []
  for (const item of await readdir(join(folder, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${item.name}` : item.name
    if (item.isDirectory()) {
      if (!SKIPPED_FOLDERS.has(item.name)) found.push(...(await skillFiles(folder, rel)))
    } else if (SKIPPED_FILES.has(item.name)) {
      continue
    } else if (item.isSymbolicLink() || item.isFile()) {
      found.push({ rel, link: item.isSymbolicLink() })
    }
  }
  return found
}

/** Relative paths of every folder below `folder`, the skipped names left out, empty ones too. */
export async function skillFolders(folder: string, prefix = ''): Promise<string[]> {
  const found: string[] = []
  for (const item of await readdir(join(folder, prefix), { withFileTypes: true })) {
    if (!item.isDirectory() || SKIPPED_FOLDERS.has(item.name)) continue
    const rel = prefix ? `${prefix}/${item.name}` : item.name
    found.push(rel, ...(await skillFolders(folder, rel)))
  }
  return found
}

/** One file of a skill folder: its relative path and its bytes (a symlink: `link:<target>`). */
export interface SkillFile {
  rel: string
  link: boolean
  data: Buffer
  /** A symlink's target bytes when the target is a readable file, so an edit through the link is seen; else null. */
  resolved: Buffer | null
}

/** Every file of the folder, the skipped names left out, sorted by path. */
export async function readSkill(folder: string): Promise<SkillFile[]> {
  const files = (await skillFiles(folder)).sort((a, b) =>
    a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0
  )
  return Promise.all(
    files.map(async ({ rel, link }) => {
      const path = join(folder, rel)
      return {
        rel,
        link,
        data: link ? Buffer.from('link:' + (await readlink(path))) : await readFile(path),
        resolved: link ? await readFile(path).catch(() => null) : null
      }
    })
  )
}

/** What the skill page shows of each file: a link shows its target; a zero byte marks a binary file. */
export function skillTexts(files: SkillFile[]): SkillText[] {
  return files.map(({ rel, link, data, resolved }) => {
    const content = link ? resolved : data
    const binary = content !== null && content.includes(0)
    return { path: rel, text: content && !binary ? content.toString('utf8') : null, binary }
  })
}

/** SHA-256 over the sorted paths and bytes of `readSkill`, symlink targets included. */
export function hashSkill(files: SkillFile[]): string {
  const hash: Hash = createHash('sha256')
  for (const { rel, data, resolved } of files) {
    hash.update(rel + '\0')
    hash.update(data)
    hash.update('\0')
    if (resolved) {
      hash.update(resolved)
      hash.update('\0')
    }
  }
  return hash.digest('hex')
}

/** The folder's fingerprint. Null when the folder cannot be read. */
export async function fingerprint(folder: string): Promise<string | null> {
  try {
    return hashSkill(await readSkill(folder))
  } catch {
    return null
  }
}

/** Folders left out at any depth, in both copies, when the library copy is compared with the synced copy. */
export const SYNC_SKIPPED = ['evals', '.tessl-plugin'] as const

/** True when a folder segment of the relative path is in SYNC_SKIPPED. */
function syncSkipped(rel: string): boolean {
  return rel
    .split('/')
    .slice(0, -1)
    .some((segment) => (SYNC_SKIPPED as readonly string[]).includes(segment))
}

/**
 * The files of a skill that count for "changed since publish", with their times: skillFiles without
 * SYNC_SKIPPED folders; a symlink by its target's time when the target is a readable file, else its
 * own (folder times are never compared). Throws when the folder or a file cannot be read.
 */
export async function fileTimes(folder: string): Promise<{ rel: string; mtimeMs: number }[]> {
  const files = (await skillFiles(folder)).filter(({ rel }) => !syncSkipped(rel))
  return Promise.all(
    files.map(async ({ rel, link }) => {
      const path = join(folder, rel)
      if (!link) return { rel, mtimeMs: (await stat(path)).mtimeMs }
      const target = await stat(path).catch(() => null)
      const info = target?.isFile() ? target : await lstat(path)
      return { rel, mtimeMs: info.mtimeMs }
    })
  )
}

/**
 * The files more than 2 s newer than `.tessl-plugin/plugin.json`, newest first
 * (ADR 20261111-changed-since-publish). Empty when the folder, a file or the manifest cannot be read.
 */
export async function editedFiles(folder: string): Promise<string[]> {
  try {
    const manifestMs = (await stat(join(folder, '.tessl-plugin', 'plugin.json'))).mtimeMs
    return changedSince(manifestMs, await fileTimes(folder))
  } catch {
    return []
  }
}

/** The library copy against the synced copy: readSkill on both, every file with a SYNC_SKIPPED folder segment in its path left out, then hashSkill. */
export async function compareCopies(
  a: string,
  b: string
): Promise<'same' | 'differs' | 'unreadable'> {
  const kept = (files: SkillFile[]): SkillFile[] => files.filter(({ rel }) => !syncSkipped(rel))
  try {
    const [left, right] = await Promise.all([readSkill(a), readSkill(b)])
    return hashSkill(kept(left)) === hashSkill(kept(right)) ? 'same' : 'differs'
  } catch {
    return 'unreadable'
  }
}

const file = (paths: Paths, skill: string): string => join(paths.reviews, `${skill}.json`)

/** A review's stdout as a SavedReview when it is a JSON object; null otherwise, so the old file stays. */
export function reviewFromStdout(
  stdout: string,
  before: string | null,
  now: number
): SavedReview | null {
  let tessl: unknown
  try {
    tessl = JSON.parse(stdout)
  } catch {
    return null
  }
  if (typeof tessl !== 'object' || tessl === null || Array.isArray(tessl)) return null
  return { reviewedAt: now, fingerprint: before ?? '', tessl: tessl as Record<string, unknown> }
}

let writes = 0

/** Writes a temporary file, then renames it over the review, so a crash never leaves half a file. */
export async function saveReview(paths: Paths, skill: string, review: SavedReview): Promise<void> {
  await mkdir(paths.reviews, { recursive: true })
  const temporary = `${file(paths, skill)}.${process.pid}.${++writes}.tmp`
  await writeFile(temporary, JSON.stringify(review, null, 2) + '\n')
  await rename(temporary, file(paths, skill))
}

/** Null when the file is missing, not JSON, or not a SavedReview. */
export async function readSavedReview(paths: Paths, skill: string): Promise<SavedReview | null> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(file(paths, skill), 'utf8'))
  } catch {
    return null
  }
  const r = raw as Partial<SavedReview> | null
  if (
    typeof r !== 'object' ||
    r === null ||
    typeof r.reviewedAt !== 'number' ||
    typeof r.fingerprint !== 'string' ||
    typeof r.tessl !== 'object' ||
    r.tessl === null ||
    Array.isArray(r.tessl)
  ) {
    return null
  }
  return { reviewedAt: r.reviewedAt, fingerprint: r.fingerprint, tessl: r.tessl }
}

/**
 * The saved review and whether the folder changed since; null when there is no readable file.
 * `now` is the folder's fingerprint when the caller has read the folder already (null: unreadable).
 */
export async function readReview(
  paths: Paths,
  entry: Named,
  now?: string | null
): Promise<{ saved: SavedReview; stale: boolean } | null> {
  const saved = await readSavedReview(paths, entry.name)
  if (saved === null) return null
  const current = now === undefined ? await fingerprint(entry.target) : now
  return { saved, stale: current === null || current !== saved.fingerprint }
}

/** review.reviewScore when it is a finite number. */
export function savedScore(saved: SavedReview): number | null {
  const review = saved.tessl.review as Record<string, unknown> | null | undefined
  const score = review?.reviewScore
  return typeof score === 'number' && Number.isFinite(score) ? score : null
}

/** One row per entry whose saved review is readable and current. */
export async function currentReviews(
  paths: Paths,
  entries: Named[]
): Promise<Record<string, { score: number | null; reviewedAt: number }>> {
  const rows = await Promise.all(
    entries.map(async (entry) => ({ name: entry.name, review: await readReview(paths, entry) }))
  )
  const out: Record<string, { score: number | null; reviewedAt: number }> = {}
  for (const { name, review } of rows) {
    if (review && !review.stale) {
      out[name] = { score: savedScore(review.saved), reviewedAt: review.saved.reviewedAt }
    }
  }
  return out
}

export async function deleteReview(paths: Paths, skill: string): Promise<void> {
  await rm(file(paths, skill), { force: true })
}
