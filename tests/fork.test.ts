import { expect, test } from 'vitest'
import { findMentions, renameFrontmatter } from '../src/core/fork'

test('renameFrontmatter replaces the name value only', () => {
  expect(renameFrontmatter('---\nname: old\ndescription: x\n---\nold body\n', 'new')).toBe(
    '---\nname: new\ndescription: x\n---\nold body\n'
  )
})

test('renameFrontmatter keeps \\r\\n line ends', () => {
  expect(renameFrontmatter('---\r\nname: old\r\n---\r\n', 'new')).toBe(
    '---\r\nname: new\r\n---\r\n'
  )
})

test('renameFrontmatter keeps quotes and spacing', () => {
  expect(renameFrontmatter('---\nname: "old"\n---\n', 'new')).toBe('---\nname: "new"\n---\n')
  expect(renameFrontmatter("---\nname: 'old'\n---\n", 'new')).toBe("---\nname: 'new'\n---\n")
  expect(renameFrontmatter('---\nname:   old\n---\n', 'new')).toBe('---\nname:   new\n---\n')
})

test('renameFrontmatter changes only the frontmatter', () => {
  expect(renameFrontmatter('---\ndescription: x\n---\nname: old\n', 'new')).toBeNull()
  expect(renameFrontmatter('---\ndescription: x\n  name: old\n---\n', 'new')).toBeNull()
})

test('renameFrontmatter returns null without frontmatter', () => {
  expect(renameFrontmatter('# old\n', 'new')).toBeNull()
})

test('findMentions finds whole words with trimmed lines', () => {
  expect(
    findMentions([{ rel: 'SKILL.md', text: 'use old now\nold-school\nteacher\n' }], 'old')
  ).toEqual(['SKILL.md:1: use old now'])
  expect(
    findMentions(
      [
        {
          rel: 'x.md',
          text: 'a\nb\n  bash ~/.claude/skills/design-taste-frontend/gate.sh  \n'
        }
      ],
      'design-taste-frontend'
    )
  ).toEqual(['x.md:3: bash ~/.claude/skills/design-taste-frontend/gate.sh'])
})

test('findMentions treats hyphen and underscore as word characters', () => {
  const text = 'teacher\nteach-me\nteach_me\nteach.\n(teach)\n'
  expect(findMentions([{ rel: 'a.md', text }], 'teach')).toEqual([
    'a.md:4: teach.',
    'a.md:5: (teach)'
  ])
})

test('findMentions lists SKILL.md first, then files by path', () => {
  const files = ['b.md', 'SKILL.md', 'a.md'].map((rel) => ({ rel, text: 'old\n' }))
  expect(findMentions(files, 'old')).toEqual(['SKILL.md:1: old', 'a.md:1: old', 'b.md:1: old'])
})

test('findMentions escapes regex characters in the name', () => {
  expect(findMentions([{ rel: 'a.md', text: 'a.b\naxb\n' }], 'a.b')).toEqual(['a.md:1: a.b'])
})
