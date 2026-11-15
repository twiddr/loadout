import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { frontmatterName, validateName, validateSkillFolder } from '../src/core/validate'

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'loadout-validate-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

async function skillFolder(basename: string, skillMd: string | null): Promise<string> {
  const folder = join(root, basename)
  await mkdir(folder, { recursive: true })
  if (skillMd !== null) await writeFile(join(folder, 'SKILL.md'), skillMd)
  return folder
}

test('frontmatterName strips quotes and CRLF', () => {
  expect(frontmatterName('---\r\nname: "my-skill"\r\ndescription: x\r\n---\r\n# body')).toBe(
    'my-skill'
  )
})

test('frontmatterName ignores a name line outside the frontmatter', () => {
  expect(frontmatterName('# Title\nname: nope\n')).toBeNull()
  expect(frontmatterName('---\ndescription: x\n---\nname: late\n')).toBeNull()
})

test('rule 1: no SKILL.md', async () => {
  const folder = await skillFolder('empty', null)
  expect(await validateSkillFolder(folder, [])).toEqual({
    ok: false,
    message: `No SKILL.md in ${folder}.`
  })
})

test('rule 2: no name in the frontmatter', async () => {
  const folder = await skillFolder('noname', '# Just a heading\n')
  expect(await validateSkillFolder(folder, [])).toEqual({
    ok: false,
    message: `SKILL.md in ${folder} has no "name" in its frontmatter.`
  })
})

test('rule 3: name pattern', async () => {
  const folder = await skillFolder('badname', '---\nname: My_Skill\n---\n')
  expect(await validateSkillFolder(folder, [])).toEqual({
    ok: false,
    message: 'Skill name "My_Skill" must be lowercase letters, digits and single hyphens.'
  })
})

test('rule 4: synced is reserved', async () => {
  const folder = await skillFolder('synced', '---\nname: synced\n---\n')
  expect(await validateSkillFolder(folder, [])).toEqual({
    ok: false,
    message: 'The name "synced" is reserved by Claude Code.'
  })
})

test('rule 6: folder name must match for a folder the user chose', async () => {
  const folder = await skillFolder('other', '---\nname: good\n---\n')
  expect(await validateSkillFolder(folder, [])).toEqual({
    ok: false,
    message: 'Folder "other" must be named "good" to match the frontmatter.'
  })
})

test('rule 5: name already in the library', async () => {
  const folder = await skillFolder('good', '---\nname: good\n---\n')
  expect(await validateSkillFolder(folder, ['good'])).toEqual({
    ok: false,
    message: '"good" is already in your loadout. Remove it first or rename the new skill.'
  })
})

test('rule 5 wins over rule 6 when both fail', async () => {
  const folder = await skillFolder('other', '---\nname: good\n---\n')
  expect(await validateSkillFolder(folder, ['good'])).toEqual({
    ok: false,
    message: '"good" is already in your loadout. Remove it first or rename the new skill.'
  })
})

test('a valid folder passes', async () => {
  const folder = await skillFolder('good', '---\nname: good\n---\n')
  expect(await validateSkillFolder(folder, [])).toEqual({ ok: true, name: 'good' })
})

test('validateName is pure and ignores the folder name', () => {
  expect(validateName('good', [])).toEqual({ ok: true, name: 'good' })
})
