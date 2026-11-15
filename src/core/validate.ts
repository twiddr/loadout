import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** The `name` value inside the leading `---` frontmatter block, quotes and \r stripped; null when absent. */
export function frontmatterName(skillMd: string): string | null {
  const lines = skillMd.split('\n').map((line) => line.replace(/\r/g, ''))
  if (lines[0] !== '---') return null
  for (const line of lines.slice(1)) {
    if (line === '---') return null
    const match = /^name:\s*(.+?)\s*$/.exec(line)
    if (match) return match[1].replace(/^(["'])(.*)\1$/, '$2')
  }
  return null
}

export type Validation = { ok: true; name: string } | { ok: false; message: string }

/** Rules 3 to 5 of the spec, pure. The folder name is not checked: a scanned folder may differ. */
export function validateName(name: string, existingNames: string[]): Validation {
  if (!NAME_PATTERN.test(name)) {
    return {
      ok: false,
      message: `Skill name "${name}" must be lowercase letters, digits and single hyphens.`
    }
  }
  if (name === 'synced') {
    return { ok: false, message: 'The name "synced" is reserved by Claude Code.' }
  }
  if (existingNames.includes(name)) {
    return {
      ok: false,
      message: `"${name}" is already in your loadout. Remove it first or rename the new skill.`
    }
  }
  return { ok: true, name }
}

/** Rules 1 to 6 for a folder the user chose: reads <folder>/SKILL.md, then validateName and the folder name. */
export async function validateSkillFolder(
  folder: string,
  existingNames: string[]
): Promise<Validation> {
  let text: string
  try {
    text = await readFile(join(folder, 'SKILL.md'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, message: `No SKILL.md in ${folder}.` }
    }
    throw error
  }
  const name = frontmatterName(text)
  if (name === null) {
    return { ok: false, message: `SKILL.md in ${folder} has no "name" in its frontmatter.` }
  }
  const checked = validateName(name, existingNames)
  if (checked.ok && basename(folder) !== name) {
    return {
      ok: false,
      message: `Folder "${basename(folder)}" must be named "${name}" to match the frontmatter.`
    }
  }
  return checked
}
