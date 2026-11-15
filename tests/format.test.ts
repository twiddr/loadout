import { describe, expect, it, test } from 'vitest'
import { newCheck } from '../src/core/checks'
import type { Entry, Manifest } from '../src/core/ipc'
import type { Pack } from '../src/core/packs'
import {
  diffFiles,
  gridItems,
  packRemoveText,
  packToggleText,
  publishedText,
  publishVisibility,
  agentCode,
  ago,
  fixLabel,
  formatSize,
  isRunning,
  localDate,
  matches,
  plural,
  runText,
  scoreText,
  scoreTone,
  serial,
  sourceGroups,
  sourceLine,
  splitFrontmatter
} from '../src/renderer/src/format'
import type { Filter } from '../src/renderer/src/format'

const entry = (source: Entry['source']): Entry => ({
  name: 'x',
  source,
  status: 'ok',
  target: '/t',
  enabledFor: []
})

test('serial is the 1-based position, two digits, three above 99', () => {
  expect(serial(0)).toBe('SK-01')
  expect(serial(8)).toBe('SK-09')
  expect(serial(99)).toBe('SK-100')
})

test('plural picks the singular only for 1', () => {
  expect(plural(1, 'skill', 'skills')).toBe('skill')
  expect(plural(0, 'skill', 'skills')).toBe('skills')
  expect(plural(2, 'skill', 'skills')).toBe('skills')
})

test('sourceLine shows the path line of each source type', () => {
  expect(sourceLine(entry({ type: 'local', path: '/home/u/Code/Skills/probe' }), '/home/u')).toBe(
    '~/Code/Skills/probe'
  )
  expect(
    sourceLine(
      entry({ type: 'github', owner: 'acme', repo: 'tools', subpath: 'skills/probe-gh' }),
      '/home/u'
    )
  ).toBe('acme/tools/skills/probe-gh')
  expect(
    sourceLine(entry({ type: 'tessl', workspace: 'ws', plugin: 'plugin', subpath: '' }), '/home/u')
  ).toBe('ws/plugin')
})

test('matches combines the search text and the filter chip', () => {
  const probe: Entry = {
    ...entry({ type: 'local', path: '/home/u/Code/Skills/probe' }),
    name: 'probe',
    enabledFor: ['claude-code']
  }
  const gh: Entry = {
    ...entry({ type: 'github', owner: 'acme', repo: 'tools', subpath: 'skills/probe-gh' }),
    name: 'probe-gh'
  }
  const hit = (e: Entry, search: string, filter: Parameters<typeof matches>[3]): boolean =>
    matches(e, '/home/u', search, filter)
  expect(hit(probe, 'GH', 'all')).toBe(false)
  expect(hit(gh, 'GH', 'all')).toBe(true)
  expect(hit(gh, ' acme/tools ', 'all')).toBe(true)
  expect(hit(probe, '', 'stowed')).toBe(false)
  expect(hit(gh, '', 'stowed')).toBe(true)
  expect(hit(gh, 'gh', 'local')).toBe(false)
  expect(hit(probe, '', 'all') && hit(gh, '', 'all')).toBe(true)
  expect(hit(probe, '', 'local')).toBe(true)
  expect(hit(gh, '', 'github')).toBe(true)
})

test('ago says how long ago, in the largest whole unit', () => {
  expect(ago(0, 30_000)).toBe('just now')
  expect(ago(0, 5 * 60_000)).toBe('5 min ago')
  expect(ago(0, 3_600_000)).toBe('1 hour ago')
  expect(ago(0, 2 * 3_600_000)).toBe('2 hours ago')
  expect(ago(0, 86_400_000)).toBe('1 day ago')
  expect(ago(0, 3 * 86_400_000)).toBe('3 days ago')
})

test('sourceGroups groups skills by clone or plugin, sorted by source key, local left out', () => {
  const named = (name: string, source: Entry['source']): Entry => ({ ...entry(source), name })
  const tools = { type: 'github', owner: 'acme', repo: 'tools', subpath: '' } as const
  const kit = { type: 'tessl', workspace: 'acme', plugin: 'kit', subpath: '' } as const
  const groups = sourceGroups(
    [
      named('t', kit),
      named('b', tools),
      named('local', { type: 'local', path: '/x' }),
      named('a', tools)
    ],
    { 'tessl:acme/kit': newCheck(0, 'ready') }
  )
  expect(groups.map((g) => [g.key, g.name, g.skills, g.check?.state])).toEqual([
    ['github:acme/tools', 'acme/tools', ['b', 'a'], undefined],
    ['tessl:acme/kit', 'acme/kit', ['t'], 'ready']
  ])
})

test('runText gives the command, every line and how the run ended', () => {
  const lines = [
    { text: 'Fetching', stream: 'stdout' as const },
    { text: 'warning: x', stream: 'stderr' as const }
  ]
  expect(runText({ runId: 1, command: 'git fetch', lines, exit: 0 })).toBe(
    '$ git fetch\nFetching\nwarning: x\nexit 0\n'
  )
  expect(runText({ runId: 2, command: 'git pull', lines: [], exit: null })).toBe(
    '$ git pull\ncancelled\n'
  )
  expect(runText({ runId: 3, command: 'git pull', lines: [] })).toBe('$ git pull\n')
  expect(runText({ runId: 4, lines: [{ text: 'note', stream: 'meta' }] })).toBe('note\n')
})

describe('scoreText', () => {
  test('shows the score out of 100', () => {
    expect(scoreText(94)).toBe('94/100')
  })
  test('says reviewed when there is no score', () => {
    expect(scoreText(null)).toBe('reviewed')
  })
})

test.each([
  [100, 'good'],
  [80, 'good'],
  [79, 'fair'],
  [40, 'fair'],
  [39, 'poor'],
  [0, 'poor'],
  [null, null]
] as const)('scoreTone(%s) is %s', (score, tone) => {
  expect(scoreTone(score)).toBe(tone)
})

describe('isRunning', () => {
  test('is true for a text that ends in an ellipsis', () => {
    expect(isRunning('reviewing…')).toBe(true)
    expect(isRunning('updated')).toBe(false)
  })
})

test('agentCode maps known agents and falls back to two letters of the label', () => {
  expect(agentCode({ id: 'claude-code', label: 'Claude Code' })).toBe('CC')
  expect(agentCode({ id: 'codex', label: 'Codex' })).toBe('CX')
  expect(agentCode({ id: 'opencode', label: 'OpenCode' })).toBe('OP')
})

describe('splitFrontmatter', () => {
  it('splits the leading block into fields and the body', () => {
    expect(splitFrontmatter('---\nname: x\ndescription: "y"\n---\n# T\n')).toEqual({
      fields: [
        ['name', 'x'],
        ['description', 'y']
      ],
      body: '# T\n'
    })
  })

  it('strips carriage returns', () => {
    expect(splitFrontmatter('---\r\nname: x\r\n---\r\nbody\r\n').fields).toEqual([['name', 'x']])
  })

  it('returns the whole text as body without a block', () => {
    expect(splitFrontmatter('# T\n')).toEqual({ fields: [], body: '# T\n' })
  })
})

describe('formatSize', () => {
  it.each([
    [{ bytes: 49152, files: 12 }, '48 KB · 12 files'],
    [{ bytes: 900, files: 1 }, '900 B · 1 file'],
    [{ bytes: 2621440, files: 3 }, '2.5 MB · 3 files']
  ])('formats %j', (size, text) => {
    expect(formatSize(size)).toBe(text)
  })
})

describe('fixLabel', () => {
  test('shows fixed and the age', () => {
    const now = 10 * 86_400_000
    expect(fixLabel({ fixedAt: now - 2 * 86_400_000 }, now)).toBe('fixed · 2 days ago')
  })
})

test('localDate is the local date of an ISO time as YYYY-MM-DD', () => {
  expect(localDate('2026-11-10T12:00:00.000Z')).toBe('2026-11-10')
})

it.each([
  ['clean', '0.1.1', 'published 0.1.1'],
  ['uncommitted', '0.1.1', 'published 0.1.1'],
  ['committed', '0.1.1', 'published 0.1.1'],
  ['commit-failed', '0.1.1', 'published 0.1.1; manifest commit failed (see Log)'],
  ['committed', null, 'published'],
  ['commit-failed', null, 'published; manifest commit failed (see Log)']
] as const)('publishedText %s %s', (manifest, version, text) => {
  expect(publishedText(manifest, version)).toBe(text)
})

describe('publishVisibility', () => {
  const manifest = (isPrivate: boolean | null): Manifest => ({
    workspace: 'acme',
    plugin: 'probe',
    version: '0.1.0',
    private: isPrivate
  })

  it('reads the manifest of the chosen workspace', () => {
    expect(publishVisibility(manifest(true), 'acme')).toEqual({
      text: 'private · workspace members',
      isPublic: false
    })
    expect(publishVisibility(manifest(false), 'acme')).toEqual({
      text: 'public · anyone can see and install it',
      isPublic: true
    })
    expect(publishVisibility(manifest(null), 'acme')).toEqual({
      text: 'unknown · the manifest does not say',
      isPublic: false
    })
  })

  it('gives the Tessl default without a manifest, and unknown for another workspace', () => {
    expect(publishVisibility(null, 'acme')).toEqual({
      text: "private · Tessl's default for a new skill",
      isPublic: false
    })
    expect(publishVisibility(manifest(false), 'beta')).toEqual({
      text: 'unknown · the manifest is for acme',
      isPublic: false
    })
  })
})

describe('diffFiles', () => {
  it('splits git diff output per file and drops the header lines', () => {
    const text = [
      'diff --git a/kit/a.md b/kit/a.md',
      'index 02c2dd7..f38a3b8 100644',
      '--- a/kit/a.md',
      '+++ b/kit/a.md',
      '@@ -1,2 +1,2 @@',
      ' same',
      '-old',
      '+new',
      'diff --git a/kit/gone.md b/kit/gone.md',
      'deleted file mode 100644',
      'index e928bde..0000000',
      '--- a/kit/gone.md',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
      ''
    ].join('\n')
    expect(diffFiles(text)).toEqual([
      {
        path: 'kit/a.md',
        lines: [
          { line: '@@ -1,2 +1,2 @@', kind: 'hunk' },
          { line: ' same', kind: '' },
          { line: '-old', kind: 'del' },
          { line: '+new', kind: 'add' }
        ]
      },
      {
        path: 'kit/gone.md',
        lines: [
          { line: 'deleted file mode 100644', kind: '' },
          { line: '@@ -1 +0,0 @@', kind: 'hunk' },
          { line: '-bye', kind: 'del' }
        ]
      }
    ])
  })

  it('starts a file at a ---/+++ pair without a diff --git line', () => {
    const text =
      '--- a/x.md\n+++ b/x.md\n@@ -1 +1 @@\n-a\n+b\n--- a/y.md\n+++ b/y.md\n@@ -1 +1 @@\n-c\n+d\n'
    expect(diffFiles(text).map((f) => [f.path, f.lines.length])).toEqual([
      ['x.md', 3],
      ['y.md', 3]
    ])
  })

  it('keeps a removed line that starts with -- inside a hunk', () => {
    const text = '--- a/x.md\n+++ b/x.md\n@@ -1,2 +1 @@\n--- rule\n keep\n'
    expect(diffFiles(text)).toEqual([
      {
        path: 'x.md',
        lines: [
          { line: '@@ -1,2 +1 @@', kind: 'hunk' },
          { line: '--- rule', kind: 'del' },
          { line: ' keep', kind: '' }
        ]
      }
    ])
  })
})

describe('gridItems', () => {
  const gh = { type: 'github', owner: 'acme', repo: 'tools', subpath: '' } as const
  const named = (name: string, source: Entry['source'], stowed = false): Entry => ({
    ...entry(source),
    name,
    enabledFor: stowed ? [] : ['claude-code']
  })
  const entries = [
    named('a', gh),
    named('b', gh, true),
    named('c', { type: 'local', path: '/home/u/c' }),
    named('d', { type: 'github', owner: 'acme', repo: 'solo', subpath: '' }),
    named('e', { type: 'tessl', workspace: 'ws', plugin: 'p', subpath: '' })
  ]
  const packs: Pack[] = [
    {
      key: 'github:acme/tools',
      type: 'github',
      name: 'acme/tools',
      skills: ['a', 'b'],
      folder: '/f'
    }
  ]
  const items = (
    view: 'skills' | 'packs',
    open: string | null,
    search: string,
    filter: Filter
  ): string[] =>
    gridItems(entries, [...packs], '/home/u', view, open, search, filter).map((i) =>
      i.kind === 'pack'
        ? `pack ${i.pack.name} ${i.members.map((m) => m.name).join('')}`
        : `${i.entry.name}${i.index}`
    )

  it('lists every skill in the skills view', () => {
    expect(items('skills', null, '', 'all')).toEqual(['a0', 'b1', 'c2', 'd3', 'e4'])
  })

  it('folds a pack into one item in the packs view', () => {
    expect(items('packs', null, '', 'all')).toEqual(['pack acme/tools ab', 'c2', 'd3', 'e4'])
    expect(items('packs', null, '', 'github')).toEqual(['pack acme/tools ab', 'd3'])
    expect(items('packs', null, '', 'tessl')).toEqual(['e4'])
    expect(items('packs', null, '', 'local')).toEqual(['c2'])
  })

  it('places a pack by its own name, ignoring case, not by its first member', () => {
    const kit = { type: 'github', owner: 'Zed', repo: 'kit', subpath: '' } as const
    const mixed = [named('alpha', kit), named('beta', { type: 'local', path: '/home/u/beta' })]
    mixed.push(named('omega', kit), named('zulu', { type: 'local', path: '/home/u/zulu' }))
    const kitPack: Pack = {
      key: 'github:Zed/kit',
      type: 'github',
      name: 'Zed/kit',
      skills: ['alpha', 'omega'],
      folder: '/f'
    }
    const shown = gridItems(mixed, [kitPack], '/home/u', 'packs', null, '', 'all')
    expect(shown.map((i) => (i.kind === 'pack' ? i.pack.name : i.entry.name))).toEqual([
      'beta',
      'Zed/kit',
      'zulu'
    ])
  })

  it('is flat for the stowed chip and for a search', () => {
    expect(items('packs', null, '', 'stowed')).toEqual(['b1'])
    expect(items('packs', null, 'a', 'all')).toEqual(
      entries.flatMap((e, i) => (matches(e, '/home/u', 'a', 'all') ? [`${e.name}${i}`] : []))
    )
  })

  it('shows the members of an open pack, and only all or stowed apply', () => {
    expect(items('packs', 'github:acme/tools', '', 'all')).toEqual(['a0', 'b1'])
    expect(items('packs', 'github:acme/tools', '', 'stowed')).toEqual(['b1'])
    expect(items('packs', 'github:acme/tools', 'b', 'all')).toEqual(['b1'])
    expect(items('skills', 'github:acme/tools', '', 'tessl')).toEqual(['a0', 'b1'])
  })
})

describe('packToggleText', () => {
  const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `s${i}`)
  it('is null when nothing was refused', () => {
    expect(
      packToggleText({ changed: names(5), already: names(3), refused: [] }, true, 'Claude Code')
    ).toBeNull()
    expect(
      packToggleText({ changed: names(8), already: [], refused: [] }, false, 'Claude Code')
    ).toBeNull()
  })

  it('names the refusals', () => {
    expect(
      packToggleText(
        { changed: names(6), already: names(1), refused: [{ skill: 'gsap-core', message: 'why' }] },
        true,
        'Claude Code'
      )
    ).toBe('7 of 8 deployed to Claude Code; gsap-core: why')
  })
})

describe('packRemoveText', () => {
  it('is null without a refusal and names one otherwise', () => {
    expect(packRemoveText({ removed: ['a'], refused: [] }, 'acme/tools')).toBeNull()
    expect(
      packRemoveText({ removed: names7(), refused: [{ skill: 'x', message: 'why' }] }, 'acme/tools')
    ).toBe('Removed 7 of 8 skills of acme/tools; x: why')
  })
})
const names7 = (): string[] => Array.from({ length: 7 }, (_, i) => `s${i}`)
