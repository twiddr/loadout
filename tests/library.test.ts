import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classifyTarget, readLibrary } from '../src/core/library'
import { pathsFrom, type Paths } from '../src/core/paths'

let home: string
let paths: Paths

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'loadout-library-'))
  paths = pathsFrom(home)
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function skillFolder(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'SKILL.md'), '---\nname: x\n---\n')
}

describe('classifyTarget', () => {
  it('classifies a repo target as github', () => {
    expect(classifyTarget(join(paths.repos, 'acme/tools/skills/x'), paths)).toEqual({
      type: 'github',
      owner: 'acme',
      repo: 'tools',
      subpath: 'skills/x'
    })
  })

  it('gives an empty subpath for the repo root', () => {
    expect(classifyTarget(join(paths.repos, 'acme/tools'), paths)).toEqual({
      type: 'github',
      owner: 'acme',
      repo: 'tools',
      subpath: ''
    })
  })

  it('classifies a tessl plugin target as tessl', () => {
    expect(classifyTarget(join(paths.tesslPlugins, 'acme/ledger-audit'), paths)).toEqual({
      type: 'tessl',
      workspace: 'acme',
      plugin: 'ledger-audit',
      subpath: ''
    })
  })

  it('classifies anything else as local', () => {
    const target = join(home, 'Code/Skills/x')
    expect(classifyTarget(target, paths)).toEqual({ type: 'local', path: target })
  })

  it('treats the roots and an owner alone as local', () => {
    for (const target of [paths.repos, join(paths.repos, 'acme'), paths.tesslPlugins]) {
      expect(classifyTarget(target, paths)).toEqual({ type: 'local', path: target })
    }
  })

  it('compares by path segment, not by string prefix', () => {
    const target = join(home, '.loadout/repos-old/acme/tools')
    expect(classifyTarget(target, paths)).toEqual({ type: 'local', path: target })
  })
})

describe('readLibrary', () => {
  it('returns [] when the library folder is missing', async () => {
    expect(await readLibrary(paths)).toEqual([])
  })

  it('reads a link to a skill folder as ok', async () => {
    const target = join(home, 'Code/Skills/x')
    await skillFolder(target)
    await mkdir(paths.library, { recursive: true })
    await symlink(target, join(paths.library, 'x'))
    expect(await readLibrary(paths)).toEqual([
      { name: 'x', source: { type: 'local', path: target }, status: 'ok', target }
    ])
  })

  it('reports a link to a missing folder as missing with the raw target', async () => {
    const target = join(home, 'Code/Skills/gone')
    await mkdir(paths.library, { recursive: true })
    await symlink(target, join(paths.library, 'gone'))
    const [entry] = await readLibrary(paths)
    expect(entry.status).toBe('missing')
    expect(entry.target).toBe(target)
  })

  it('reports a link to a folder without SKILL.md as missing', async () => {
    const target = join(home, 'Code/Skills/empty')
    await mkdir(target, { recursive: true })
    await mkdir(paths.library, { recursive: true })
    await symlink(target, join(paths.library, 'empty'))
    expect((await readLibrary(paths))[0].status).toBe('missing')
  })

  it('reports a real folder as not-a-link', async () => {
    const own = join(paths.library, 'y')
    await mkdir(own, { recursive: true })
    expect(await readLibrary(paths)).toEqual([
      { name: 'y', source: { type: 'local', path: own }, status: 'not-a-link', target: own }
    ])
  })

  it('resolves a relative link target against the library folder', async () => {
    const target = join(home, 'Code/Skills/z')
    await skillFolder(target)
    await mkdir(paths.library, { recursive: true })
    await symlink('../../Code/Skills/z', join(paths.library, 'z'))
    const [entry] = await readLibrary(paths)
    expect(entry.target).toBe(target)
    expect(entry.source.type).toBe('local')
    expect(entry.status).toBe('ok')
  })

  it('derives a github source from a link into the repos folder', async () => {
    const target = join(paths.repos, 'acme/tools/skills/x')
    await skillFolder(target)
    await mkdir(paths.library, { recursive: true })
    await symlink(target, join(paths.library, 'x'))
    expect((await readLibrary(paths))[0].source).toEqual({
      type: 'github',
      owner: 'acme',
      repo: 'tools',
      subpath: 'skills/x'
    })
  })

  it('sorts entries by name', async () => {
    await mkdir(paths.library, { recursive: true })
    for (const name of ['b', 'c', 'a']) {
      await symlink(join(home, 'nowhere', name), join(paths.library, name))
    }
    expect((await readLibrary(paths)).map((e) => e.name)).toEqual(['a', 'b', 'c'])
  })

  it('skips hidden entries', async () => {
    const target = join(home, 'src', 'x')
    await skillFolder(target)
    await mkdir(join(paths.library, '.trash'), { recursive: true })
    await writeFile(join(paths.library, '.DS_Store'), '')
    await symlink(target, join(paths.library, 'x'))
    expect((await readLibrary(paths)).map((e) => e.name)).toEqual(['x'])
  })
})
