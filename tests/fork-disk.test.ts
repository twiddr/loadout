import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '../src/core/config'
import { readLibrary } from '../src/core/library'
import { pathsFrom, type Paths } from '../src/core/paths'
import { planToggle } from '../src/core/planner'
import { applyOps, ensureLoadout, snapshot } from '../src/main/disk'
import { copyForFork, forkEntry } from '../src/main/fork'
import { skillFiles, skillFolders } from '../src/main/reviews'

let home: string
let paths: Paths
let config: Config
let parent: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'loadout-fork-'))
  paths = pathsFrom(home)
  config = structuredClone(DEFAULT_CONFIG)
  config.agents[0].enabled = true
  await ensureLoadout(paths)
  parent = join(home, 'Code')
  await mkdir(parent)
})

const exists = (path: string): Promise<boolean> =>
  lstat(path).then(
    () => true,
    () => false
  )

async function write(path: string, text: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}

const GH_SKILL = '---\nname: probe-gh\ndescription: Probe.\n---\nRun probe-gh now.\n'
const agentFolder = (): string => join(home, '.claude', 'skills')

/** A github entry probe-gh, linked in agent 0's folder. Returns its folder. */
async function githubEntry(): Promise<string> {
  const dir = join(paths.repos, 'acme', 'tools', 'skills', 'probe-gh')
  await write(join(dir, 'SKILL.md'), GH_SKILL)
  await symlink(dir, join(paths.library, 'probe-gh'), 'dir')
  const { entries, folders } = await snapshot(config, paths)
  const plan = planToggle(
    { skill: 'probe-gh', agentId: 'claude-code', on: true },
    config.agents,
    entries,
    folders,
    paths
  )
  if (!plan.ok) throw new Error(plan.message)
  await applyOps(plan.ops)
  return dir
}

const libraryNames = async (): Promise<string[]> => (await readLibrary(paths)).map((e) => e.name)

describe('copyForFork', () => {
  test('leaves out the skipped names and the root Tessl files', async () => {
    const from = join(home, 'src')
    for (const rel of [
      'SKILL.md',
      'scripts/run.sh',
      '.git/HEAD',
      'node_modules/x/i.js',
      'sub/__pycache__/a.pyc',
      '.DS_Store',
      '.tessl-plugin/plugin.json',
      'tile.json',
      'tessl-package.json',
      'examples/tile.json'
    ]) {
      await write(join(from, rel), rel)
    }
    await mkdir(join(from, 'assets'))
    await symlink('SKILL.md', join(from, 'link'))
    const to = join(home, 'copy')
    await mkdir(to)

    expect(await copyForFork(from, to)).toEqual([
      '.tessl-plugin/',
      'tile.json',
      'tessl-package.json'
    ])
    expect((await skillFiles(to)).sort((a, b) => (a.rel < b.rel ? -1 : 1))).toEqual([
      { rel: 'SKILL.md', link: false },
      { rel: 'examples/tile.json', link: false },
      { rel: 'link', link: true },
      { rel: 'scripts/run.sh', link: false }
    ])
    expect((await skillFolders(to)).sort()).toEqual(['assets', 'examples', 'scripts', 'sub'])
    expect(await readdir(to)).not.toContain('.git')
    expect(await readdir(join(to, 'sub'))).toEqual([])
    expect(await readlink(join(to, 'link'))).toBe('SKILL.md')
    expect(await readFile(join(to, 'scripts/run.sh'), 'utf8')).toBe('scripts/run.sh')
  })

  test('returns [] when there are no Tessl files', async () => {
    const from = join(home, 'src')
    await write(join(from, 'SKILL.md'), 'x')
    await mkdir(join(home, 'copy'))
    expect(await copyForFork(from, join(home, 'copy'))).toEqual([])
  })
})

describe('forkEntry', () => {
  test('copies, renames, adds and moves the toggles', async () => {
    const dir = await githubEntry()
    const folder = join(parent, 'my-gh')

    expect(await forkEntry('probe-gh', 'my-gh', parent, config, paths)).toEqual({
      ok: true,
      name: 'my-gh',
      folder,
      leftOut: [],
      moved: ['Claude Code'],
      failed: [],
      occurrences: ['SKILL.md:5: Run probe-gh now.']
    })
    expect(await readFile(join(folder, 'SKILL.md'), 'utf8')).toBe(
      GH_SKILL.replace('name: probe-gh', 'name: my-gh')
    )
    expect(await readlink(join(paths.library, 'my-gh'))).toBe(folder)
    expect(await readlink(join(paths.library, 'probe-gh'))).toBe(dir)
    expect((await readdir(agentFolder())).sort()).toEqual(['my-gh'])
    expect(await readFile(join(dir, 'SKILL.md'), 'utf8')).toBe(GH_SKILL)
  })

  test('refuses a name already in the library', async () => {
    await githubEntry()
    expect(await forkEntry('probe-gh', 'probe-gh', parent, config, paths)).toEqual({
      ok: false,
      message: '"probe-gh" is already in your loadout. Remove it first or rename the new skill.'
    })
    expect(await readdir(parent)).toEqual([])
  })

  test('refuses a name that does not match the pattern', async () => {
    await githubEntry()
    expect(await forkEntry('probe-gh', 'Bad_Name', parent, config, paths)).toEqual({
      ok: false,
      message: 'Skill name "Bad_Name" must be lowercase letters, digits and single hyphens.'
    })
    expect(await readdir(parent)).toEqual([])
  })

  test('refuses an existing target and leaves it as it is', async () => {
    await githubEntry()
    await write(join(parent, 'my-gh', 'mine.txt'), 'mine')
    expect(await forkEntry('probe-gh', 'my-gh', parent, config, paths)).toEqual({
      ok: false,
      message: `${join(parent, 'my-gh')} already exists. Pick another folder or name.`
    })
    expect(await readdir(join(parent, 'my-gh'))).toEqual(['mine.txt'])
    expect(await libraryNames()).toEqual(['probe-gh'])
  })

  test('refuses an entry whose source folder is missing', async () => {
    const gone = join(home, 'gone')
    await symlink(gone, join(paths.library, 'gone'), 'dir')
    expect(await forkEntry('gone', 'my-gone', parent, config, paths)).toEqual({
      ok: false,
      message: `"gone" cannot be forked: its source folder ${gone} is missing.`
    })
    expect(await readdir(parent)).toEqual([])
  })

  test('refuses a skill that is not in the library', async () => {
    expect(await forkEntry('nope', 'my-nope', parent, config, paths)).toEqual({
      ok: false,
      message: '"nope" is not in your loadout.'
    })
  })

  test('deletes the new folder when the rename fails', async () => {
    const dir = join(home, 'src', 'odd')
    await write(join(dir, 'SKILL.md'), '---\ndescription: x\n---\n')
    await symlink(dir, join(paths.library, 'odd'), 'dir')
    expect(await forkEntry('odd', 'odd-2', parent, config, paths)).toEqual({
      ok: false,
      message: 'Fork failed: SKILL.md of "odd" has no "name" line in its frontmatter.',
      deleted: join(parent, 'odd-2')
    })
    expect(await exists(join(parent, 'odd-2'))).toBe(false)
    expect(await libraryNames()).toEqual(['odd'])
  })

  test('never writes through a symlinked SKILL.md', async () => {
    const outside = join(home, 'outside', 'real.md')
    const original = '---\nname: odd\ndescription: x\n---\nBody.\n'
    await write(outside, original)
    const dir = join(home, 'src', 'odd')
    await mkdir(dir, { recursive: true })
    await symlink(outside, join(dir, 'SKILL.md'))
    await symlink(dir, join(paths.library, 'odd'), 'dir')

    expect(await forkEntry('odd', 'odd-2', parent, config, paths)).toMatchObject({ ok: true })
    expect(await readFile(outside, 'utf8')).toBe(original)
    const copy = join(parent, 'odd-2', 'SKILL.md')
    expect((await lstat(copy)).isSymbolicLink()).toBe(false)
    expect(await readFile(copy, 'utf8')).toBe(original.replace('name: odd', 'name: odd-2'))
  })

  test('deletes nothing and omits "deleted" when the folder could not be created', async () => {
    await githubEntry()
    await chmod(parent, 0o555)
    try {
      const result = await forkEntry('probe-gh', 'my-gh', parent, config, paths)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.message).toMatch(/^Fork failed: /)
      expect('deleted' in result).toBe(false)
    } finally {
      await chmod(parent, 0o755)
    }
  })

  test('keeps the original on when the fork cannot be switched on', async () => {
    await githubEntry()
    await mkdir(join(agentFolder(), 'my-gh'))
    const result = await forkEntry('probe-gh', 'my-gh', parent, config, paths)
    expect(result).toMatchObject({
      ok: true,
      moved: [],
      failed: [
        {
          agent: 'Claude Code',
          message: `${join(agentFolder(), 'my-gh')} already exists and Loadout did not create it. Recruit it on the Recon page, or remove it by hand.`
        }
      ]
    })
    expect(await readlink(join(agentFolder(), 'probe-gh'))).toBe(join(paths.library, 'probe-gh'))
    expect(await libraryNames()).toEqual(['my-gh', 'probe-gh'])
  })
})
