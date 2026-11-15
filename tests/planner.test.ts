import { describe, expect, test } from 'vitest'
import type { Agent } from '../src/core/config'
import type { AgentFolder } from '../src/core/agents'
import type { LibraryEntry } from '../src/core/library'
import { pathsFrom } from '../src/core/paths'
import { planToggle, type Plan, type ToggleRequest } from '../src/core/planner'

const paths = pathsFrom('/tmp/h')
const folder = '/tmp/h/.claude/skills'
const link = `${folder}/x`
const target = `${paths.library}/x`

const claude: Agent = {
  id: 'claude-code',
  label: 'Claude Code',
  command: 'claude',
  folder: '~/.claude/skills',
  alsoReadBy: [],
  enabled: true
}
const disabled: Agent = { ...claude, enabled: false }

function entry(status: LibraryEntry['status'], entryTarget = '/src/x'): LibraryEntry {
  return { name: 'x', source: { type: 'local', path: entryTarget }, status, target: entryTarget }
}

function folderState(state: Partial<AgentFolder> = {}): AgentFolder {
  return {
    agentId: 'claude-code',
    folder,
    folderExists: true,
    managed: [],
    unmanaged: [],
    ...state
  }
}

function unmanagedX(): AgentFolder['unmanaged'] {
  return [{ agentId: 'claude-code', name: 'x', kind: 'folder', target: null, dangling: false }]
}

const on: ToggleRequest = { skill: 'x', agentId: 'claude-code', on: true }
const off: ToggleRequest = { ...on, on: false }

interface Case {
  name: string
  request: ToggleRequest
  agents?: Agent[]
  library?: LibraryEntry[]
  folders?: AgentFolder[]
  expected: Plan
}

const refusal = (message: string): Plan => ({ ok: false, message })
const ops = (list: Extract<Plan, { ok: true }>['ops']): Plan => ({ ok: true, ops: list })

const cases: Case[] = [
  {
    name: 'unknown agent',
    request: { ...on, agentId: 'nope' },
    library: [entry('ok')],
    expected: refusal('Unknown agent "nope".')
  },
  {
    name: 'agent not enabled (on)',
    request: on,
    agents: [disabled],
    library: [entry('ok')],
    expected: refusal('Claude Code is not enabled. Enable it in Settings first.')
  },
  {
    name: 'agent not enabled (off)',
    request: off,
    agents: [disabled],
    library: [entry('ok')],
    expected: refusal('Claude Code is not enabled. Enable it in Settings first.')
  },
  {
    name: 'skill not in library',
    request: on,
    library: [],
    expected: refusal('"x" is not in your loadout.')
  },
  {
    name: 'on, entry missing',
    request: on,
    library: [entry('missing', '/src/x')],
    expected: refusal(
      '"x" cannot be enabled: its source folder /src/x is missing. Remove or relocate it first.'
    )
  },
  {
    name: 'on, entry not a link',
    request: on,
    library: [entry('not-a-link')],
    expected: refusal('"x" is not a symlink in your loadout. Fix it in Finder first.')
  },
  {
    name: 'on, unmanaged entry in agent folder',
    request: on,
    library: [entry('ok')],
    folders: [folderState({ unmanaged: unmanagedX() })],
    expected: refusal(
      `${folder}/x already exists and Loadout did not create it. Recruit it on the Recon page, or remove it by hand.`
    )
  },
  {
    name: 'off, unmanaged entry in agent folder',
    request: off,
    library: [entry('ok')],
    folders: [folderState({ unmanaged: unmanagedX() })],
    expected: refusal(`${folder}/x was not created by Loadout, so Loadout will not remove it.`)
  },
  {
    name: 'on, folder missing',
    request: on,
    library: [entry('ok')],
    folders: [folderState({ folderExists: false })],
    expected: ops([
      { op: 'mkdir', path: folder },
      { op: 'link', path: link, target }
    ])
  },
  {
    name: 'on, no folder entry for the agent',
    request: on,
    library: [entry('ok')],
    folders: [],
    expected: ops([
      { op: 'mkdir', path: folder },
      { op: 'link', path: link, target }
    ])
  },
  {
    name: 'on, folder present',
    request: on,
    library: [entry('ok')],
    expected: ops([{ op: 'link', path: link, target }])
  },
  {
    name: 'on, already managed',
    request: on,
    library: [entry('ok')],
    folders: [folderState({ managed: ['x'] })],
    expected: ops([])
  },
  {
    name: 'off, managed',
    request: off,
    library: [entry('ok')],
    folders: [folderState({ managed: ['x'] })],
    expected: ops([{ op: 'unlink', path: link, target }])
  },
  {
    name: 'off, absent',
    request: off,
    library: [entry('ok')],
    expected: ops([])
  }
]

describe('planToggle', () => {
  test.each(cases)('$name', ({ request, agents, library, folders, expected }) => {
    expect(
      planToggle(request, agents ?? [claude], library ?? [], folders ?? [folderState()], paths)
    ).toEqual(expected)
  })
})
