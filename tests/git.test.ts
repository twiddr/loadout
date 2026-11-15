import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  aheadBehindArgs,
  branchArgs,
  cloneArgs,
  diffArgs,
  dirtyMessage,
  divergedMessage,
  fetchArgs,
  githubUrl,
  headArgs,
  historyArgs,
  incomingArgs,
  manifestAddArgs,
  manifestCommitArgs,
  manifestStatusArgs,
  manifestUncommitted,
  parseAheadBehind,
  parseCommits,
  parseHistory,
  parsePorcelain,
  parseRepo,
  publishCommitMessage,
  pullArgs,
  shallowArgs,
  statusArgs,
  upstreamArgs,
  cloneKeepReason,
  localCommitsArgs,
  localFilesArgs,
  toplevelArgs
} from '../src/core/git'
import { run } from '../src/main/process'

const fixture = (name: string): Promise<string> =>
  readFile(join(__dirname, 'fixtures', 'git', name), 'utf8')

describe('parseRepo', () => {
  it.each([
    'acme/tools',
    '  acme/tools  ',
    'acme/tools.git',
    'https://github.com/acme/tools',
    'https://github.com/acme/tools.git',
    'https://github.com/acme/tools/',
    'https://github.com/acme/tools/tree/main/skills/x',
    'https://github.com/acme/tools?tab=readme-ov-file#readme'
  ])('accepts %j', (input) => {
    expect(parseRepo(input)).toEqual({ owner: 'acme', repo: 'tools' })
  })

  it('keeps real repository names', () => {
    expect(parseRepo('anthropics/skills')).toEqual({ owner: 'anthropics', repo: 'skills' })
    expect(parseRepo('acme/.github')).toEqual({ owner: 'acme', repo: '.github' })
  })

  it('lower-cases owner and repo, so one repository has one clone', () => {
    expect(parseRepo('Anthropics/Skills')).toEqual({ owner: 'anthropics', repo: 'skills' })
    expect(parseRepo('https://github.com/Anthropics/Skills.git')).toEqual({
      owner: 'anthropics',
      repo: 'skills'
    })
  })

  it.each([
    '',
    'acme',
    'acme/tools/x',
    'acme/..',
    '../tools',
    'git@github.com:acme/tools.git',
    'http://github.com/acme/tools',
    'https://gitlab.com/acme/tools',
    'https://www.github.com/acme/tools',
    'https://github.com/acme',
    'github.com/acme/tools'
  ])('rejects %j', (input) => {
    expect(parseRepo(input)).toBeNull()
  })
})

describe('builders', () => {
  it('builds the URL and the argument lists', () => {
    expect(githubUrl({ owner: 'acme', repo: 'tools' })).toBe('https://github.com/acme/tools.git')
    expect(cloneArgs('u', 'd')).toEqual(['clone', '--depth', '1', 'u', 'd'])
    expect(statusArgs('c')).toEqual([
      '-C',
      'c',
      '-c',
      'core.quotePath=false',
      'status',
      '--porcelain',
      '--untracked-files=no'
    ])
    expect(pullArgs('c')).toEqual(['-C', 'c', 'pull', '--ff-only'])
  })
})

describe('manifest status', () => {
  it('builds the status arguments', () => {
    expect(manifestStatusArgs('/s/x')).toEqual([
      '-C',
      '/s/x',
      '-c',
      'core.quotePath=false',
      'status',
      '--porcelain',
      '--',
      '.tessl-plugin/plugin.json'
    ])
  })

  it('builds the add and commit arguments for the manifest only', () => {
    expect(manifestAddArgs('/s/x')).toEqual([
      '-C',
      '/s/x',
      'add',
      '--',
      '.tessl-plugin/plugin.json'
    ])
    expect(manifestCommitArgs('/s/x', 'm')).toEqual([
      '-C',
      '/s/x',
      'commit',
      '-m',
      'm',
      '--',
      '.tessl-plugin/plugin.json'
    ])
  })

  it.each([
    ['0.1.1', 'chore(probe): publish 0.1.1'],
    [null, 'chore(probe): publish to Tessl']
  ])('publishCommitMessage with version %s', (version, expected) => {
    expect(publishCommitMessage('probe', version)).toBe(expected)
  })

  it.each([
    [0, '?? ledger-audit/.tessl-plugin/\n', true],
    [0, '', false],
    [128, '', false],
    [null, '', false]
  ])('manifestUncommitted(%s, %j) is %s', (code, stdout, expected) => {
    expect(manifestUncommitted(code, stdout)).toBe(expected)
  })
})

describe('parsePorcelain', () => {
  it('gives no files for clean output', async () => {
    expect(parsePorcelain(await fixture('status-clean.txt'))).toEqual([])
  })

  it('gives the new path of each changed file', async () => {
    expect(parsePorcelain(await fixture('status-dirty.txt'))).toEqual([
      'README.md',
      'skills/beta two/SKILL.md',
      'skills/gamma/SKILL.md',
      'skills/kø/SKILL.md'
    ])
  })
})

describe('dirtyMessage', () => {
  it('names the files and the clone', () => {
    expect(dirtyMessage('/h/.loadout/repos/acme/tools', ['a.md', 'b c.md'])).toBe(
      'The clone has local edits; update refused. Files: a.md, b c.md. Commit or discard them in /h/.loadout/repos/acme/tools first.'
    )
  })
})

describe('against a local bare repository', () => {
  let root: string
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t'
  }
  const git = (args: string[]): ReturnType<typeof run> => run('git', args, { env })

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'loadout-git-'))
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('the clone reads keep a clone with local work and let a clean shallow clone go', async () => {
    const up = join(root, 'keep-up.git')
    const work = join(root, 'keep-work')
    const dest = join(root, 'keep-dest')
    expect((await git(['init', '--bare', '-b', 'main', up])).code).toBe(0)
    expect((await git(['clone', up, work])).code).toBe(0)
    await writeFile(join(work, 'SKILL.md'), 'one\n')
    expect((await git(['-C', work, 'add', '.'])).code).toBe(0)
    expect((await git(['-C', work, 'commit', '-m', 'one'])).code).toBe(0)
    expect((await git(['-C', work, 'push', '-u', 'origin', 'HEAD:main'])).code).toBe(0)
    expect((await git(cloneArgs('file://' + up, dest))).code).toBe(0)
    const reason = async (folder: string): Promise<string | null> =>
      cloneKeepReason(
        await realpath(folder),
        await git(toplevelArgs(folder)),
        await git(localFilesArgs(folder)),
        await git(localCommitsArgs(folder))
      )

    expect(await reason(dest)).toBeNull()

    await mkdir(join(dest, 'node_modules'))
    await writeFile(join(dest, 'node_modules', 'x.js'), 'x')
    expect(await reason(dest)).toBe(
      'it holds files that git does not have as committed, such as node_modules/x.js'
    )
    await rm(join(dest, 'node_modules'), { recursive: true })

    await mkdir(join(dest, 'sub'))
    expect(await reason(join(dest, 'sub'))).toBe('it is not a git repository of its own')
    await rm(join(dest, 'sub'), { recursive: true })

    await appendFile(join(dest, 'SKILL.md'), 'edit\n')
    expect((await git(['-C', dest, 'stash'])).code).toBe(0)
    expect(await reason(dest)).toBe('it holds commits that are on no remote')
    expect((await git(['-C', dest, 'stash', 'drop'])).code).toBe(0)
    expect(await reason(dest)).toBeNull()

    await appendFile(join(dest, 'SKILL.md'), 'edit\n')
    expect((await git(['-C', dest, 'commit', '-am', 'local'])).code).toBe(0)
    expect(await reason(dest)).toBe('it holds commits that are on no remote')
  })

  it('clones, reports local edits and pulls', async () => {
    const up = join(root, 'up.git')
    const work = join(root, 'work')
    const dest = join(root, 'dest')
    expect((await git(['init', '--bare', '-b', 'main', up])).code).toBe(0)
    expect((await git(['clone', up, work])).code).toBe(0)
    await mkdir(join(work, 'skills', 'alpha'), { recursive: true })
    await writeFile(join(work, 'skills', 'alpha', 'SKILL.md'), 'one\n')
    expect((await git(['-C', work, 'add', '.'])).code).toBe(0)
    expect((await git(['-C', work, 'commit', '-m', 'one'])).code).toBe(0)
    expect((await git(['-C', work, 'push', '-u', 'origin', 'HEAD:main'])).code).toBe(0)

    expect((await git(cloneArgs('file://' + up, dest))).code).toBe(0)
    const clean = await git(statusArgs(dest))
    expect(clean.code).toBe(0)
    expect(parsePorcelain(clean.stdout)).toEqual([])

    await appendFile(join(dest, 'skills', 'alpha', 'SKILL.md'), 'edit\n')
    await writeFile(join(dest, '.DS_Store'), 'x')
    const dirty = await git(statusArgs(dest))
    expect(parsePorcelain(dirty.stdout)).toEqual(['skills/alpha/SKILL.md'])

    expect((await git(['-C', dest, 'checkout', '--', '.'])).code).toBe(0)
    await writeFile(join(work, 'skills', 'alpha', 'SKILL.md'), 'two\n')
    expect((await git(['-C', work, 'commit', '-am', 'two'])).code).toBe(0)
    expect((await git(['-C', work, 'push'])).code).toBe(0)
    expect((await git(pullArgs(dest))).code).toBe(0)
    expect(await readFile(join(dest, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe('two\n')

    const skill = join(dest, 'skills', 'alpha')
    await mkdir(join(skill, '.tessl-plugin'))
    await writeFile(join(skill, '.tessl-plugin', 'plugin.json'), '{}\n')
    const manifest = await git(manifestStatusArgs(skill))
    expect(manifest.code).toBe(0)
    expect(manifestUncommitted(manifest.code, manifest.stdout)).toBe(true)

    // The commit holds the manifest only: an edit and a staged file elsewhere stay as they are.
    await appendFile(join(skill, 'SKILL.md'), 'edit\n')
    await writeFile(join(dest, 'staged.md'), 'x\n')
    expect((await git(['-C', dest, 'add', 'staged.md'])).code).toBe(0)
    expect((await git(manifestAddArgs(skill))).code).toBe(0)
    expect(
      (await git(manifestCommitArgs(skill, publishCommitMessage('alpha', '0.1.0')))).code
    ).toBe(0)
    const after = await git(manifestStatusArgs(skill))
    expect(manifestUncommitted(after.code, after.stdout)).toBe(false)
    const shown = await git(['-C', dest, 'show', '--name-only', '--format=%s', 'HEAD'])
    expect(shown.stdout.trim().split('\n')).toEqual([
      'chore(alpha): publish 0.1.0',
      '',
      'skills/alpha/.tessl-plugin/plugin.json'
    ])
    const rest = await git(['-C', dest, 'status', '--porcelain'])
    expect(parsePorcelain(rest.stdout)).toEqual(
      expect.arrayContaining(['skills/alpha/SKILL.md', 'staged.md'])
    )

    const plain = join(root, 'plain')
    await mkdir(plain)
    const outside = await git(manifestStatusArgs(plain))
    expect(outside.code).not.toBe(0)
    expect(manifestUncommitted(outside.code, outside.stdout)).toBe(false)
  })
})

describe('history', () => {
  it('builds the log arguments', () => {
    expect(historyArgs('/c', '')).toEqual([
      '-C',
      '/c',
      'log',
      '--format=%h%x09%as%x09%s',
      '-n',
      '30',
      '--',
      '.'
    ])
    expect(historyArgs('/c', 'skills/x').slice(-2)).toEqual(['--', 'skills/x'])
  })

  it('builds the rev-parse arguments', () => {
    expect(branchArgs('/c')).toEqual(['-C', '/c', 'rev-parse', '--abbrev-ref', 'HEAD'])
    expect(headArgs('/c')).toEqual(['-C', '/c', 'rev-parse', '--short', 'HEAD'])
    expect(shallowArgs('/c')).toEqual(['-C', '/c', 'rev-parse', '--is-shallow-repository'])
  })

  it('parses log lines', () => {
    expect(parseHistory('abc1234\t2026-11-01\tInitial\n')).toEqual([
      { hash: 'abc1234', date: '2026-11-01', subject: 'Initial' }
    ])
    expect(parseHistory('abc1234\t2026-11-01\ta\tb\n')[0].subject).toBe('a\tb')
    expect(parseHistory('')).toEqual([])
  })
})

describe('check', () => {
  it('builds the check arguments', () => {
    expect(fetchArgs('/c')).toEqual(['-C', '/c', 'fetch'])
    expect(aheadBehindArgs('/c')).toEqual([
      '-C',
      '/c',
      'rev-list',
      '--left-right',
      '--count',
      'HEAD...@{u}'
    ])
    expect(upstreamArgs('/c')).toEqual(['-C', '/c', 'rev-parse', '--abbrev-ref', '@{u}'])
    expect(incomingArgs('/c')).toEqual(['-C', '/c', 'log', '--format=%h%x09%s', 'HEAD..@{u}'])
    expect(diffArgs('/c', 'skills/x')).toEqual(['-C', '/c', 'diff', 'HEAD..@{u}', '--', 'skills/x'])
    expect(diffArgs('/c', '').slice(-2)).toEqual(['--', '.'])
  })

  it('parses the left/right count', () => {
    expect(parseAheadBehind('0\t3\n')).toEqual({ ahead: 0, behind: 3 })
    expect(parseAheadBehind('3\t2')).toEqual({ ahead: 3, behind: 2 })
    expect(parseAheadBehind('')).toBeNull()
  })

  it('parses incoming commits, newest first', () => {
    expect(parseCommits('0b75b58\tdocs: test shortcuts\n26975a4\tdocs: fix logo\n')).toEqual([
      { hash: '0b75b58', subject: 'docs: test shortcuts' },
      { hash: '26975a4', subject: 'docs: fix logo' }
    ])
    expect(parseCommits('')).toEqual([])
  })

  it('words the diverged refusal', () => {
    expect(divergedMessage('/r/a/b', 'origin/main')).toBe(
      'The clone has commits that are not on origin/main; update refused. Fix it with git in /r/a/b first.'
    )
  })
})

describe('cloneKeepReason', () => {
  const ok = (stdout = ''): { code: number; stdout: string } => ({ code: 0, stdout })
  const top = ok('/r/acme/tools\n')
  it.each([
    [top, ok(), ok(), null],
    [null, ok(), ok(), 'Loadout found no git to check it for local changes'],
    [ok('/r\n'), ok(), ok(), 'it is not a git repository of its own'],
    [{ code: 128, stdout: '' }, ok(), ok(), 'it is not a git repository of its own'],
    [top, { code: 128, stdout: '' }, ok(), 'git could not check it for local changes'],
    [top, ok(), { code: null, stdout: '' }, 'git could not check it for local changes'],
    [
      top,
      ok(' M SKILL.md\n'),
      ok(),
      'it holds files that git does not have as committed, such as SKILL.md'
    ],
    [
      top,
      ok('!! node_modules/\n'),
      ok(),
      'it holds files that git does not have as committed, such as node_modules/'
    ],
    [top, ok(), ok('abc1234 Local work\n'), 'it holds commits that are on no remote']
  ])('%o, %o and %o: %s', (t, files, commits, reason) => {
    expect(cloneKeepReason('/r/acme/tools', t, files, commits)).toBe(reason)
  })
})
