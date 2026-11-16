import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { frontmatterName, validateName } from './validate'

export interface Candidate {
  /** '/'-separated path below the root; '' when the root itself holds SKILL.md. */
  subpath: string
  /** Frontmatter name, or null when there is none. */
  name: string | null
  /** Why it cannot be ticked, or null when it can. */
  disabled: string | null
}

export const SCAN_DEPTH = 4

/** Folders holding a SKILL.md file at depth 0 (the root) to SCAN_DEPTH, sorted by subpath. */
export async function scanSkills(root: string, existingNames: string[]): Promise<Candidate[]> {
  const found: { subpath: string; name: string | null; message: string | null }[] = []

  async function walk(folder: string, subpath: string, depth: number): Promise<void> {
    let text: string | null = null
    try {
      text = await readFile(join(folder, 'SKILL.md'), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (text !== null) {
      const name = frontmatterName(text)
      let message: string | null = null
      if (name === null) {
        message = `SKILL.md in ${folder} has no "name" in its frontmatter.`
      } else {
        const checked = validateName(name, [])
        if (!checked.ok) message = checked.message
      }
      found.push({ subpath, name, message })
    }
    if (depth >= SCAN_DEPTH) return
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.git' || entry.name === 'node_modules') continue
      await walk(
        join(folder, entry.name),
        subpath ? `${subpath}/${entry.name}` : entry.name,
        depth + 1
      )
    }
  }

  await walk(root, '', 0)
  found.sort((a, b) => (a.subpath < b.subpath ? -1 : a.subpath > b.subpath ? 1 : 0))

  const firstAt = new Map<string, string>()
  return found.map(({ subpath, name, message }) => {
    let disabled = message
    if (disabled === null && name !== null) {
      const first = firstAt.get(name)
      if (existingNames.includes(name)) {
        disabled = 'Recruited'
      } else if (first !== undefined) {
        disabled = `"${name}" is also at ${first || '.'}; only the first is offered.`
      } else {
        firstAt.set(name, subpath)
      }
    }
    return { subpath, name, disabled }
  })
}
