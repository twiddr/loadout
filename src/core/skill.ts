import { lstat, readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SkillDetail } from './ipc'

/** True when `folder` or a parent holds a `.git` folder or file. A file check only; spawns nothing. */
export async function insideGitWorkTree(folder: string): Promise<boolean> {
  for (let dir = folder; ; dir = dirname(dir)) {
    try {
      await lstat(join(dir, '.git'))
      return true
    } catch {
      if (dirname(dir) === dir) return false
    }
  }
}

async function folderSize(folder: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0
  let files = 0
  for (const name of await readdir(folder)) {
    if (name === '.git') continue
    const info = await lstat(join(folder, name))
    if (info.isDirectory()) {
      const inner = await folderSize(join(folder, name))
      bytes += inner.bytes
      files += inner.files
    } else if (info.isFile()) {
      bytes += info.size
      files += 1
    }
  }
  return { bytes, files }
}

/** Reads SKILL.md, the entry list and the size of a skill folder; a missing folder gives empty values. */
export async function readSkillFolder(
  target: string
): Promise<Pick<SkillDetail, 'skillMd' | 'files' | 'size'>> {
  let names: string[]
  try {
    names = await readdir(target)
  } catch {
    return { skillMd: null, files: [], size: null }
  }
  const skillMd = await readFile(join(target, 'SKILL.md'), 'utf8').catch(() => null)
  const files = await Promise.all(
    names
      .filter((name) => !name.startsWith('.'))
      .map(async (name) => ({ name, folder: (await lstat(join(target, name))).isDirectory() }))
  )
  files.sort((a, b) =>
    a.folder !== b.folder ? (a.folder ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  )
  const size = await folderSize(target).catch(() => null)
  return { skillMd, files, size }
}
