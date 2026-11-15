/** The text with the value of the first top-level `name:` line in the leading frontmatter replaced; null when there is none. */
export function renameFrontmatter(text: string, name: string): string | null {
  const lines = text.split('\n')
  if (lines[0].replace(/\r/g, '') !== '---') return null
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].replace(/\r/g, '') === '---') return null
    const match = /^(name:\s*)(["']?)(.*?)\2(\s*\r?)$/.exec(lines[i])
    if (match) {
      lines[i] = `${match[1]}${match[2]}${name}${match[2]}${match[4]}`
      return lines.join('\n')
    }
  }
  return null
}

/** `<rel>:<line>: <trimmed text>` for each line holding `name` as a whole word; SKILL.md first, then by rel. */
export function findMentions(files: { rel: string; text: string }[], name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const word = new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`)
  const sorted = [...files].sort((a, b) => {
    if (a.rel === 'SKILL.md' || b.rel === 'SKILL.md') return a.rel === 'SKILL.md' ? -1 : 1
    return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0
  })
  const found: string[] = []
  for (const { rel, text } of sorted) {
    text.split('\n').forEach((line, index) => {
      if (word.test(line)) found.push(`${rel}:${index + 1}: ${line.trim()}`)
    })
  }
  return found
}
