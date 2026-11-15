import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readAgentFolder } from '../src/core/agents'
import { agentFolder, DEFAULT_CONFIG, type Agent } from '../src/core/config'
import { pathsFrom, type Paths } from '../src/core/paths'

let home: string
let paths: Paths
let agent: Agent
let folder: string

beforeEach(async () => {
  // The real path: tmpdir() is under /var, a link to /private/var, and a relative link resolves through it.
  home = await realpath(await mkdtemp(join(tmpdir(), 'loadout-agents-')))
  paths = pathsFrom(home)
  agent = { ...DEFAULT_CONFIG.agents[0], enabled: true }
  folder = agentFolder(agent, paths)
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('readAgentFolder', () => {
  it('reports an absent folder without creating it', async () => {
    const result = await readAgentFolder(agent, paths)
    expect(result).toEqual({
      agentId: 'claude-code',
      folder,
      folderExists: false,
      managed: [],
      unmanaged: []
    })
    await expect(readAgentFolder(agent, paths)).resolves.toMatchObject({ folderExists: false })
  })

  it('treats a link to library/<same name> as managed', async () => {
    await mkdir(folder, { recursive: true })
    await symlink(join(paths.library, 'x'), join(folder, 'x'))
    const result = await readAgentFolder(agent, paths)
    expect(result.managed).toEqual(['x'])
    expect(result.unmanaged).toEqual([])
  })

  it('treats a relative link to library/<same name> as managed', async () => {
    await mkdir(folder, { recursive: true })
    await mkdir(paths.library, { recursive: true })
    await symlink('../../.loadout/skills/x', join(folder, 'x'))
    expect((await readAgentFolder(agent, paths)).managed).toEqual(['x'])
  })

  it('resolves a relative link against the real path of a linked agent folder', async () => {
    // ~/.claude/skills -> ~/dotfiles/claude/skills; the link text is relative to the real folder.
    const real = join(home, 'dotfiles', 'claude', 'skills')
    await mkdir(real, { recursive: true })
    await mkdir(join(home, 'dotfiles', 'shared', 'sample'), { recursive: true })
    await mkdir(join(folder, '..'), { recursive: true })
    await symlink(real, folder)
    await symlink('../../shared/sample', join(real, 'sample'))
    await symlink('../../shared/gone', join(real, 'gone'))
    const result = await readAgentFolder(agent, paths)
    expect(result.unmanaged).toMatchObject([
      { name: 'gone', kind: 'link', dangling: true },
      { name: 'sample', kind: 'link', dangling: false }
    ])
    const sample = result.unmanaged.find((u) => u.name === 'sample')
    expect(await realpath(sample?.target ?? '')).toBe(
      await realpath(join(home, 'dotfiles', 'shared', 'sample'))
    )
  })

  it('treats a link with a name mismatch as unmanaged', async () => {
    await mkdir(folder, { recursive: true })
    await symlink(join(paths.library, 'y'), join(folder, 'x'))
    const result = await readAgentFolder(agent, paths)
    expect(result.managed).toEqual([])
    expect(result.unmanaged).toEqual([
      {
        agentId: 'claude-code',
        name: 'x',
        kind: 'link',
        target: join(paths.library, 'y'),
        dangling: true
      }
    ])
  })

  it('marks a link to an existing folder as not dangling', async () => {
    await mkdir(folder, { recursive: true })
    const other = join(home, 'elsewhere')
    await mkdir(other)
    await symlink(other, join(folder, 'tessl__foo'))
    const [entry] = (await readAgentFolder(agent, paths)).unmanaged
    expect(entry).toMatchObject({
      name: 'tessl__foo',
      kind: 'link',
      target: other,
      dangling: false
    })
  })

  it('marks a link to an absent target as dangling', async () => {
    await mkdir(folder, { recursive: true })
    const target = join(home, '.agents', 'skills', 'deep-research')
    await symlink(target, join(folder, 'deep-research'))
    const [entry] = (await readAgentFolder(agent, paths)).unmanaged
    expect(entry).toMatchObject({ kind: 'link', target, dangling: true })
  })

  it('marks a link in a loop as dangling instead of failing the read', async () => {
    await mkdir(folder, { recursive: true })
    await symlink(join(folder, 'loop'), join(folder, 'loop'))
    const [entry] = (await readAgentFolder(agent, paths)).unmanaged
    expect(entry).toMatchObject({ name: 'loop', kind: 'link', dangling: true })
  })

  it('classifies real folders and files', async () => {
    await mkdir(join(folder, 'plain'), { recursive: true })
    await writeFile(join(folder, 'note.txt'), 'hi')
    const { unmanaged } = await readAgentFolder(agent, paths)
    expect(unmanaged).toEqual([
      { agentId: 'claude-code', name: 'note.txt', kind: 'file', target: null, dangling: false },
      { agentId: 'claude-code', name: 'plain', kind: 'folder', target: null, dangling: false }
    ])
  })

  it('skips hidden entries', async () => {
    await mkdir(join(folder, '.system'), { recursive: true })
    await writeFile(join(folder, '.DS_Store'), '')
    await symlink(join(paths.library, 'x'), join(folder, 'x'))
    const result = await readAgentFolder(agent, paths)
    expect(result.managed).toEqual(['x'])
    expect(result.unmanaged).toEqual([])
  })

  it('reads an agent folder that is itself a symlink', async () => {
    const real = join(home, 'real-skills')
    await mkdir(real)
    await symlink(join(paths.library, 'x'), join(real, 'x'))
    await mkdir(join(home, '.claude'), { recursive: true })
    await symlink(real, folder)
    const result = await readAgentFolder(agent, paths)
    expect(result.folderExists).toBe(true)
    expect(result.managed).toEqual(['x'])
  })
})
