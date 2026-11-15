import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/core/config'
import type { Agent } from '../src/core/config'
import type { Startup, State } from '../src/core/ipc'
import type { UnmanagedRow } from '../src/core/recruit'
import {
  bootcampStatus,
  effectiveStartup,
  folderLine,
  installChoice,
  rankWord,
  shouldOpenBootCamp,
  toolStatus
} from '../src/renderer/src/bootcamp'
import { INSTALL_HINTS } from '../src/renderer/src/format'

const tool = { path: '/bin/x', version: '1' }

function stateWith(
  partial: Partial<Omit<State, 'startup'>> & { startup?: Partial<Startup> } = {}
): State {
  const { startup, ...rest } = partial
  return {
    seq: 1,
    home: '/h',
    agents: structuredClone(DEFAULT_CONFIG.agents),
    entries: [],
    unmanaged: [],
    backups: [],
    busy: null,
    tesslWorkspace: '',
    tesslWorkspaces: [],
    appearance: 'system',
    loadoutView: 'skills',
    packs: [],
    checks: {},
    reviews: {},
    fixes: {},
    manifests: {},
    edited: {},
    registry: {},
    synced: null,
    appUpdate: null,
    startup: {
      pathSource: 'inherited',
      tools: { git: null, tessl: null, claude: null, codex: null },
      tesslUser: null,
      folders: {},
      notRunning: {},
      homebrew: false,
      mustering: false,
      ...startup
    },
    ...rest
  }
}

function enabled(agents: Agent[], id: string): Agent[] {
  return agents.map((a) => (a.id === id ? { ...a, enabled: true } : a))
}

describe('toolStatus', () => {
  it('reports ok, not-running, missing and checking', () => {
    const s = stateWith({
      startup: { tools: { git: tool, tessl: null }, notRunning: { tessl: '/bin/tessl' } }
    }).startup
    expect(toolStatus(s, 'git')).toBe('ok')
    expect(toolStatus(s, 'tessl')).toBe('not-running')
    expect(toolStatus(s, 'claude')).toBe('missing')
    expect(toolStatus({ ...s, mustering: true }, 'git')).toBe('checking')
  })
})

describe('effectiveStartup', () => {
  it('keeps the last completed check while a new one runs', () => {
    const last = stateWith({ startup: { tools: { git: tool } } }).startup
    const now = { ...last, tools: { git: null }, mustering: true }
    expect(effectiveStartup(now, last)).toBe(last)
    expect(effectiveStartup(now, null)).toBe(now)
    expect(effectiveStartup(last, now)).toBe(last)
  })
})

describe('bootcampStatus', () => {
  it('is empty for a fresh state', () => {
    expect(bootcampStatus(stateWith())).toEqual({
      agents: false,
      git: false,
      tessl: false,
      done: 0
    })
  })

  it('counts all three when everything is set', () => {
    const s = stateWith({
      agents: enabled(DEFAULT_CONFIG.agents, 'codex'),
      tesslWorkspace: 'w',
      startup: { tools: { git: tool, tessl: tool }, tesslUser: 'me' }
    })
    expect(bootcampStatus(s)).toEqual({ agents: true, git: true, tessl: true, done: 3 })
  })

  it('needs tessl, a user and a workspace together', () => {
    const base = { tools: { tessl: tool } }
    expect(bootcampStatus(stateWith({ startup: { ...base, tesslUser: 'me' } })).tessl).toBe(false)
    expect(bootcampStatus(stateWith({ startup: base, tesslWorkspace: 'w' })).tessl).toBe(false)
  })

  it('keeps git and tessl false while mustering', () => {
    const s = stateWith({
      agents: enabled(DEFAULT_CONFIG.agents, 'codex'),
      tesslWorkspace: 'w',
      startup: { mustering: true, tools: { git: tool, tessl: tool }, tesslUser: 'me' }
    })
    expect(bootcampStatus(s)).toEqual({ agents: true, git: false, tessl: false, done: 1 })
  })
})

describe('installChoice', () => {
  it('offers Homebrew only when found and a brew command exists', () => {
    expect(installChoice('tessl', true).brew).toEqual([
      'brew tap tesslio/tap',
      'brew trust tesslio/tap',
      'brew install tesslio/tap/tessl'
    ])
    expect(installChoice('git', false)).toEqual({ brew: null, direct: ['xcode-select --install'] })
  })
})

describe('rankWord', () => {
  it('follows the agents and git flags', () => {
    expect(rankWord({ agents: false, git: true })).toBe('RECRUIT')
    expect(rankWord({ agents: true, git: false })).toBe('ENLISTED')
    expect(rankWord({ agents: true, git: true })).toBe('READY FOR DUTY')
  })
})

describe('shouldOpenBootCamp', () => {
  it('is true when no agent is enabled', () => {
    expect(shouldOpenBootCamp(DEFAULT_CONFIG.agents)).toBe(true)
    expect(shouldOpenBootCamp(enabled(DEFAULT_CONFIG.agents, 'codex'))).toBe(false)
  })
})

describe('folderLine', () => {
  const claude = DEFAULT_CONFIG.agents[0]
  const codex = DEFAULT_CONFIG.agents[1]
  const unmanaged = (n: number): UnmanagedRow[] =>
    Array.from({ length: n }, (_, i) => ({
      agentId: 'claude-code',
      name: `s${i}`,
      kind: 'folder' as const,
      target: null,
      dangling: false,
      recruit: { kind: 'none' as const }
    }))

  it('covers a missing folder and an existing folder with 0, 1 and 2 entries', () => {
    expect(folderLine(codex, stateWith())).toBe('Loadout creates this folder at your first toggle.')
    const up = { startup: { folders: { 'claude-code': true } } }
    expect(folderLine(claude, stateWith(up))).toBe('')
    expect(folderLine(claude, stateWith({ ...up, unmanaged: unmanaged(1) }))).toBe(
      '1 entry is already in this folder. Loadout leaves it as it is.'
    )
    expect(folderLine(claude, stateWith({ ...up, unmanaged: unmanaged(2) }))).toBe(
      '2 entries are already in this folder. Loadout leaves them as they are.'
    )
  })
})

describe('INSTALL_HINTS', () => {
  it('is derived from the command table', () => {
    expect(INSTALL_HINTS).toEqual({
      git: 'Install git: xcode-select --install. Press Refresh afterwards.',
      tessl:
        'Install Tessl: curl -fsSL https://get.tessl.io | sh, then tessl login. Press Refresh afterwards.',
      claude:
        'Install Claude Code: curl -fsSL https://claude.ai/install.sh | bash, then claude auth login. Press Refresh afterwards.',
      codex:
        'Install Codex: curl -fsSL https://chatgpt.com/codex/install.sh | sh, then codex login. Press Refresh afterwards.'
    })
  })
})
