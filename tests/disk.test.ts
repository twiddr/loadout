import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  agentFolder,
  DEFAULT_CONFIG,
  readConfig,
  writeConfig,
  type Config
} from '../src/core/config'
import { readLibrary } from '../src/core/library'
import { pathsFrom, type Paths } from '../src/core/paths'
import { planToggle, type Op } from '../src/core/planner'
import {
  addLocal,
  applyOps,
  deployAdded,
  ensureLoadout,
  linkCandidates,
  listLinks,
  relocateEntry,
  removeEntry,
  removeInstallLinks,
  removePack,
  snapshot,
  togglePack
} from '../src/main/disk'

let home: string
let paths: Paths
let config: Config

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'loadout-disk-'))
  paths = pathsFrom(home)
  config = structuredClone(DEFAULT_CONFIG)
  config.agents[0].enabled = true
})

async function skill(folder: string, name = 'good'): Promise<string> {
  const dir = join(folder, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n`)
  return dir
}

const exists = (path: string): Promise<boolean> =>
  lstat(path).then(
    () => true,
    () => false
  )

describe('ensureLoadout', () => {
  test('creates folders and the default config, and never rewrites a config', async () => {
    await ensureLoadout(paths)
    await ensureLoadout(paths)
    for (const dir of [paths.loadout, paths.library, paths.repos])
      expect(await exists(dir)).toBe(true)
    expect(await readConfig(paths)).toEqual(DEFAULT_CONFIG)

    await writeConfig(paths, { ...DEFAULT_CONFIG, tesslWorkspace: 'x' })
    await ensureLoadout(paths)
    expect((await readConfig(paths)).tesslWorkspace).toBe('x')
  })

  test('leaves a broken config as it is', async () => {
    await ensureLoadout(paths)
    await writeFile(paths.config, '{ nope')
    await ensureLoadout(paths)
    expect(await readFile(paths.config, 'utf8')).toBe('{ nope')
  })
})

describe('applyOps', () => {
  test('creates a folder and a link', async () => {
    const dir = join(home, 'a', 'b')
    const link = join(dir, 'l')
    await applyOps([
      { op: 'mkdir', path: dir },
      { op: 'link', path: link, target: home }
    ])
    expect(await readlink(link)).toBe(home)
  })

  test('stops at the first failure with the exact text', async () => {
    const file = join(home, 'f')
    await writeFile(file, '')
    await expect(applyOps([{ op: 'link', path: file, target: home }])).rejects.toThrow(
      `Link failed: EEXIST: file already exists at ${file}.`
    )
    await expect(
      applyOps([{ op: 'unlink', path: join(home, 'none'), target: home }])
    ).rejects.toThrow(/^Unlink failed: ENOENT: no such file or directory at /)
  })
})

describe('applyOps unlink after the folder changed', () => {
  // The plan is made from a read of the disk; the path is replaced before the plan runs.
  async function planOff(): Promise<{ link: string; ops: Op[] }> {
    await ensureLoadout(paths)
    await addLocal(await skill(join(home, 'src')), paths)
    const link = join(home, '.claude', 'skills', 'good')
    const read = await snapshot(config, paths)
    const on = planToggle(
      { skill: 'good', agentId: 'claude-code', on: true },
      config.agents,
      read.entries,
      read.folders,
      paths
    )
    if (!on.ok) throw new Error(on.message)
    await applyOps(on.ops)
    const now = await snapshot(config, paths)
    const off = planToggle(
      { skill: 'good', agentId: 'claude-code', on: false },
      config.agents,
      now.entries,
      now.folders,
      paths
    )
    if (!off.ok) throw new Error(off.message)
    return { link, ops: off.ops }
  }

  test('refuses to delete a regular file that replaced the link', async () => {
    const { link, ops } = await planOff()
    await unlink(link)
    await writeFile(link, 'REPLACEMENT USER FILE')
    await expect(applyOps(ops)).rejects.toThrow(
      `Unlink refused: ${link} changed after Loadout read it, so Loadout left it as it is. Try again.`
    )
    expect(await readFile(link, 'utf8')).toBe('REPLACEMENT USER FILE')
  })

  test('refuses to delete a link to another target that replaced the link', async () => {
    const { link, ops } = await planOff()
    await unlink(link)
    await symlink(join(home, 'elsewhere'), link)
    await expect(applyOps(ops)).rejects.toThrow(/^Unlink refused: /)
    expect(await readlink(link)).toBe(join(home, 'elsewhere'))
  })

  test('still removes the managed link and keeps the skill folder', async () => {
    const { link, ops } = await planOff()
    await applyOps(ops)
    expect(await exists(link)).toBe(false)
    expect(await exists(join(home, 'src', 'good', 'SKILL.md'))).toBe(true)
  })
})

describe('snapshot', () => {
  test('lists entries with enabledFor and one folder per agent', async () => {
    await ensureLoadout(paths)
    const dir = await skill(join(home, 'src'))
    await symlink(dir, join(paths.library, 'good'), 'dir')
    await mkdir(join(home, '.claude', 'skills'), { recursive: true })
    await symlink(join(paths.library, 'good'), join(home, '.claude', 'skills', 'good'), 'dir')
    const snap = await snapshot(config, paths)
    expect(snap.entries[0].enabledFor).toEqual(['claude-code'])
    expect(snap.unmanaged).toEqual([])
    expect(snap.folders).toHaveLength(2)
  })
})

describe('snapshot with a missing library entry', () => {
  test('shows the orphaned agent link as a dangling unmanaged link, not managed', async () => {
    await ensureLoadout(paths)
    await mkdir(join(home, '.claude', 'skills'), { recursive: true })
    await symlink(join(paths.library, 'gone'), join(home, '.claude', 'skills', 'gone'), 'dir')
    const snap = await snapshot(config, paths)
    expect(snap.folders[0].managed).toEqual([])
    expect(snap.unmanaged).toEqual([
      {
        agentId: 'claude-code',
        name: 'gone',
        kind: 'link',
        target: join(paths.library, 'gone'),
        dangling: true
      }
    ])
  })
})

describe('addLocal', () => {
  test('links a folder whose parent has a space, then refuses a duplicate', async () => {
    await ensureLoadout(paths)
    const dir = await skill(join(home, 'Code', 'My Skills'))
    expect(await addLocal(dir, paths)).toEqual({ ok: true, name: 'good' })
    expect(await readlink(join(paths.library, 'good'))).toBe(dir)
    expect(await addLocal(dir, paths)).toEqual({
      ok: false,
      message: '"good" is already in your loadout. Remove it first or rename the new skill.'
    })
  })
})

describe('a folder under the backups', () => {
  const refusal = (name: string): string =>
    `~/.loadout/backups/claude-code/${name} is in ~/.loadout/backups, where Recruit keeps originals for UNDO. Use UNDO on the Recon page, or copy the skill to another folder first.`

  test('addLocal refuses it', async () => {
    await ensureLoadout(paths)
    const dir = await skill(join(paths.backups, 'claude-code'))
    expect(await addLocal(dir, paths)).toEqual({ ok: false, message: refusal('good') })
    expect(await exists(join(paths.library, 'good'))).toBe(false)
  })

  test('addLocal refuses it through a link to the backups', async () => {
    await ensureLoadout(paths)
    await skill(join(paths.backups, 'claude-code'))
    await symlink(join(paths.backups, 'claude-code'), join(home, 'shortcut'))
    const result = await addLocal(join(home, 'shortcut', 'good'), paths)
    expect(result).toMatchObject({ ok: false })
    expect(await exists(join(paths.library, 'good'))).toBe(false)
  })

  test('relocateEntry refuses it and keeps the old link', async () => {
    await ensureLoadout(paths)
    const dir = await skill(join(home, 'src'))
    await addLocal(dir, paths)
    const backup = await skill(join(paths.backups, 'claude-code'))
    expect(await relocateEntry('good', backup, paths)).toEqual({
      ok: false,
      message: refusal('good')
    })
    expect(await readlink(join(paths.library, 'good'))).toBe(dir)
  })
})

describe('removeEntry', () => {
  test('removes a relative agent link in a linked agent folder (GNU stow)', async () => {
    // ~/.claude/skills -> ~/dotfiles/claude/skills; the link text is relative to the real folder.
    const real = pathsFrom(await realpath(home))
    await ensureLoadout(real)
    await addLocal(await skill(join(real.home, 'src')), real)
    const dotfiles = join(real.home, 'dotfiles', 'claude', 'skills')
    await mkdir(dotfiles, { recursive: true })
    await mkdir(join(real.home, '.claude'), { recursive: true })
    await symlink(dotfiles, join(real.home, '.claude', 'skills'))
    await symlink('../../../.loadout/skills/good', join(dotfiles, 'good'))
    expect((await snapshot(config, real)).entries[0].enabledFor).toEqual(['claude-code'])
    expect(await removeEntry('good', config, real)).toEqual({ ok: true, unusedClone: null })
    expect(await exists(join(dotfiles, 'good'))).toBe(false)
  })

  test('removes the agent link and the library link', async () => {
    await ensureLoadout(paths)
    const dir = await skill(join(home, 'src'))
    await addLocal(dir, paths)
    const agentLink = join(home, '.claude', 'skills', 'good')
    await mkdir(join(home, '.claude', 'skills'), { recursive: true })
    await symlink(join(paths.library, 'good'), agentLink, 'dir')
    expect(await removeEntry('good', config, paths)).toEqual({ ok: true, unusedClone: null })
    expect(await exists(agentLink)).toBe(false)
    expect(await exists(join(paths.library, 'good'))).toBe(false)
    expect(await exists(dir)).toBe(true)
  })

  test('refuses an unknown name and a library entry that is not a link', async () => {
    await ensureLoadout(paths)
    expect(await removeEntry('nope', config, paths)).toEqual({
      ok: false,
      message: '"nope" is not in your loadout.'
    })
    await mkdir(join(paths.library, 'real'))
    expect(await removeEntry('real', config, paths)).toEqual({
      ok: false,
      message: '"real" is not a symlink in your loadout. Fix it in Finder first.'
    })
    expect(await exists(join(paths.library, 'real'))).toBe(true)
  })

  test('removes the library link and leaves an unmanaged same-name entry alone', async () => {
    await ensureLoadout(paths)
    await addLocal(await skill(join(home, 'src')), paths)
    const unmanaged = await skill(join(home, '.claude', 'skills'))
    expect(await removeEntry('good', config, paths)).toEqual({ ok: true, unusedClone: null })
    expect(await exists(join(paths.library, 'good'))).toBe(false)
    expect(await exists(join(unmanaged, 'SKILL.md'))).toBe(true)
  })
})

async function clone(): Promise<string> {
  const root = join(paths.repos, 'acme', 'tools')
  await skill(join(root, 'skills'), 'alpha')
  await skill(join(root, 'skills'), 'beta')
  return root
}

describe('linkCandidates', () => {
  test('links each name to its folder in the clone', async () => {
    await ensureLoadout(paths)
    const root = await clone()
    const result = await linkCandidates(root, ['alpha', 'beta'], paths)
    expect(result).toEqual({
      ok: true,
      added: [
        { name: 'alpha', folder: join(root, 'skills', 'alpha') },
        { name: 'beta', folder: join(root, 'skills', 'beta') }
      ]
    })
    expect(await readlink(join(paths.library, 'alpha'))).toBe(join(root, 'skills', 'alpha'))
    const alpha = (await readLibrary(paths)).find((e) => e.name === 'alpha')
    expect(alpha?.source).toEqual({
      type: 'github',
      owner: 'acme',
      repo: 'tools',
      subpath: 'skills/alpha'
    })
  })

  test('names the link by the frontmatter name when the folder name differs', async () => {
    await ensureLoadout(paths)
    const root = join(paths.repos, 'acme', 'taste')
    const folder = join(root, 'skills', 'soft-skill')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'SKILL.md'), '---\nname: high-end-visual-design\n---\n')
    expect(await linkCandidates(root, ['high-end-visual-design'], paths)).toEqual({
      ok: true,
      added: [{ name: 'high-end-visual-design', folder }]
    })
    expect(await readlink(join(paths.library, 'high-end-visual-design'))).toBe(folder)
  })

  test('links a clone root that holds SKILL.md', async () => {
    await ensureLoadout(paths)
    const root = join(paths.repos, 'acme', 'tools')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'SKILL.md'), '---\nname: tools\n---\n')
    expect(await linkCandidates(root, ['tools'], paths)).toEqual({
      ok: true,
      added: [{ name: 'tools', folder: root }]
    })
    const entry = (await readLibrary(paths)).find((e) => e.name === 'tools')
    expect(entry?.source).toEqual({ type: 'github', owner: 'acme', repo: 'tools', subpath: '' })
  })

  test('links nothing when a name is not offered', async () => {
    await ensureLoadout(paths)
    const root = await clone()
    expect(await linkCandidates(root, ['alpha', 'nope'], paths)).toEqual({
      ok: false,
      message: '"nope" cannot be added from acme/tools; scan it again.'
    })
    expect(await exists(join(paths.library, 'alpha'))).toBe(false)
  })

  test('refuses a name already in the library', async () => {
    await ensureLoadout(paths)
    const root = await clone()
    await addLocal(await skill(join(home, 'src'), 'alpha'), paths)
    expect(await linkCandidates(root, ['alpha'], paths)).toEqual({
      ok: false,
      message: '"alpha" cannot be added from acme/tools; scan it again.'
    })
  })

  test('refuses a root that is not a clone root under repos', async () => {
    await ensureLoadout(paths)
    const root = await clone()
    for (const bad of [join(home, 'elsewhere'), join(root, 'skills')]) {
      expect(await linkCandidates(bad, ['alpha'], paths)).toEqual({
        ok: false,
        message: `${bad} is not a repository clone under ${paths.repos} or a Tessl plugin under ${paths.tesslPlugins}.`
      })
    }
  })
})

describe('removeEntry unusedClone', () => {
  test('reports the clone only once no entry points into it', async () => {
    await ensureLoadout(paths)
    const root = await clone()
    await linkCandidates(root, ['alpha', 'beta'], paths)
    expect(await removeEntry('alpha', config, paths)).toEqual({ ok: true, unusedClone: null })
    expect(await removeEntry('beta', config, paths)).toEqual({ ok: true, unusedClone: root })
  })

  test('reports null for a local entry', async () => {
    await ensureLoadout(paths)
    await addLocal(await skill(join(home, 'src')), paths)
    expect(await removeEntry('good', config, paths)).toEqual({ ok: true, unusedClone: null })
  })
})

describe('togglePack', () => {
  const pack = 'github:acme/tools'
  const request = { pack, agentId: 'claude-code', on: true }

  async function setup(): Promise<string> {
    await ensureLoadout(paths)
    const root = await clone()
    await linkCandidates(root, ['alpha', 'beta'], paths)
    return agentFolder(config.agents[0], paths)
  }

  test('turns on every member and reports the one already on', async () => {
    const folder = await setup()
    await applyOps([{ op: 'mkdir', path: folder }])
    await applyOps([
      { op: 'link', path: join(folder, 'beta'), target: join(paths.library, 'beta') }
    ])
    expect(await togglePack(request, config, paths)).toEqual({
      ok: true,
      changed: ['alpha'],
      already: ['beta'],
      refused: []
    })
    expect(await exists(join(folder, 'alpha'))).toBe(true)
    expect(await exists(join(folder, 'beta'))).toBe(true)
  })

  test('refuses a member whose folder holds a plain entry and does the others', async () => {
    const folder = await setup()
    await mkdir(join(folder, 'alpha'), { recursive: true })
    expect(await togglePack(request, config, paths)).toEqual({
      ok: true,
      changed: ['beta'],
      already: [],
      refused: [{ skill: 'alpha', message: expect.stringContaining('Loadout did not create it') }]
    })
    expect(await exists(join(folder, 'beta'))).toBe(true)
  })

  test('a member whose link cannot be written goes to refused, with the applyOps message', async () => {
    const folder = await setup()
    await mkdir(folder, { recursive: true })
    await chmod(folder, 0o555)
    try {
      expect(await togglePack(request, config, paths)).toEqual({
        ok: true,
        changed: [],
        already: [],
        refused: ['alpha', 'beta'].map((skill) => ({
          skill,
          message: `Link failed: EACCES: permission denied at ${join(folder, skill)}.`
        }))
      })
    } finally {
      await chmod(folder, 0o755)
    }
  })

  test('turns off every member', async () => {
    const folder = await setup()
    await togglePack(request, config, paths)
    expect(await togglePack({ ...request, on: false }, config, paths)).toEqual({
      ok: true,
      changed: ['alpha', 'beta'],
      already: [],
      refused: []
    })
    expect(await exists(join(folder, 'alpha'))).toBe(false)
    expect(await exists(join(folder, 'beta'))).toBe(false)
  })

  test('refuses an unknown pack and an agent that is not enabled', async () => {
    const folder = await setup()
    expect(await togglePack({ ...request, pack: 'github:acme/none' }, config, paths)).toEqual({
      ok: false,
      message: 'This pack is no longer in your loadout.'
    })
    const result = await togglePack({ ...request, agentId: 'codex' }, config, paths)
    expect(result).toEqual({ ok: false, message: expect.stringContaining('is not enabled') })
    expect(await exists(join(agentFolder(config.agents[1], paths), 'alpha'))).toBe(false)
    expect(await exists(join(folder, 'alpha'))).toBe(false)
  })

  test('refuses an unknown agent', async () => {
    await setup()
    expect(await togglePack({ ...request, agentId: 'nope' }, config, paths)).toEqual({
      ok: false,
      message: 'Unknown agent "nope".'
    })
  })

  test('counts a linked member with a missing source as already on', async () => {
    const folder = await setup()
    await togglePack(request, config, paths)
    await rm(join(paths.repos, 'acme', 'tools', 'skills', 'alpha'), { recursive: true })
    expect(await togglePack(request, config, paths)).toEqual({
      ok: true,
      changed: [],
      already: ['alpha', 'beta'],
      refused: []
    })
    expect(await exists(join(folder, 'alpha'))).toBe(true)
  })

  test('counts members that are not linked, or only unmanaged, as already off', async () => {
    const folder = await setup()
    await mkdir(join(folder, 'alpha'), { recursive: true })
    expect(await togglePack({ ...request, on: false }, config, paths)).toEqual({
      ok: true,
      changed: [],
      already: ['alpha', 'beta'],
      refused: []
    })
    expect((await lstat(join(folder, 'alpha'))).isDirectory()).toBe(true)
  })
})

describe('deployAdded', () => {
  async function setup(): Promise<string> {
    await ensureLoadout(paths)
    const root = await clone()
    await linkCandidates(root, ['alpha', 'beta'], paths)
    return agentFolder(config.agents[0], paths)
  }

  test('links every skill for every agent', async () => {
    const folder = await setup()
    expect(await deployAdded(['alpha', 'beta'], ['claude-code'], config, paths)).toEqual([])
    expect(await exists(join(folder, 'alpha'))).toBe(true)
    expect(await exists(join(folder, 'beta'))).toBe(true)
  })

  test('a refused skill does not stop the others', async () => {
    const folder = await setup()
    await mkdir(join(folder, 'alpha'), { recursive: true })
    expect(await deployAdded(['alpha', 'beta'], ['claude-code'], config, paths)).toEqual([
      { skill: 'alpha', message: expect.stringContaining('Loadout did not create it') }
    ])
    expect(await exists(join(folder, 'beta'))).toBe(true)
  })

  test('does nothing for no agent', async () => {
    const folder = await setup()
    expect(await deployAdded(['alpha'], [], config, paths)).toEqual([])
    expect(await exists(join(folder, 'alpha'))).toBe(false)
  })
})

describe('removePack', () => {
  test('removes every member and its agent links, and keeps the clone', async () => {
    await ensureLoadout(paths)
    const root = await clone()
    await linkCandidates(root, ['alpha', 'beta'], paths)
    const request = { pack: 'github:acme/tools', agentId: 'claude-code', on: true }
    await togglePack(request, config, paths)
    const folder = agentFolder(config.agents[0], paths)
    expect(await removePack('github:acme/tools', config, paths)).toEqual({
      ok: true,
      removed: ['alpha', 'beta'],
      refused: [],
      unusedClone: root
    })
    for (const name of ['alpha', 'beta']) {
      expect(await exists(join(paths.library, name))).toBe(false)
      expect(await exists(join(folder, name))).toBe(false)
    }
    expect(await exists(root)).toBe(true)
  })

  test('a Registry pack reports no unused clone', async () => {
    await ensureLoadout(paths)
    const root = await plugin()
    await linkCandidates(root, ['alpha', 'beta'], paths)
    expect(await removePack('tessl:acme/kit', config, paths)).toEqual({
      ok: true,
      removed: ['alpha', 'beta'],
      refused: [],
      unusedClone: null
    })
    expect(await exists(root)).toBe(true)
  })

  test('a refused member stays, the others go, and the clone is still in use', async () => {
    await ensureLoadout(paths)
    const root = await clone()
    await linkCandidates(root, ['alpha', 'beta'], paths)
    const folder = agentFolder(config.agents[0], paths)
    await applyOps([
      { op: 'mkdir', path: folder },
      { op: 'link', path: join(folder, 'alpha'), target: join(paths.library, 'alpha') }
    ])
    await chmod(folder, 0o555)
    try {
      expect(await removePack('github:acme/tools', config, paths)).toEqual({
        ok: true,
        removed: ['beta'],
        refused: [
          {
            skill: 'alpha',
            message: `Unlink failed: EACCES: permission denied at ${join(folder, 'alpha')}.`
          }
        ],
        unusedClone: null
      })
      expect(await exists(join(paths.library, 'alpha'))).toBe(true)
      expect(await exists(join(paths.library, 'beta'))).toBe(false)
    } finally {
      await chmod(folder, 0o755)
    }
  })
})

describe('relocateEntry', () => {
  test('re-links to a new folder and checks the name', async () => {
    await ensureLoadout(paths)
    const dir = await skill(join(home, 'src'))
    await addLocal(dir, paths)
    const moved = await skill(join(home, 'elsewhere'))
    expect(await relocateEntry('good', moved, paths)).toEqual({ ok: true })
    expect(await readlink(join(paths.library, 'good'))).toBe(moved)

    const bad = await skill(join(home, 'elsewhere'), 'bad')
    expect(await relocateEntry('good', bad, paths)).toEqual({
      ok: false,
      message: 'Folder "bad" must be named "good".'
    })
    expect(await relocateEntry('nope', moved, paths)).toEqual({
      ok: false,
      message: '"nope" is not in your loadout.'
    })
    expect((await readdir(paths.library)).filter((n) => n.startsWith('.'))).toEqual([])
  })

  test('keeps the old link when the new link cannot be made', async () => {
    await ensureLoadout(paths)
    const dir = await skill(join(home, 'src'))
    await addLocal(dir, paths)
    const moved = await skill(join(home, 'elsewhere'))
    await chmod(paths.library, 0o555)
    try {
      const result = await relocateEntry('good', moved, paths)
      expect(result.ok).toBe(false)
      expect(await readlink(join(paths.library, 'good'))).toBe(dir)
    } finally {
      await chmod(paths.library, 0o755)
    }
  })
})

async function plugin(): Promise<string> {
  const root = join(paths.tesslPlugins, 'acme', 'kit')
  await skill(join(root, 'skills'), 'alpha')
  await skill(join(root, 'skills'), 'beta')
  return root
}

describe('linkCandidates for a Tessl plugin', () => {
  test('links a candidate and classifies it as tessl', async () => {
    await ensureLoadout(paths)
    const root = await plugin()
    expect(await linkCandidates(root, ['alpha'], paths)).toEqual({
      ok: true,
      added: [{ name: 'alpha', folder: join(root, 'skills', 'alpha') }]
    })
    expect(await readlink(join(paths.library, 'alpha'))).toBe(join(root, 'skills', 'alpha'))
    const entry = (await readLibrary(paths)).find((e) => e.name === 'alpha')
    expect(entry?.source).toEqual({
      type: 'tessl',
      workspace: 'acme',
      plugin: 'kit',
      subpath: 'skills/alpha'
    })
  })

  test('names the plugin when a name is not offered', async () => {
    await ensureLoadout(paths)
    const root = await plugin()
    expect(await linkCandidates(root, ['nope'], paths)).toEqual({
      ok: false,
      message: '"nope" cannot be added from acme/kit; scan it again.'
    })
  })

  test('refuses a folder below the plugin root and a folder elsewhere', async () => {
    await ensureLoadout(paths)
    const root = await plugin()
    for (const bad of [join(root, 'skills'), join(home, 'elsewhere')]) {
      expect(await linkCandidates(bad, ['alpha'], paths)).toEqual({
        ok: false,
        message: `${bad} is not a repository clone under ${paths.repos} or a Tessl plugin under ${paths.tesslPlugins}.`
      })
    }
  })
})

describe('listLinks', () => {
  test('is empty for a missing folder and lists only symlinks', async () => {
    expect(await listLinks(join(home, 'missing'))).toEqual([])
    const folder = join(home, 'f')
    await mkdir(join(folder, 'b'), { recursive: true })
    await writeFile(join(folder, 'c'), '')
    await symlink(home, join(folder, 'a'), 'dir')
    expect(await listLinks(folder)).toEqual(['a'])
  })
})

describe('removeInstallLinks', () => {
  test('removes only new tessl__ links that point into the plugin', async () => {
    const root = await plugin()
    await mkdir(join(paths.tesslPlugins, 'acme', 'other'), { recursive: true })
    await mkdir(paths.agentsSkills, { recursive: true })
    const rel = '../../.tessl/plugins/acme/kit/skills/'
    const link = (name: string, target: string): Promise<void> =>
      symlink(target, join(paths.agentsSkills, name), 'dir')
    await link('tessl__alpha', rel + 'alpha')
    await link('tessl__beta', rel + 'beta')
    await link('tessl__other', '../../.tessl/plugins/acme/other')
    await link('my-skill', rel + 'alpha')
    await link('tessl__root', '../../.tessl/plugins/acme/kit')
    await mkdir(join(paths.agentsSkills, 'tessl__dir'))
    expect(await removeInstallLinks(['tessl__beta'], root, paths)).toEqual([
      join(paths.agentsSkills, 'tessl__alpha'),
      join(paths.agentsSkills, 'tessl__root')
    ])
    expect(await exists(join(paths.agentsSkills, 'tessl__alpha'))).toBe(false)
    expect(await exists(join(paths.agentsSkills, 'tessl__root'))).toBe(false)
    for (const kept of ['tessl__beta', 'tessl__other', 'my-skill', 'tessl__dir']) {
      expect(await exists(join(paths.agentsSkills, kept))).toBe(true)
    }
  })

  test('returns [] when ~/.agents/skills is missing', async () => {
    expect(await removeInstallLinks([], await plugin(), paths)).toEqual([])
  })
})
