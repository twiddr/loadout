import { describe, expect, test } from 'vitest'
import type { Agent } from '../src/core/config'
import type { AgentFolder } from '../src/core/agents'
import type { LibraryEntry } from '../src/core/library'
import { pathsFrom } from '../src/core/paths'
import {
  backupPath,
  describeStep,
  differenceLines,
  planRecruit,
  planUndo,
  rowStatus,
  type EntryFacts,
  type RecruitStatus,
  type Step
} from '../src/core/recruit'

const paths = pathsFrom('/h')
const claude: Agent = {
  id: 'claude',
  label: 'Claude Code',
  command: 'claude',
  folder: '~/.claude/skills',
  alsoReadBy: [],
  enabled: true
}
const codex: Agent = {
  id: 'codex',
  label: 'Codex',
  command: 'codex',
  folder: '~/.codex/skills',
  alsoReadBy: [],
  enabled: true
}
const agents = [claude, codex]

function folder(
  entry: string,
  skillName: string | null,
  over: Partial<EntryFacts> = {}
): EntryFacts {
  return {
    agentId: 'claude',
    entry,
    path: `/h/.claude/skills/${entry}`,
    kind: 'folder',
    target: null,
    dangling: false,
    hasSkillMd: true,
    skillName,
    ...over
  }
}

function link(entry: string, target: string, over: Partial<EntryFacts> = {}): EntryFacts {
  return folder(entry, entry, { kind: 'link', target, ...over })
}

const text = (t: string): RecruitStatus => ({ kind: 'text', text: t })

describe('rowStatus', () => {
  test.each<[string, EntryFacts, string[], RecruitStatus]>([
    [
      '1 synced folder',
      folder('synced', null, { path: paths.synced, hasSkillMd: false }),
      [],
      { kind: 'none' }
    ],
    [
      '2 a file',
      folder('notes.md', null, { kind: 'file', hasSkillMd: false }),
      [],
      { kind: 'none' }
    ],
    [
      '3 agent not enabled',
      folder('x', 'x', { agentId: 'off', path: '/h/.off/skills/x' }),
      [],
      text('Enlist Off to recruit this.')
    ],
    [
      '4 dangling link',
      link('x', '/gone/x', { dangling: true, hasSkillMd: false, skillName: null }),
      [],
      { kind: 'backup' }
    ],
    [
      '5 tessl link',
      link('tessl__x', '/h/.tessl/plugins/ws/p/skills/x'),
      [],
      text(
        'A link into ~/.tessl/plugins, which Tessl manages. Loadout leaves it alone. To get this skill, use Recruit skill › Registry.'
      )
    ],
    [
      '6 agents link',
      link('x', '/h/.agents/skills/x'),
      [],
      text('A link into ~/.agents/skills, which another tool manages. Loadout leaves it alone.')
    ],
    [
      '6 claude plugins link',
      link('x', '/h/.claude/plugins/p/x'),
      [],
      text('A link into ~/.claude/plugins, which another tool manages. Loadout leaves it alone.')
    ],
    [
      '6 codex plugins link',
      link('x', '/h/.codex/plugins/p/x'),
      [],
      text('A link into ~/.codex/plugins, which another tool manages. Loadout leaves it alone.')
    ],
    [
      '7 loadout repos link',
      link('x', '/h/.loadout/repos/a/b/x'),
      [],
      text('A link into ~/.loadout, where Loadout keeps its own files. Loadout leaves it alone.')
    ],
    [
      '8 folder without SKILL.md',
      folder('x', null, { hasSkillMd: false }),
      [],
      text('No SKILL.md in ~/.claude/skills/x.')
    ],
    [
      '8 link target without SKILL.md',
      link('x', '/h/Code/x', { hasSkillMd: false, skillName: null }),
      [],
      text('No SKILL.md in ~/Code/x.')
    ],
    [
      '9 no name',
      folder('x', null),
      [],
      text(
        'SKILL.md in ~/.claude/skills/x has no "name" in its frontmatter. Add the name line, then press Rescan.'
      )
    ],
    [
      '10 bad name',
      folder('x', 'Bad_Name'),
      [],
      text(
        'Skill name "Bad_Name" must be lowercase letters, digits and single hyphens. Change the name line, then press Rescan.'
      )
    ],
    [
      '11 reserved name',
      folder('x', 'synced'),
      [],
      text('The name "synced" is reserved by Claude Code.')
    ],
    [
      '12 name in library',
      folder('x', 'x'),
      ['x'],
      { kind: 'recruit', mode: 'library', name: 'x' }
    ],
    [
      '13 link into another agent folder',
      link('x', '/h/.claude/skills/x', { agentId: 'codex', path: '/h/.codex/skills/x' }),
      [],
      text('This link points at ~/.claude/skills/x. Recruit that one first.')
    ],
    [
      '13 in library gives library',
      link('x', '/h/.claude/skills/x', { agentId: 'codex', path: '/h/.codex/skills/x' }),
      ['x'],
      { kind: 'recruit', mode: 'library', name: 'x' }
    ],
    [
      '14 link elsewhere',
      link('x', '/h/Code/x'),
      [],
      { kind: 'recruit', mode: 'in-place', name: 'x' }
    ],
    ['14 real folder', folder('x', 'x'), [], { kind: 'recruit', mode: 'copy', name: 'x' }],
    [
      'name differs from entry',
      folder('soft-skill', 'sample-misnamed'),
      [],
      { kind: 'recruit', mode: 'copy', name: 'sample-misnamed' }
    ],
    [
      'order: disabled agent beats dangling',
      link('x', '/gone/x', { agentId: 'off', dangling: true, hasSkillMd: false, skillName: null }),
      [],
      text('Enlist Off to recruit this.')
    ],
    [
      'order: dangling tessl link is backup',
      link('x', '/h/.tessl/plugins/gone', { dangling: true, hasSkillMd: false, skillName: null }),
      [],
      { kind: 'backup' }
    ],
    [
      'order: synced in the Codex folder is not row 1',
      folder('synced', 'synced', { agentId: 'codex', path: '/h/.codex/skills/synced' }),
      [],
      text('The name "synced" is reserved by Claude Code.')
    ]
  ])('row %s', (_label, facts, library, expected) => {
    const all = [
      ...agents,
      { ...codex, id: 'off', label: 'Off', enabled: false, folder: '~/.off/skills' }
    ]
    expect(rowStatus(facts, all, library, paths)).toEqual(expected)
  })
})

describe('describeStep', () => {
  test.each<[Step, string]>([
    [
      { op: 'copy', from: '/h/.claude/skills/x', to: '/h/Code/skills/x' },
      'Copy ~/.claude/skills/x to ~/Code/skills/x.'
    ],
    [
      { op: 'verify', a: '/h/.claude/skills/x', b: '/h/Code/skills/x' },
      'Check that the copy is identical to your original.'
    ],
    [
      { op: 'add', name: 'x', target: '/h/Code/skills/x' },
      'Add x to your loadout, linked to ~/Code/skills/x.'
    ],
    [
      { op: 'move', from: '/h/.claude/skills/x', to: '/h/.loadout/backups/claude-code/x' },
      'Move your original from ~/.claude/skills/x to ~/.loadout/backups/claude-code/x. It stays there, unchanged.'
    ],
    [
      {
        op: 'move',
        from: '/h/.loadout/backups/claude-code/x',
        to: '/h/.claude/skills/x',
        back: true
      },
      'Move your original from ~/.loadout/backups/claude-code/x back to ~/.claude/skills/x.'
    ],
    [
      { op: 'link', path: '/h/.claude/skills/x', name: 'x', label: 'Claude Code' },
      "Link ~/.claude/skills/x to your loadout's x, so Claude Code keeps loading the skill."
    ],
    [
      { op: 'unlink', path: '/h/.claude/skills/x', target: '/h/.loadout/skills/x' },
      "Remove Loadout's link ~/.claude/skills/x."
    ]
  ])('%#', (step, sentence) => {
    expect(describeStep(step, '/h')).toBe(sentence)
  })
})

test('backupPath joins backups, agent id and entry', () => {
  expect(backupPath('claude', 'x', paths)).toBe('/h/.loadout/backups/claude/x')
})

describe('planRecruit', () => {
  const agentDir = '/h/.claude/skills'
  const emptyFolder: AgentFolder = {
    agentId: 'claude',
    folder: agentDir,
    folderExists: true,
    managed: [],
    unmanaged: []
  }
  const devices = { agent: 1, loadout: 1 }
  const lib = (name: string, status: LibraryEntry['status'] = 'ok'): LibraryEntry => ({
    name,
    source: { type: 'local', path: `/h/Code/skills/${name}` },
    status,
    target: `/h/Code/skills/${name}`
  })
  const input = (
    over: Partial<Parameters<typeof planRecruit>[0]> = {}
  ): Parameters<typeof planRecruit>[0] => ({
    facts: folder('x', 'x'),
    status: { kind: 'recruit', mode: 'copy', name: 'x' },
    agent: claude,
    parent: '/h/Code/skills',
    library: [],
    folder: emptyFolder,
    agents,
    devices,
    paths,
    ...over
  })
  const ops = (plan: ReturnType<typeof planRecruit>): string[] =>
    plan.ok ? plan.steps.map((s) => s.op) : [plan.message]

  test('mode copy', () => {
    const plan = planRecruit(input())
    expect(plan).toEqual({
      ok: true,
      mode: 'copy',
      steps: [
        { op: 'copy', from: '/h/.claude/skills/x', to: '/h/Code/skills/x' },
        { op: 'verify', a: '/h/.claude/skills/x', b: '/h/Code/skills/x' },
        { op: 'add', name: 'x', target: '/h/Code/skills/x' },
        { op: 'move', from: '/h/.claude/skills/x', to: '/h/.loadout/backups/claude/x' },
        { op: 'link', path: '/h/.claude/skills/x', name: 'x', label: 'Claude Code' }
      ]
    })
  })

  test('mode copy before the user picked a folder', () => {
    expect(planRecruit(input({ parent: null }))).toEqual({ ok: true, mode: 'copy', steps: [] })
  })

  test('mode in place', () => {
    const plan = planRecruit(
      input({
        facts: link('x', '/h/own/x'),
        status: { kind: 'recruit', mode: 'in-place', name: 'x' },
        parent: null
      })
    )
    expect(ops(plan)).toEqual(['add', 'move', 'link'])
    expect(plan.ok && plan.steps[0]).toEqual({ op: 'add', name: 'x', target: '/h/own/x' })
  })

  test('mode library', () => {
    const plan = planRecruit(
      input({
        status: { kind: 'recruit', mode: 'library', name: 'x' },
        library: [lib('x')],
        parent: null
      })
    )
    expect(ops(plan)).toEqual(['move', 'link'])
  })

  test('dangling link', () => {
    const plan = planRecruit(
      input({
        facts: link('x', '/gone/x', { dangling: true, hasSkillMd: false, skillName: null }),
        status: { kind: 'backup' },
        parent: null
      })
    )
    expect(plan).toEqual({
      ok: true,
      mode: 'backup',
      steps: [{ op: 'move', from: '/h/.claude/skills/x', to: '/h/.loadout/backups/claude/x' }]
    })
  })

  test("link step is left out when the skill name is already Loadout's link", () => {
    const plan = planRecruit(
      input({
        facts: folder('other', 'x', { path: '/h/.claude/skills/other' }),
        status: { kind: 'recruit', mode: 'library', name: 'x' },
        library: [lib('x')],
        folder: { ...emptyFolder, managed: ['x'] },
        parent: null
      })
    )
    expect(ops(plan)).toEqual(['move'])
  })

  test('link step stays when the names are equal', () => {
    const plan = planRecruit(
      input({
        status: { kind: 'recruit', mode: 'library', name: 'x' },
        library: [lib('x')],
        folder: { ...emptyFolder, managed: ['x'] },
        parent: null
      })
    )
    expect(ops(plan)).toEqual(['move', 'link'])
  })

  test.each<[string, Partial<Parameters<typeof planRecruit>[0]>, string]>([
    ['text status', { status: text('Some row text.') }, 'Some row text.'],
    ['none status', { status: { kind: 'none' } }, '~/.claude/skills/x cannot be recruited.'],
    [
      'name clash with an unmanaged entry',
      {
        facts: folder('other', 'x', { path: '/h/.claude/skills/other' }),
        folder: {
          ...emptyFolder,
          unmanaged: [
            { agentId: 'claude', name: 'x', kind: 'folder', target: null, dangling: false }
          ]
        }
      },
      '~/.claude/skills/x already exists and Loadout did not create it. Recruit it first, or remove it by hand.'
    ],
    [
      'library entry missing',
      {
        status: { kind: 'recruit', mode: 'library', name: 'x' },
        library: [lib('x', 'missing')]
      },
      '"x" in your loadout has no source folder. Remove or relocate it first.'
    ],
    [
      'library entry not a link',
      {
        status: { kind: 'recruit', mode: 'library', name: 'x' },
        library: [lib('x', 'not-a-link')]
      },
      '"x" in your loadout has no source folder. Remove or relocate it first.'
    ],
    [
      'parent in an agent folder',
      { parent: '/h/.codex/skills/sub' },
      'Pick a folder outside the agent folders and ~/.loadout.'
    ],
    [
      'parent is the agent folder',
      { parent: '/h/.claude/skills' },
      'Pick a folder outside the agent folders and ~/.loadout.'
    ],
    [
      'parent in ~/.loadout',
      { parent: '/h/.loadout/skills' },
      'Pick a folder outside the agent folders and ~/.loadout.'
    ],
    [
      'different disks',
      { devices: { agent: 1, loadout: 2 } },
      '~/.claude/skills and ~/.loadout are on different disks, so Loadout cannot move x without copying it. Nothing changed.'
    ]
  ])('refuses: %s', (_label, over, message) => {
    expect(planRecruit(input(over))).toEqual({ ok: false, message })
  })
})

describe('planUndo', () => {
  const agentDir = '/h/.claude/skills'
  const base: AgentFolder = {
    agentId: 'claude',
    folder: agentDir,
    folderExists: true,
    managed: [],
    unmanaged: []
  }
  const move: Step = {
    op: 'move',
    from: '/h/.loadout/backups/claude/x',
    to: '/h/.claude/skills/x',
    back: true
  }

  test('the move alone', () => {
    expect(planUndo({ agent: claude, entry: 'x', name: 'x', folder: base, paths })).toEqual({
      ok: true,
      mode: 'backup',
      steps: [move]
    })
  })

  const inUse = {
    ok: false,
    message:
      '~/.claude/skills/x is in use, so Loadout cannot put your original back there. Move it away, then press Undo again.'
  }

  test("refuses when Loadout's link holds the entry name and there is no skill name", () => {
    const plan = planUndo({
      agent: claude,
      entry: 'x',
      name: null,
      folder: { ...base, managed: ['x'] },
      paths
    })
    expect(plan).toEqual(inUse)
  })

  test("refuses when Loadout's link holds the entry name and the skill name differs", () => {
    const plan = planUndo({
      agent: claude,
      entry: 'soft-skill',
      name: 'sample-misnamed',
      folder: { ...base, managed: ['soft-skill', 'sample-misnamed'] },
      paths
    })
    expect(plan).toEqual({
      ok: false,
      message:
        '~/.claude/skills/soft-skill is in use, so Loadout cannot put your original back there. Move it away, then press Undo again.'
    })
  })

  test("unlinks Loadout's link at another name, then moves", () => {
    const plan = planUndo({
      agent: claude,
      entry: 'old',
      name: 'x',
      folder: { ...base, managed: ['x'] },
      paths
    })
    expect(plan.ok && plan.steps).toEqual([
      { op: 'unlink', path: '/h/.claude/skills/x', target: '/h/.loadout/skills/x' },
      {
        op: 'move',
        from: '/h/.loadout/backups/claude/old',
        to: '/h/.claude/skills/old',
        back: true
      }
    ])
  })

  test("entry name equals the skill name and the path is Loadout's link", () => {
    const plan = planUndo({
      agent: claude,
      entry: 'x',
      name: 'x',
      folder: { ...base, managed: ['x'] },
      paths
    })
    expect(plan.ok && plan.steps.map((s) => s.op)).toEqual(['unlink', 'move'])
  })

  test('refuses when the path is in use', () => {
    const plan = planUndo({
      agent: claude,
      entry: 'x',
      name: 'x',
      folder: {
        ...base,
        unmanaged: [{ agentId: 'claude', name: 'x', kind: 'folder', target: null, dangling: false }]
      },
      paths
    })
    expect(plan).toEqual({
      ok: false,
      message:
        '~/.claude/skills/x is in use, so Loadout cannot put your original back there. Move it away, then press Undo again.'
    })
  })
})

describe('differenceLines', () => {
  test('SKILL.md first, then by path, three forms', () => {
    expect(
      differenceLines(
        { differ: ['b.txt', 'SKILL.md'], onlyA: ['z/c.txt', 'a.txt'], onlyB: ['m.txt'] },
        '~/a',
        '~/b'
      )
    ).toEqual([
      'SKILL.md differs',
      'a.txt is only in ~/a',
      'b.txt differs',
      'm.txt is only in ~/b',
      'z/c.txt is only in ~/a'
    ])
  })
})
