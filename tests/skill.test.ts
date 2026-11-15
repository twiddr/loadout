import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { insideGitWorkTree, readSkillFolder } from '../src/core/skill'

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'loadout-skill-'))
  await mkdir(join(root, 'references'))
  await mkdir(join(root, '.git'))
  await writeFile(join(root, 'SKILL.md'), '0123456789')
  await writeFile(join(root, 'references', 'a.md'), '01234')
  await writeFile(join(root, '.git', 'x'), 'x'.repeat(100))
  await writeFile(join(root, '.hidden'), '')
  await symlink('/etc', join(root, 'link'))
})

afterAll(() => rm(root, { recursive: true, force: true }))

describe('readSkillFolder', () => {
  it('lists entries folders first, skips dot names, and sums sizes without .git or links', async () => {
    const detail = await readSkillFolder(root)
    expect(detail.skillMd).toBe('0123456789')
    expect(detail.files).toEqual([
      { name: 'references', folder: true },
      { name: 'SKILL.md', folder: false },
      { name: 'link', folder: false }
    ])
    expect(detail.size).toEqual({ bytes: 15, files: 3 })
  })

  it('gives empty values for a missing target', async () => {
    expect(await readSkillFolder(join(root, 'nope'))).toEqual({
      skillMd: null,
      files: [],
      size: null
    })
  })

  it('gives skillMd null when SKILL.md is missing', async () => {
    const detail = await readSkillFolder(join(root, 'references'))
    expect(detail.skillMd).toBeNull()
    expect(detail.files).toEqual([{ name: 'a.md', folder: false }])
  })
})

describe('insideGitWorkTree', () => {
  let tree: string

  beforeAll(async () => {
    tree = await mkdtemp(join(tmpdir(), 'loadout-worktree-'))
    await mkdir(join(tree, 'repo', '.git'), { recursive: true })
    await mkdir(join(tree, 'repo', 'a', 'b'), { recursive: true })
    await mkdir(join(tree, 'sub'))
    await writeFile(join(tree, 'sub', '.git'), 'gitdir: x')
    await mkdir(join(tree, 'plain', 'x'), { recursive: true })
  })

  afterAll(() => rm(tree, { recursive: true, force: true }))

  it('is true below a .git folder', async () => {
    expect(await insideGitWorkTree(join(tree, 'repo', 'a', 'b'))).toBe(true)
  })

  it('is true when .git is a file', async () => {
    expect(await insideGitWorkTree(join(tree, 'sub'))).toBe(true)
  })

  it('is false with no .git up to the root', async () => {
    expect(await insideGitWorkTree(join(tree, 'plain', 'x'))).toBe(false)
  })
})
