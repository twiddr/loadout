import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { scanSkills } from '../src/core/scan'

let base: string
let root: string

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'loadout-scan-'))
  root = join(base, 'clone')
  await mkdir(root)
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

async function skillMd(dir: string, content: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), content)
}

async function skill(dir: string, name: string): Promise<void> {
  await skillMd(dir, `---\nname: ${name}\n---\n`)
}

test('lists skill folders, skips .git and node_modules, scans other dot-folders', async () => {
  await skill(join(root, 'skills/alpha'), 'alpha')
  await skill(join(root, 'skills/beta'), 'beta')
  await skill(join(root, 'node_modules/x/skills/gamma'), 'gamma')
  await skill(join(root, '.git/skills/delta'), 'delta')
  await skill(join(root, '.claude/skills/epsilon'), 'epsilon')
  const found = await scanSkills(root, [])
  expect(found.map((c) => c.subpath)).toEqual([
    '.claude/skills/epsilon',
    'skills/alpha',
    'skills/beta'
  ])
  expect(found.every((c) => c.disabled === null)).toBe(true)
})

test('offers depth 4 and not depth 5', async () => {
  await skill(join(root, 'a/b/c/four'), 'four')
  await skill(join(root, 'a/b/c/d/five'), 'five')
  const found = await scanSkills(root, [])
  expect(found.map((c) => c.subpath)).toEqual(['a/b/c/four'])
})

test('offers the root itself when it holds SKILL.md', async () => {
  const tools = join(base, 'tools')
  await skill(tools, 'tools')
  expect(await scanSkills(tools, [])).toEqual([{ subpath: '', name: 'tools', disabled: null }])
})

test('disables a name already in the library', async () => {
  await skill(join(root, 'skills/beta'), 'beta')
  const [candidate] = await scanSkills(root, ['beta'])
  expect(candidate.disabled).toBe('Recruited')
})

test('offers a folder whose name differs from the frontmatter name', async () => {
  await skill(join(root, 'skills/soft-skill'), 'high-end-visual-design')
  await skill(join(root, 'src'), 'human-review')
  expect(await scanSkills(root, [])).toEqual([
    { subpath: 'skills/soft-skill', name: 'high-end-visual-design', disabled: null },
    { subpath: 'src', name: 'human-review', disabled: null }
  ])
})

test('offers a root SKILL.md whose name differs from the root folder', async () => {
  await skill(root, 'good')
  expect(await scanSkills(root, [])).toEqual([{ subpath: '', name: 'good', disabled: null }])
})

test('disables invalid skills with the validation messages', async () => {
  await skill(join(root, 'skills/Bad_Name'), 'Bad_Name')
  await skill(join(root, 'skills/synced'), 'synced')
  await skillMd(join(root, 'skills/plain'), '# no frontmatter\n')
  const found = await scanSkills(root, [])
  expect(found).toEqual([
    {
      subpath: 'skills/Bad_Name',
      name: 'Bad_Name',
      disabled: 'Skill name "Bad_Name" must be lowercase letters, digits and single hyphens.'
    },
    {
      subpath: 'skills/plain',
      name: null,
      disabled: `SKILL.md in ${join(root, 'skills/plain')} has no "name" in its frontmatter.`
    },
    {
      subpath: 'skills/synced',
      name: 'synced',
      disabled: 'The name "synced" is reserved by Claude Code.'
    }
  ])
})

test('offers only the first of two skills with the same name', async () => {
  await skill(join(root, 'legacy/foo'), 'foo')
  await skill(join(root, 'skills/foo'), 'foo')
  const found = await scanSkills(root, [])
  expect(found.map((c) => c.disabled)).toEqual([
    null,
    '"foo" is also at legacy/foo; only the first is offered.'
  ])
})

test('never follows symlinks', async () => {
  await skill(join(base, 'elsewhere/linked'), 'linked')
  await mkdir(join(root, 'skills'), { recursive: true })
  await symlink(join(base, 'elsewhere/linked'), join(root, 'skills/link'))
  await symlink(root, join(root, 'skills/loop'))
  expect(await scanSkills(root, [])).toEqual([])
})
