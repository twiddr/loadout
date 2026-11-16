import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '../src/core/config'
import type { EntryFacts, Step } from '../src/core/recruit'
import { pathsFrom, type Paths } from '../src/core/paths'
import { addLocal, ensureLoadout, removeEntry, snapshot } from '../src/main/disk'
import {
  candidateDetail,
  compareFolders,
  copyExact,
  linksInside,
  listBackups,
  previewRecruit,
  previewUndo,
  readFacts,
  recruitRows,
  runRecruit,
  runUndo
} from '../src/main/recruit'

let home: string
let paths: Paths
let config: Config
let work: string

beforeEach(async () => {
  // The real path: tmpdir() is under /var, a link to /private/var, and a relative link resolves through it.
  home = await realpath(await mkdtemp(join(tmpdir(), 'loadout-recruit-')))
  paths = pathsFrom(home)
  config = structuredClone(DEFAULT_CONFIG)
  config.agents[0].enabled = true
  await ensureLoadout(paths)
  work = join(home, 'work')
  await mkdir(work)
})

async function write(path: string, text: string, mode?: number): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
  if (mode !== undefined) await chmod(path, mode)
}

const exists = (path: string): Promise<boolean> =>
  lstat(path).then(
    () => true,
    () => false
  )

const SKILL = '---\nname: probe\ndescription: Probe.\n---\nBody.\n'
const claudeFolder = (): string => join(home, '.claude', 'skills')

describe('copyExact', () => {
  test('copies .git, an empty folder, .DS_Store, the mode and the time', async () => {
    const from = join(work, 'from')
    await write(join(from, 'SKILL.md'), SKILL)
    await write(join(from, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    await write(join(from, '.DS_Store'), 'x')
    await write(join(from, 'run.sh'), '#!/bin/sh\n', 0o755)
    await mkdir(join(from, 'empty'))
    const past = new Date('2020-01-02T03:04:05Z')
    await utimes(join(from, 'SKILL.md'), past, past)
    const to = join(work, 'to')
    await copyExact(from, to)
    expect(await exists(join(to, '.git', 'HEAD'))).toBe(true)
    expect(await exists(join(to, '.DS_Store'))).toBe(true)
    expect((await lstat(join(to, 'empty'))).isDirectory()).toBe(true)
    expect((await stat(join(to, 'run.sh'))).mode & 0o777).toBe(0o755)
    expect((await stat(join(to, 'SKILL.md'))).mtimeMs).toBe(past.getTime())
    expect(await readFile(join(to, 'SKILL.md'), 'utf8')).toBe(SKILL)
  })

  test('rejects when the target exists', async () => {
    const from = join(work, 'from')
    await write(join(from, 'SKILL.md'), SKILL)
    const to = join(work, 'to')
    await mkdir(to)
    await expect(copyExact(from, to)).rejects.toThrow()
  })
})

describe('compareFolders', () => {
  async function pair(): Promise<[string, string]> {
    const a = join(work, 'a')
    const b = join(work, 'b')
    for (const root of [a, b]) {
      await write(join(root, 'a.txt'), 'one')
      await write(join(root, 'sub', 'b.txt'), 'two')
      await write(join(root, 'run.sh'), 'go', 0o755)
    }
    return [a, b]
  }

  test('identical folders are the same', async () => {
    const [a, b] = await pair()
    expect(await compareFolders(a, b)).toEqual({
      same: true,
      files: 3,
      differ: [],
      onlyA: [],
      onlyB: []
    })
  })

  test('a changed byte differs', async () => {
    const [a, b] = await pair()
    await write(join(b, 'a.txt'), 'onf')
    const result = await compareFolders(a, b)
    expect(result.same).toBe(false)
    expect(result.differ).toEqual(['a.txt'])
  })

  test('a lost executable bit differs', async () => {
    const [a, b] = await pair()
    await chmod(join(b, 'run.sh'), 0o644)
    expect((await compareFolders(a, b)).differ).toEqual(['run.sh'])
  })

  test('a file on one side is only there', async () => {
    const [a, b] = await pair()
    await write(join(a, 'sub', 'x.txt'), 'x')
    await write(join(b, 'y.txt'), 'y')
    const result = await compareFolders(a, b)
    expect(result.onlyA).toEqual(['sub/x.txt'])
    expect(result.onlyB).toEqual(['y.txt'])
  })

  test('an empty folder on one side is only there', async () => {
    const [a, b] = await pair()
    await mkdir(join(a, 'empty'))
    const result = await compareFolders(a, b)
    expect(result.same).toBe(false)
    expect(result.onlyA).toEqual(['empty'])
  })

  test('.DS_Store and __pycache__ are ignored and not counted', async () => {
    const [a, b] = await pair()
    await write(join(a, '.DS_Store'), 'x')
    await write(join(a, 'sub', '__pycache__', 'x.pyc'), 'x')
    const result = await compareFolders(a, b)
    expect(result.same).toBe(true)
    expect(result.files).toBe(3)
  })
})

describe('linksInside', () => {
  test('lists links, sorted, and does not follow a link to a folder', async () => {
    const folder = join(work, 'skill')
    await write(join(folder, 'real', 'f.txt'), 'x')
    await mkdir(join(folder, 'scripts'))
    await symlink(join(folder, 'real'), join(folder, 'scripts', 'link'))
    await symlink(join(work, 'elsewhere.md'), join(folder, 'SKILL.md'))
    expect(await linksInside(folder)).toEqual(['SKILL.md', 'scripts/link'])
  })

  test('gives [] when there are none', async () => {
    await write(join(work, 'plain', 'SKILL.md'), SKILL)
    expect(await linksInside(join(work, 'plain'))).toEqual([])
  })
})

describe('readFacts', () => {
  async function facts(entry: string): Promise<EntryFacts> {
    const snap = await snapshot(config, paths)
    const item = snap.unmanaged.find((u) => u.name === entry)
    if (!item) throw new Error(`no ${entry}`)
    return readFacts(config.agents[0], item, paths)
  }

  test('a real folder', async () => {
    await write(join(claudeFolder(), 'probe', 'SKILL.md'), '---\nname: other\n---\n')
    expect(await facts('probe')).toEqual({
      agentId: 'claude-code',
      entry: 'probe',
      path: join(claudeFolder(), 'probe'),
      kind: 'folder',
      target: null,
      dangling: false,
      hasSkillMd: true,
      skillName: 'other'
    })
  })

  test('a link to a skill folder reads the name through the link', async () => {
    const real = join(work, 'real')
    await write(join(real, 'SKILL.md'), SKILL)
    await mkdir(claudeFolder(), { recursive: true })
    await symlink(real, join(claudeFolder(), 'alias'))
    const f = await facts('alias')
    expect(f.kind).toBe('link')
    expect(f.target).toBe(real)
    expect(f.dangling).toBe(false)
    expect(f.hasSkillMd).toBe(true)
    expect(f.skillName).toBe('probe')
  })

  test('a dangling link', async () => {
    await mkdir(claudeFolder(), { recursive: true })
    await symlink(join(work, 'gone'), join(claudeFolder(), 'dead'))
    const f = await facts('dead')
    expect(f.dangling).toBe(true)
    expect(f.hasSkillMd).toBe(false)
    expect(f.skillName).toBeNull()
  })

  test('a file', async () => {
    await write(join(claudeFolder(), 'note.txt'), 'x')
    const f = await facts('note.txt')
    expect(f.kind).toBe('file')
    expect(f.hasSkillMd).toBe(false)
  })

  test('a folder without SKILL.md', async () => {
    await write(join(claudeFolder(), 'bare', 'readme.md'), 'x')
    const f = await facts('bare')
    expect(f.hasSkillMd).toBe(false)
    expect(f.skillName).toBeNull()
  })
})

describe('listBackups', () => {
  test('lists folders and links, skips dot-names and stray files, sorted', async () => {
    await mkdir(join(paths.backups, 'claude-code', 'x'), { recursive: true })
    await symlink(join(work, 't'), join(paths.backups, 'claude-code', 'y'))
    await write(join(paths.backups, 'claude-code', '.DS_Store'), 'x')
    await write(join(paths.backups, '.DS_Store'), 'x')
    await write(join(paths.backups, 'stray'), 'x')
    await mkdir(join(paths.backups, 'old-agent', 'z'), { recursive: true })
    expect(await listBackups(paths)).toEqual([
      { agentId: 'claude-code', entry: 'x', kind: 'folder' },
      { agentId: 'claude-code', entry: 'y', kind: 'link' },
      { agentId: 'old-agent', entry: 'z', kind: 'folder' }
    ])
  })

  test('a missing backups folder gives []', async () => {
    expect(await listBackups(paths)).toEqual([])
  })
})

describe('recruitRows', () => {
  test('a real folder is a copy recruit and a file is none', async () => {
    await write(join(claudeFolder(), 'probe', 'SKILL.md'), SKILL)
    await write(join(claudeFolder(), 'note.txt'), 'x')
    const rows = await recruitRows(await snapshot(config, paths), config, paths)
    expect(rows.find((r) => r.name === 'probe')?.recruit).toEqual({
      kind: 'recruit',
      mode: 'copy',
      name: 'probe'
    })
    expect(rows.find((r) => r.name === 'note.txt')?.recruit).toEqual({ kind: 'none' })
  })
})

const CC = 'claude-code'
const noLog = (): void => {}

async function skillAt(folder: string, name: string, body = 'Body.\n'): Promise<void> {
  await write(join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: D.\n---\n${body}`)
}

/** Every path under `root`, with its kind, size or link text, sorted. */
async function listing(root: string = home): Promise<string[]> {
  const out: string[] = []
  for (const rel of await readdir(root, { recursive: true })) {
    const full = join(root, rel)
    const info = await lstat(full)
    if (info.isSymbolicLink()) out.push(`${rel} -> ${await readlink(full)}`)
    else out.push(`${rel} ${info.isDirectory() ? 'dir' : info.size}`)
  }
  return out.sort()
}

async function confirmed(entry: string, parent: string | null): Promise<string[]> {
  const preview = await previewRecruit(CC, entry, parent, config, paths)
  if (!preview.ok) throw new Error(preview.message)
  return [...preview.notes, ...preview.steps, ...preview.more]
}

async function recruit(
  entry: string,
  parent: string | null = null,
  hooks?: { before?: (step: Step) => Promise<void> },
  log: (line: string) => void = noLog
): ReturnType<typeof runRecruit> {
  return runRecruit(CC, entry, parent, await confirmed(entry, parent), config, paths, log, hooks)
}

const backup = (entry: string): string => join(paths.backups, CC, entry)
const parentFolder = (): string => join(home, 'Code', 'skills')
const GITHUB_NOTE =
  'Did this skill come from GitHub? Cancel, add it with Recruit skill › Link, and open this again: you can then switch to that copy.'

describe('runRecruit', () => {
  test('mode copy: copies, verifies, adds, moves and links', async () => {
    const original = join(claudeFolder(), 'probe')
    await write(join(original, 'SKILL.md'), SKILL)
    await write(join(original, 'run.sh'), '#!/bin/sh\n', 0o755)
    await write(join(original, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    const parent = parentFolder()
    await mkdir(parent, { recursive: true })
    const bytes = Buffer.byteLength(SKILL) + 10 + 21

    expect(await previewRecruit(CC, 'probe', null, config, paths)).toMatchObject({
      ok: true,
      needsFolder: true,
      more: [],
      steps: []
    })
    expect(await previewRecruit(CC, 'probe', parent, config, paths)).toEqual({
      ok: true,
      mode: 'copy',
      facts: {
        found: '~/.claude/skills/probe',
        skill: 'probe',
        size: `3 files · ${bytes} B`,
        inLoadout: 'no'
      },
      notes: [
        'This folder is a git repository. The copy keeps its history. Loadout runs no git command.',
        GITHUB_NOTE
      ],
      needsFolder: false,
      more: [],
      steps: [
        'Copy ~/.claude/skills/probe to ~/Code/skills/probe.',
        'Check that the copy is identical to your original.',
        'Add probe to your loadout, linked to ~/Code/skills/probe.',
        'Move your original from ~/.claude/skills/probe to ~/.loadout/backups/claude-code/probe. It stays there, unchanged.',
        "Link ~/.claude/skills/probe to your loadout's probe, so Claude Code keeps loading the skill."
      ]
    })

    const lines: string[] = []
    expect(await recruit('probe', parent, undefined, (l) => lines.push(l))).toEqual({
      ok: true,
      name: 'probe',
      files: 3,
      backup: '~/.loadout/backups/claude-code/probe',
      chain: '~/.claude/skills/probe → ~/.loadout/skills/probe → ~/Code/skills/probe'
    })
    expect((await compareFolders(join(parent, 'probe'), backup('probe'))).same).toBe(true)
    expect(await exists(join(parent, 'probe', '.git', 'HEAD'))).toBe(true)
    expect(await readlink(join(paths.library, 'probe'))).toBe(join(parent, 'probe'))
    expect(await readlink(original)).toBe(join(paths.library, 'probe'))
    expect(lines).toEqual([
      'Copied ~/.claude/skills/probe to ~/Code/skills/probe.',
      'Verified: 3 files, identical.',
      'Added probe to your loadout, linked to ~/Code/skills/probe.',
      'Moved your original from ~/.claude/skills/probe to ~/.loadout/backups/claude-code/probe.',
      "Linked ~/.claude/skills/probe to your loadout's probe, so Claude Code keeps loading the skill."
    ])
  })

  test('mode in place with a relative link: the backup keeps the link text; UNDO makes it resolve again', async () => {
    const target = join(home, 'Code', 'my-skills', 'sample-linked')
    await skillAt(target, 'sample-linked')
    await mkdir(claudeFolder(), { recursive: true })
    const entry = join(claudeFolder(), 'sample-linked')
    const text = '../../Code/my-skills/sample-linked'
    await symlink(text, entry)

    expect(await previewRecruit(CC, 'sample-linked', null, config, paths)).toEqual({
      ok: true,
      mode: 'in-place',
      facts: {
        found: '~/.claude/skills/sample-linked → ~/Code/my-skills/sample-linked',
        skill: 'sample-linked',
        size: null,
        inLoadout: 'no'
      },
      notes: [],
      needsFolder: false,
      more: [],
      steps: [
        'Add sample-linked to your loadout, linked to ~/Code/my-skills/sample-linked.',
        'Move your original from ~/.claude/skills/sample-linked to ~/.loadout/backups/claude-code/sample-linked. It stays there, unchanged.',
        "Link ~/.claude/skills/sample-linked to your loadout's sample-linked, so Claude Code keeps loading the skill."
      ]
    })
    expect(await recruit('sample-linked')).toEqual({
      ok: true,
      name: 'sample-linked',
      files: null,
      backup: '~/.loadout/backups/claude-code/sample-linked',
      chain:
        '~/.claude/skills/sample-linked → ~/.loadout/skills/sample-linked → ~/Code/my-skills/sample-linked'
    })
    expect(await readlink(backup('sample-linked'))).toBe(text)
    await expect(stat(backup('sample-linked'))).rejects.toThrow()
    expect(await readlink(join(paths.library, 'sample-linked'))).toBe(target)
    expect(await readlink(entry)).toBe(join(paths.library, 'sample-linked'))

    expect(await runUndo(CC, 'sample-linked', config, paths, noLog)).toEqual({
      ok: true,
      path: '~/.claude/skills/sample-linked',
      off: 'sample-linked'
    })
    expect(await readlink(entry)).toBe(text)
    expect((await stat(join(entry, 'SKILL.md'))).isFile()).toBe(true)
    expect(await readlink(join(paths.library, 'sample-linked'))).toBe(target)
  })

  test('mode library with the same content: moves and links, no copy', async () => {
    const lib = join(work, 'lib', 'probe')
    await skillAt(lib, 'probe')
    expect((await addLocal(lib, paths)).ok).toBe(true)
    await skillAt(join(claudeFolder(), 'probe'), 'probe')
    const size = Buffer.byteLength('---\nname: probe\ndescription: D.\n---\nBody.\n')

    expect(await previewRecruit(CC, 'probe', null, config, paths)).toEqual({
      ok: true,
      mode: 'library',
      facts: {
        found: '~/.claude/skills/probe',
        skill: 'probe',
        size: `1 file · ${size} B`,
        inLoadout: 'yes · same content'
      },
      notes: [
        'Your loadout already has this skill with the same content. Loadout will not make another copy.'
      ],
      needsFolder: false,
      more: [],
      steps: [
        'Move your original from ~/.claude/skills/probe to ~/.loadout/backups/claude-code/probe. It stays there, unchanged.',
        "Link ~/.claude/skills/probe to your loadout's probe, so Claude Code keeps loading the skill."
      ]
    })
    expect(await recruit('probe')).toEqual({
      ok: true,
      name: 'probe',
      files: null,
      backup: '~/.loadout/backups/claude-code/probe',
      chain: '~/.claude/skills/probe → ~/.loadout/skills/probe → ~/work/lib/probe'
    })
    expect((await compareFolders(lib, backup('probe'))).same).toBe(true)
    expect(await readlink(join(claudeFolder(), 'probe'))).toBe(join(paths.library, 'probe'))
    expect(await readlink(join(paths.library, 'probe'))).toBe(lib)

    expect(await runUndo(CC, 'probe', config, paths, noLog)).toEqual({
      ok: true,
      path: '~/.claude/skills/probe',
      off: 'probe'
    })
    expect((await lstat(join(claudeFolder(), 'probe'))).isDirectory()).toBe(true)
    expect((await compareFolders(lib, join(claudeFolder(), 'probe'))).same).toBe(true)
    expect(await readlink(join(paths.library, 'probe'))).toBe(lib)
    expect(await exists(backup('probe'))).toBe(false)
  })

  test('mode library: a change past line 20 of the difference list is seen', async () => {
    const lib = join(work, 'lib', 'probe')
    const mine = join(claudeFolder(), 'probe')
    await skillAt(lib, 'probe')
    await skillAt(mine, 'probe')
    for (let i = 1; i <= 22; i++) {
      const file = `f${String(i).padStart(2, '0')}.txt`
      await write(join(lib, file), 'a')
      await write(join(mine, file), 'b')
    }
    expect((await addLocal(lib, paths)).ok).toBe(true)
    const preview = await previewRecruit(CC, 'probe', null, config, paths)
    expect(preview.ok && preview.notes).toContain('and 2 more')
    expect(preview.ok && preview.more).toEqual(['f21.txt differs', 'f22.txt differs'])
    const shown = await confirmed('probe', null)
    // The same count and the same first 20 lines: only the hidden lines change.
    await writeFile(join(mine, 'f22.txt'), 'a')
    await write(join(mine, 'f23.txt'), 'b')
    expect(await runRecruit(CC, 'probe', null, shown, config, paths, noLog)).toEqual({
      ok: false,
      message: '~/.claude/skills/probe changed after the preview. Open Recruit again.'
    })
    expect((await lstat(mine)).isDirectory()).toBe(true)
  })

  test("mode library: a link whose target is the loadout entry's source recruits", async () => {
    const lib = join(work, 'lib', 'probe')
    await skillAt(lib, 'probe')
    expect((await addLocal(lib, paths)).ok).toBe(true)
    await mkdir(claudeFolder(), { recursive: true })
    await symlink(lib, join(claudeFolder(), 'probe'))
    expect(await recruit('probe')).toMatchObject({
      ok: true,
      chain: '~/.claude/skills/probe → ~/.loadout/skills/probe → ~/work/lib/probe'
    })
    expect(await readlink(backup('probe'))).toBe(lib)
    expect((await stat(join(claudeFolder(), 'probe', 'SKILL.md'))).isFile()).toBe(true)
  })

  test('mode library with differences lists them', async () => {
    const lib = join(work, 'lib', 'probe')
    await skillAt(lib, 'probe')
    expect((await addLocal(lib, paths)).ok).toBe(true)
    await skillAt(join(claudeFolder(), 'probe'), 'probe', 'Other.\n')

    const preview = await previewRecruit(CC, 'probe', null, config, paths)
    expect(preview).toMatchObject({
      ok: true,
      facts: { inLoadout: 'yes · 1 file differs' },
      notes: [
        'Your copy differs from the one in your loadout:',
        'SKILL.md differs',
        "If you continue, Claude Code uses the loadout's copy. Your copy moves to the backup, unchanged."
      ]
    })
    expect(await recruit('probe')).toMatchObject({ ok: true, name: 'probe' })
    expect(await readFile(join(backup('probe'), 'SKILL.md'), 'utf8')).toContain('Other.')
    expect(await readlink(join(claudeFolder(), 'probe'))).toBe(join(paths.library, 'probe'))
  })

  test('a dangling link moves to the backup', async () => {
    await mkdir(claudeFolder(), { recursive: true })
    await symlink(join(work, 'gone'), join(claudeFolder(), 'dead'))

    expect(await previewRecruit(CC, 'dead', null, config, paths)).toEqual({
      ok: true,
      mode: 'backup',
      facts: {
        found: '~/.claude/skills/dead → ~/work/gone',
        skill: null,
        size: null,
        inLoadout: null
      },
      notes: [],
      needsFolder: false,
      more: [],
      steps: [
        'Move your original from ~/.claude/skills/dead to ~/.loadout/backups/claude-code/dead. It stays there, unchanged.'
      ]
    })
    expect(await recruit('dead')).toEqual({
      ok: true,
      name: null,
      files: null,
      backup: '~/.loadout/backups/claude-code/dead',
      chain: null
    })
    expect(await readlink(backup('dead'))).toBe(join(work, 'gone'))
    expect(await exists(join(claudeFolder(), 'dead'))).toBe(false)
    expect(await previewUndo(CC, 'dead', config, paths)).toEqual({
      ok: true,
      steps: [
        'Move your original from ~/.loadout/backups/claude-code/dead back to ~/.claude/skills/dead.'
      ],
      dangling: true
    })
  })

  test('a link backup that is not dangling, with its agent link off: UNDO says it is not dangling', async () => {
    const target = join(work, 'linked')
    await skillAt(target, 'linked')
    await mkdir(claudeFolder(), { recursive: true })
    await symlink(target, join(claudeFolder(), 'linked'))
    expect((await recruit('linked')).ok).toBe(true)
    await rm(join(claudeFolder(), 'linked'))
    expect(await previewUndo(CC, 'linked', config, paths)).toMatchObject({
      ok: true,
      steps: [
        'Move your original from ~/.loadout/backups/claude-code/linked back to ~/.claude/skills/linked.'
      ],
      dangling: false
    })
  })

  test('an entry name that differs: links use the skill name, the backup the entry name', async () => {
    await skillAt(join(claudeFolder(), 'soft-skill'), 'sample-misnamed')
    const parent = parentFolder()
    await mkdir(parent, { recursive: true })
    const preview = await previewRecruit(CC, 'soft-skill', parent, config, paths)
    expect(preview.ok && preview.notes[0]).toBe(
      "The folder is named soft-skill, but the skill's name is sample-misnamed. Loadout uses the skill's name for its links. Your agent can list the skill as sample-misnamed from now on."
    )
    expect(await recruit('soft-skill', parent)).toMatchObject({
      ok: true,
      name: 'sample-misnamed',
      backup: '~/.loadout/backups/claude-code/soft-skill',
      chain:
        '~/.claude/skills/sample-misnamed → ~/.loadout/skills/sample-misnamed → ~/Code/skills/sample-misnamed'
    })
    expect(await readdir(claudeFolder())).toEqual(['sample-misnamed'])
    expect(await readlink(join(claudeFolder(), 'sample-misnamed'))).toBe(
      join(paths.library, 'sample-misnamed')
    )
    expect((await lstat(backup('soft-skill'))).isDirectory()).toBe(true)
  })

  test('the entry name "My Skill" with name my-skill; UNDO restores "My Skill"', async () => {
    await skillAt(join(claudeFolder(), 'My Skill'), 'my-skill')
    const parent = parentFolder()
    await mkdir(parent, { recursive: true })
    const lines: string[] = []
    expect(await recruit('My Skill', parent, undefined, (l) => lines.push(l))).toMatchObject({
      ok: true,
      name: 'my-skill',
      backup: '~/.loadout/backups/claude-code/My Skill'
    })
    expect(lines[1]).toBe('Verified: 1 file, identical.')
    expect((await lstat(backup('My Skill'))).isDirectory()).toBe(true)
    expect(await readdir(claudeFolder())).toEqual(['my-skill'])
    expect(await readlink(join(paths.library, 'my-skill'))).toBe(join(parent, 'my-skill'))

    expect(await runUndo(CC, 'My Skill', config, paths, noLog)).toEqual({
      ok: true,
      path: '~/.claude/skills/My Skill',
      off: 'my-skill'
    })
    expect(await readdir(claudeFolder())).toEqual(['My Skill'])
    expect((await lstat(join(claudeFolder(), 'My Skill'))).isDirectory()).toBe(true)
  })

  test('the agent folder is a symlink: recruit and UNDO work, with the git note', async () => {
    const real = join(home, 'dotfiles', 'claude-skills')
    await mkdir(real, { recursive: true })
    await mkdir(join(home, 'dotfiles', '.git'))
    await mkdir(join(home, '.claude'))
    await symlink(real, claudeFolder())
    await skillAt(join(real, 'probe'), 'probe')
    const parent = parentFolder()
    await mkdir(parent, { recursive: true })

    const preview = await previewRecruit(CC, 'probe', parent, config, paths)
    expect(preview.ok && preview.notes).toEqual([
      '~/.claude/skills is inside a git repository at ~/dotfiles; git there will show probe as changed.',
      GITHUB_NOTE
    ])
    expect(await recruit('probe', parent)).toMatchObject({ ok: true, name: 'probe' })
    expect(await readlink(join(real, 'probe'))).toBe(join(paths.library, 'probe'))
    expect((await lstat(backup('probe'))).isDirectory()).toBe(true)

    expect(await runUndo(CC, 'probe', config, paths, noLog)).toMatchObject({ ok: true })
    expect((await lstat(join(real, 'probe'))).isDirectory()).toBe(true)
    expect(await exists(backup('probe'))).toBe(false)
  })
})

describe('step 0 refusals', () => {
  async function refused(entry: string, parent: string | null, message: string): Promise<void> {
    const before = await listing()
    expect(await previewRecruit(CC, entry, parent, config, paths)).toEqual({ ok: false, message })
    expect(await runRecruit(CC, entry, parent, [], config, paths, noLog)).toEqual({
      ok: false,
      message
    })
    expect(await listing()).toEqual(before)
  }

  test('a symlink inside', async () => {
    const original = join(claudeFolder(), 'probe')
    await skillAt(original, 'probe')
    await symlink(join(work, 'x'), join(original, 'b-link'))
    await symlink('SKILL.md', join(original, 'a-link'))
    await mkdir(parentFolder(), { recursive: true })
    await refused(
      'probe',
      parentFolder(),
      'Recruit cannot copy "probe", because it holds symlinks: a-link, b-link. Replace each link with a regular file or folder, then try again.'
    )
  })

  test('<parent>/<name> exists', async () => {
    await skillAt(join(claudeFolder(), 'probe'), 'probe')
    await mkdir(join(parentFolder(), 'probe'), { recursive: true })
    await refused(
      'probe',
      parentFolder(),
      '~/Code/skills/probe already exists. Pick another folder.'
    )
  })

  test('the backup exists', async () => {
    await skillAt(join(claudeFolder(), 'probe'), 'probe')
    await mkdir(backup('probe'), { recursive: true })
    await refused(
      'probe',
      null,
      'A backup of ~/.claude/skills/probe already exists at ~/.loadout/backups/claude-code/probe. Undo it, or move it out of ~/.loadout/backups, then try again.'
    )
  })

  test('mode in place, a target folder named other than the skill', async () => {
    const target = join(home, 'Code', 'my-skills', 'other-name')
    await skillAt(target, 'sample-linked')
    await mkdir(claudeFolder(), { recursive: true })
    await symlink(target, join(claudeFolder(), 'sample-linked'))
    await refused(
      'sample-linked',
      null,
      'Folder "other-name" must be named "sample-linked" to match the frontmatter.'
    )
  })

  test('mode in place, a link that leads into the backups through another link', async () => {
    // A link written into ~/.loadout is a text row; one that only resolves there reaches step 0.
    await skillAt(join(paths.backups, 'codex', 'kept'), 'kept')
    await symlink(join(paths.backups, 'codex'), join(home, 'shortcut'))
    await mkdir(claudeFolder(), { recursive: true })
    await symlink(join(home, 'shortcut', 'kept'), join(claudeFolder(), 'kept'))
    await refused(
      'kept',
      null,
      '~/shortcut/kept is in ~/.loadout/backups, where Recruit keeps originals for UNDO. Use UNDO on the Recon page, or copy the skill to another folder first.'
    )
  })

  test('mode in place, a link that leads into ~/.loadout through another link', async () => {
    await skillAt(join(paths.repos, 'owner', 'repo', 'cloned'), 'cloned')
    await symlink(join(paths.repos, 'owner', 'repo'), join(home, 'shortcut'))
    await mkdir(claudeFolder(), { recursive: true })
    await symlink(join(home, 'shortcut', 'cloned'), join(claudeFolder(), 'cloned'))
    await refused(
      'cloned',
      null,
      'A link into ~/.loadout, where Loadout keeps its own files. Loadout leaves it alone.'
    )
  })

  test('the picked folder is the real path of a symlinked agent folder', async () => {
    const real = join(home, 'dotfiles', 'claude-skills')
    await mkdir(real, { recursive: true })
    await mkdir(join(home, '.claude'))
    await symlink(real, claudeFolder())
    await skillAt(join(real, 'soft-skill'), 'sample-misnamed')
    await refused('soft-skill', real, 'Pick a folder outside the agent folders and ~/.loadout.')
  })

  test('the picked folder is a symlink into ~/.loadout', async () => {
    await skillAt(join(claudeFolder(), 'probe'), 'probe')
    const alias = join(home, 'Code', 'alias')
    await mkdir(join(home, 'Code'))
    await symlink(paths.repos, alias)
    await refused('probe', alias, 'Pick a folder outside the agent folders and ~/.loadout.')
  })

  test("mode library: the loadout's entry is linked to this folder", async () => {
    await skillAt(join(claudeFolder(), 'probe'), 'probe')
    expect((await addLocal(join(claudeFolder(), 'probe'), paths)).ok).toBe(true)
    await refused(
      'probe',
      null,
      '"probe" in your loadout is linked to this folder. Decommission the skill on the Loadout page, then recruit this folder.'
    )
  })

  test("mode library: the loadout's entry is linked to this link", async () => {
    const target = join(work, 't', 'probe')
    await skillAt(target, 'probe')
    await mkdir(claudeFolder(), { recursive: true })
    await symlink(target, join(claudeFolder(), 'probe'))
    expect((await addLocal(join(claudeFolder(), 'probe'), paths)).ok).toBe(true)
    await refused(
      'probe',
      null,
      '"probe" in your loadout is linked to this folder. Decommission the skill on the Loadout page, then recruit this folder.'
    )
  })

  test('the skill name is taken in the agent folder', async () => {
    await skillAt(join(claudeFolder(), 'soft-skill'), 'sample-misnamed')
    await skillAt(join(claudeFolder(), 'sample-misnamed'), 'sample-misnamed')
    await mkdir(parentFolder(), { recursive: true })
    await refused(
      'soft-skill',
      parentFolder(),
      '~/.claude/skills/sample-misnamed already exists and Loadout did not create it. Recruit it first, or remove it by hand.'
    )
  })
})

describe('changed after the preview', () => {
  test('mode library: a new file in the original changes the difference lines', async () => {
    const lib = join(work, 'lib', 'probe')
    await skillAt(lib, 'probe')
    expect((await addLocal(lib, paths)).ok).toBe(true)
    await skillAt(join(claudeFolder(), 'probe'), 'probe')
    const shown = await confirmed('probe', null)
    await write(join(claudeFolder(), 'probe', 'extra.md'), 'x')
    const before = await listing()
    expect(await runRecruit(CC, 'probe', null, shown, config, paths, noLog)).toEqual({
      ok: false,
      message: '~/.claude/skills/probe changed after the preview. Open Recruit again.'
    })
    expect(await listing()).toEqual(before)
  })

  test('mode library: the library entry was removed, so mode copy now needs a folder', async () => {
    const lib = join(work, 'lib', 'probe')
    await skillAt(lib, 'probe')
    expect((await addLocal(lib, paths)).ok).toBe(true)
    await skillAt(join(claudeFolder(), 'probe'), 'probe')
    const shown = await confirmed('probe', null)
    expect((await removeEntry('probe', config, paths)).ok).toBe(true)
    const before = await listing()
    expect(await runRecruit(CC, 'probe', null, shown, config, paths, noLog)).toEqual({
      ok: false,
      message: '~/.claude/skills/probe changed after the preview. Open Recruit again.'
    })
    expect(await listing()).toEqual(before)
  })

  test('mode copy: the entry was replaced by a link', async () => {
    await skillAt(join(claudeFolder(), 'probe'), 'probe')
    await mkdir(parentFolder(), { recursive: true })
    const shown = await confirmed('probe', parentFolder())
    await rm(join(claudeFolder(), 'probe'), { recursive: true })
    await skillAt(join(work, 'elsewhere', 'probe'), 'probe')
    await symlink(join(work, 'elsewhere', 'probe'), join(claudeFolder(), 'probe'))
    const before = await listing()
    expect(await runRecruit(CC, 'probe', parentFolder(), shown, config, paths, noLog)).toEqual({
      ok: false,
      message: '~/.claude/skills/probe changed after the preview. Open Recruit again.'
    })
    expect(await listing()).toEqual(before)
  })
})

describe('a failure in a step', () => {
  let parent: string
  beforeEach(async () => {
    parent = parentFolder()
    await mkdir(parent, { recursive: true })
  })

  test('before verify: a changed copy is deleted, nothing else changed', async () => {
    await skillAt(join(claudeFolder(), 'probe'), 'probe')
    const before = await listing(claudeFolder())
    const result = await recruit('probe', parent, {
      before: async (step) => {
        if (step.op === 'verify') await appendFile(join(parent, 'probe', 'SKILL.md'), 'x')
      }
    })
    expect(result).toEqual({
      ok: false,
      message:
        'The copy in ~/Code/skills/probe is not identical to ~/.claude/skills/probe: SKILL.md differs. Loadout deleted the copy; nothing else changed.'
    })
    expect(await exists(join(parent, 'probe'))).toBe(false)
    expect(await listing(claudeFolder())).toEqual(before)
    expect(await readdir(paths.library)).toEqual([])
  })

  test('before add: the library name appeared; the copy is deleted', async () => {
    await skillAt(join(claudeFolder(), 'probe'), 'probe')
    const result = await recruit('probe', parent, {
      before: async (step) => {
        if (step.op === 'add') await mkdir(join(paths.library, 'probe'))
      }
    })
    expect(result).toEqual({
      ok: false,
      message:
        'Add failed: EEXIST: file already exists at ~/.loadout/skills/probe. Loadout deleted the copy; nothing else changed.'
    })
    expect(await exists(join(parent, 'probe'))).toBe(false)
    expect((await lstat(join(paths.library, 'probe'))).isDirectory()).toBe(true)
    expect((await lstat(join(claudeFolder(), 'probe'))).isDirectory()).toBe(true)
  })

  test.each([
    ['an empty folder', []],
    ['a folder with a file', ['keep.txt']]
  ])('before move: the backup path became %s; it is never replaced', async (_, names) => {
    await skillAt(join(claudeFolder(), 'probe'), 'probe')
    const result = await recruit('probe', parent, {
      before: async (step) => {
        if (step.op !== 'move') return
        await mkdir(backup('probe'), { recursive: true })
        for (const name of names) await write(join(backup('probe'), name), 'keep')
      }
    })
    expect(result).toEqual({
      ok: false,
      message:
        'A backup of ~/.claude/skills/probe already exists at ~/.loadout/backups/claude-code/probe. Undo it, or move it out of ~/.loadout/backups, then try again. Loadout removed ~/.loadout/skills/probe and deleted the copy; nothing else changed.'
    })
    expect(await readdir(backup('probe'))).toEqual(names)
    expect(await readFile(join(claudeFolder(), 'probe', 'SKILL.md'), 'utf8')).toContain('probe')
    expect(await exists(join(paths.library, 'probe'))).toBe(false)
    expect(await exists(join(parent, 'probe'))).toBe(false)
  })

  test('before link: the original goes back, the library link and the copy go', async () => {
    await skillAt(join(claudeFolder(), 'soft-skill'), 'sample-misnamed')
    const lines: string[] = []
    const result = await recruit(
      'soft-skill',
      parent,
      {
        before: async (step) => {
          if (step.op === 'link') await write(join(claudeFolder(), 'sample-misnamed'), 'x')
        }
      },
      (l) => lines.push(l)
    )
    expect(result).toEqual({
      ok: false,
      message:
        'Link failed: EEXIST: file already exists at ~/.claude/skills/sample-misnamed. Loadout moved your original back to ~/.claude/skills/soft-skill, removed ~/.loadout/skills/sample-misnamed and deleted the copy; nothing else changed.'
    })
    expect((await lstat(join(claudeFolder(), 'soft-skill'))).isDirectory()).toBe(true)
    expect(await readFile(join(claudeFolder(), 'sample-misnamed'), 'utf8')).toBe('x')
    expect(await exists(backup('soft-skill'))).toBe(false)
    expect(await exists(join(paths.library, 'sample-misnamed'))).toBe(false)
    expect(await exists(join(parent, 'sample-misnamed'))).toBe(false)
    expect(lines.map((l) => l.split(' ')[0])).toEqual([
      'Copied',
      'Verified:',
      'Added',
      'Moved',
      'Moved',
      'Removed',
      'Deleted'
    ])
  })

  test('before link, the old path was taken: the original stays in the backup and the message says so', async () => {
    const original = join(claudeFolder(), 'probe')
    await skillAt(original, 'probe')
    const result = await recruit('probe', parent, {
      before: async (step) => {
        if (step.op === 'link') await write(original, 'blocker')
      }
    })
    expect(result).toEqual({
      ok: false,
      message:
        'Link failed: EEXIST: file already exists at ~/.claude/skills/probe. Loadout removed ~/.loadout/skills/probe and deleted the copy. ~/.claude/skills/probe is in use, so Loadout could not move your original back. Your original is in ~/.loadout/backups/claude-code/probe; UNDO on the Recon page puts it back.'
    })
    expect((await lstat(backup('probe'))).isDirectory()).toBe(true)
    expect(await readFile(join(backup('probe'), 'SKILL.md'), 'utf8')).toBe(
      '---\nname: probe\ndescription: D.\n---\nBody.\n'
    )
    expect(await exists(join(parent, 'probe'))).toBe(false)
    expect(await exists(join(paths.library, 'probe'))).toBe(false)
    expect(await readFile(original, 'utf8')).toBe('blocker')
  })

  test('a read-only folder in the original: the message says the copy could not be deleted', async () => {
    const original = join(claudeFolder(), 'probe')
    await skillAt(original, 'probe')
    await write(join(original, 'ro', 'a.txt'), 'a')
    await chmod(join(original, 'ro'), 0o555)
    try {
      const result = await recruit('probe', parent, {
        before: async (step) => {
          if (step.op === 'add') await mkdir(join(paths.library, 'probe'))
        }
      })
      expect(result).toEqual({
        ok: false,
        message:
          'Add failed: EEXIST: file already exists at ~/.loadout/skills/probe. Loadout could not delete the copy in ~/Code/skills/probe: it holds a read-only folder, as your original does. Delete the copy by hand.'
      })
      expect((await lstat(original)).isDirectory()).toBe(true)
    } finally {
      await chmod(join(original, 'ro'), 0o755)
      await chmod(join(parent, 'probe', 'ro'), 0o755).catch(() => undefined)
    }
  })

  test('an unreadable file in the original: the partial copy is deleted', async () => {
    const original = join(claudeFolder(), 'probe')
    await skillAt(original, 'probe')
    await write(join(original, 'secret.txt'), 's', 0o000)
    try {
      const before = await listing(claudeFolder())
      expect(await recruit('probe', parent)).toEqual({
        ok: false,
        message:
          'Copy failed: EACCES: permission denied at ~/.claude/skills/probe/secret.txt. Loadout deleted the copy; nothing else changed.'
      })
      expect(await exists(join(parent, 'probe'))).toBe(false)
      expect(await listing(claudeFolder())).toEqual(before)
    } finally {
      await chmod(join(original, 'secret.txt'), 0o644)
    }
  })
})

describe('runUndo', () => {
  let parent: string
  beforeEach(async () => {
    parent = parentFolder()
    await mkdir(parent, { recursive: true })
  })

  test('after a copy recruit: the original is back, the agent link is gone, the copy stays', async () => {
    await skillAt(join(claudeFolder(), 'probe'), 'probe')
    expect((await recruit('probe', parent)).ok).toBe(true)
    expect(await previewUndo(CC, 'probe', config, paths)).toEqual({
      ok: true,
      steps: [
        "Remove Loadout's link ~/.claude/skills/probe.",
        'Move your original from ~/.loadout/backups/claude-code/probe back to ~/.claude/skills/probe.'
      ],
      dangling: false
    })
    const lines: string[] = []
    expect(await runUndo(CC, 'probe', config, paths, (l) => lines.push(l))).toEqual({
      ok: true,
      path: '~/.claude/skills/probe',
      off: 'probe'
    })
    expect(lines).toEqual([
      "Removed Loadout's link ~/.claude/skills/probe.",
      'Moved your original from ~/.loadout/backups/claude-code/probe back to ~/.claude/skills/probe.'
    ])
    expect((await lstat(join(claudeFolder(), 'probe'))).isDirectory()).toBe(true)
    expect((await compareFolders(join(claudeFolder(), 'probe'), join(parent, 'probe'))).same).toBe(
      true
    )
    expect(await readlink(join(paths.library, 'probe'))).toBe(join(parent, 'probe'))
    expect(await exists(backup('probe'))).toBe(false)
  })

  test('after the library entry was removed: off is null', async () => {
    await skillAt(join(claudeFolder(), 'probe'), 'probe')
    expect((await recruit('probe', parent)).ok).toBe(true)
    expect((await removeEntry('probe', config, paths)).ok).toBe(true)
    expect(await runUndo(CC, 'probe', config, paths, noLog)).toEqual({
      ok: true,
      path: '~/.claude/skills/probe',
      off: null
    })
    expect((await lstat(join(claudeFolder(), 'probe'))).isDirectory()).toBe(true)
    expect(await exists(join(parent, 'probe', 'SKILL.md'))).toBe(true)
  })

  test('a dangling link goes back with its text', async () => {
    await mkdir(claudeFolder(), { recursive: true })
    await symlink(join(work, 'gone'), join(claudeFolder(), 'dead'))
    expect((await recruit('dead')).ok).toBe(true)
    expect(await runUndo(CC, 'dead', config, paths, noLog)).toEqual({
      ok: true,
      path: '~/.claude/skills/dead',
      off: null
    })
    expect(await readlink(join(claudeFolder(), 'dead'))).toBe(join(work, 'gone'))
  })

  test('a folder at the old path: refused, nothing changes', async () => {
    await skillAt(join(claudeFolder(), 'soft-skill'), 'sample-misnamed')
    expect((await recruit('soft-skill', parent)).ok).toBe(true)
    await mkdir(join(claudeFolder(), 'soft-skill'))
    const before = await listing()
    const message =
      '~/.claude/skills/soft-skill is in use, so Loadout cannot put your original back there. Move it away, then press Undo again.'
    expect(await previewUndo(CC, 'soft-skill', config, paths)).toEqual({ ok: false, message })
    expect(await runUndo(CC, 'soft-skill', config, paths, noLog)).toEqual({ ok: false, message })
    expect(await listing()).toEqual(before)
  })

  test('a folder appears before move: refused, the backup stays, the link is back', async () => {
    await skillAt(join(claudeFolder(), 'soft-skill'), 'sample-misnamed')
    expect((await recruit('soft-skill', parent)).ok).toBe(true)
    const lines: string[] = []
    const result = await runUndo(CC, 'soft-skill', config, paths, (l) => lines.push(l), {
      before: async (step) => {
        if (step.op === 'move') await mkdir(join(claudeFolder(), 'soft-skill'))
      }
    })
    expect(result).toEqual({
      ok: false,
      message:
        '~/.claude/skills/soft-skill is in use, so Loadout cannot put your original back there. Move it away, then press Undo again. Loadout put back its link ~/.claude/skills/sample-misnamed.'
    })
    expect((await lstat(backup('soft-skill'))).isDirectory()).toBe(true)
    expect(await exists(join(backup('soft-skill'), 'SKILL.md'))).toBe(true)
    expect(await readlink(join(claudeFolder(), 'sample-misnamed'))).toBe(
      join(paths.library, 'sample-misnamed')
    )
    expect(lines).toEqual([
      "Removed Loadout's link ~/.claude/skills/sample-misnamed.",
      "Put back Loadout's link ~/.claude/skills/sample-misnamed."
    ])
  })

  test("Loadout's own link under the entry name and no skill name: refused, the backup stays", async () => {
    await mkdir(claudeFolder(), { recursive: true })
    await symlink(join(work, 'gone'), join(claudeFolder(), 'dead'))
    expect((await recruit('dead')).ok).toBe(true)
    await skillAt(join(work, 'dead'), 'dead')
    expect((await addLocal(join(work, 'dead'), paths)).ok).toBe(true)
    await symlink(join(paths.library, 'dead'), join(claudeFolder(), 'dead'))

    const message =
      '~/.claude/skills/dead is in use, so Loadout cannot put your original back there. Move it away, then press Undo again.'
    const before = await listing()
    expect(await previewUndo(CC, 'dead', config, paths)).toEqual({ ok: false, message })
    expect(await runUndo(CC, 'dead', config, paths, noLog)).toEqual({ ok: false, message })
    expect(await listing()).toEqual(before)
    expect(await readlink(backup('dead'))).toBe(join(work, 'gone'))
    expect(await readlink(join(claudeFolder(), 'dead'))).toBe(join(paths.library, 'dead'))
  })

  test('a refused unlink in UNDO names the path from ~', async () => {
    await skillAt(join(claudeFolder(), 'probe'), 'probe')
    expect((await recruit('probe', parentFolder())).ok).toBe(true)
    const result = await runUndo(CC, 'probe', config, paths, noLog, {
      before: async (step) => {
        if (step.op !== 'unlink') return
        await rm(step.path)
        await symlink(join(work, 'other'), step.path)
      }
    })
    expect(result).toEqual({
      ok: false,
      message:
        'Unlink refused: ~/.claude/skills/probe changed after Loadout read it, so Loadout left it as it is. Try again.'
    })
  })

  test('a second UNDO finds no backup', async () => {
    await skillAt(join(claudeFolder(), 'probe'), 'probe')
    expect((await recruit('probe', parent)).ok).toBe(true)
    expect((await runUndo(CC, 'probe', config, paths, noLog)).ok).toBe(true)
    expect(await runUndo(CC, 'probe', config, paths, noLog)).toEqual({
      ok: false,
      message: 'No backup of ~/.claude/skills/probe.'
    })
  })

  test('works for an agent that is not enabled', async () => {
    await skillAt(join(claudeFolder(), 'probe'), 'probe')
    expect((await recruit('probe', parent)).ok).toBe(true)
    config.agents[0].enabled = false
    expect(await runUndo(CC, 'probe', config, paths, noLog)).toEqual({
      ok: true,
      path: '~/.claude/skills/probe',
      off: 'probe'
    })
  })
})

describe('candidateDetail', () => {
  test('a folder candidate returns its SKILL.md, files and size', async () => {
    await skillAt(join(claudeFolder(), 'probe'), 'probe')
    await write(join(claudeFolder(), 'probe', 'ref.md'), 'x')
    const result = await candidateDetail(CC, 'probe', config, paths)
    if (!result.ok) throw new Error(result.message)
    expect(result.detail.skillMd).toContain('name: probe')
    expect(result.detail.files).toEqual([
      { name: 'SKILL.md', folder: false },
      { name: 'ref.md', folder: false }
    ])
    expect(result.detail.size?.files).toBe(2)
  })

  test('a link candidate reads the link target', async () => {
    await skillAt(join(work, 'linked'), 'linked')
    await mkdir(claudeFolder(), { recursive: true })
    await symlink(join(work, 'linked'), join(claudeFolder(), 'linked'))
    const result = await candidateDetail(CC, 'linked', config, paths)
    if (!result.ok) throw new Error(result.message)
    expect(result.detail.skillMd).toContain('name: linked')
  })

  test('refuses an entry that is not a recruit row', async () => {
    await mkdir(claudeFolder(), { recursive: true })
    await symlink(join(home, 'missing'), join(claudeFolder(), 'gone'))
    await write(join(claudeFolder(), 'note.txt'), 'x')
    expect(await candidateDetail(CC, 'gone', config, paths)).toEqual({
      ok: false,
      message: '"gone" is not a recruit candidate.'
    })
    expect(await candidateDetail(CC, 'note.txt', config, paths)).toEqual({
      ok: false,
      message: '"note.txt" is not a recruit candidate.'
    })
  })

  test('refuses an unknown agent, a bad entry name and a missing entry', async () => {
    await mkdir(claudeFolder(), { recursive: true })
    expect(await candidateDetail('nope', 'probe', config, paths)).toEqual({
      ok: false,
      message: 'Unknown agent "nope".'
    })
    expect((await candidateDetail(CC, '..', config, paths)).ok).toBe(false)
    const missing = await candidateDetail(CC, 'absent', config, paths)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.message).toContain('Press Rescan.')
  })
})
