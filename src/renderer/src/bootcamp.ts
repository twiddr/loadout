import type { Agent } from '../../core/config'
import type { Startup, State } from '../../core/ipc'
import { INSTALL_COMMANDS } from './format'
import type { InstallTool } from './format'

export type ToolStatus = 'ok' | 'not-running' | 'missing' | 'checking'

export function toolStatus(startup: Startup, tool: string): ToolStatus {
  if (startup.mustering) return 'checking'
  if (startup.tools[tool]) return 'ok'
  return tool in startup.notRunning ? 'not-running' : 'missing'
}

/** While a check runs, the page keeps showing the last completed one. */
export function effectiveStartup(current: Startup, last: Startup | null): Startup {
  return current.mustering && last ? last : current
}

export interface BootCampStatus {
  agents: boolean
  git: boolean
  tessl: boolean
  done: number
}

/** The three done flags of BOOT CAMP; the tool checks are false while they still run. */
export function bootcampStatus(state: State): BootCampStatus {
  const { startup } = state
  const checked = !startup.mustering
  const agents = state.agents.some((a) => a.enabled)
  const git = checked && Boolean(startup.tools.git)
  const tessl =
    checked &&
    Boolean(startup.tools.tessl) &&
    Boolean(startup.tesslUser) &&
    Boolean(state.tesslWorkspace)
  return { agents, git, tessl, done: [agents, git, tessl].filter(Boolean).length }
}

/** The Homebrew lines only when Homebrew is found. */
export function installChoice(
  tool: InstallTool,
  homebrew: boolean
): { brew: string[] | null; direct: string[] } {
  const { brew, direct } = INSTALL_COMMANDS[tool]
  return { brew: homebrew ? brew : null, direct }
}

/** The word under the rank badge: no agent, an agent, an agent and git. */
export function rankWord(status: { agents: boolean; git: boolean }): string {
  if (!status.agents) return 'RECRUIT'
  return status.git ? 'READY FOR DUTY' : 'ENLISTED'
}

export function shouldOpenBootCamp(agents: Agent[]): boolean {
  return !agents.some((a) => a.enabled)
}

export function folderLine(agent: Agent, state: State): string {
  if (!state.startup.folders[agent.id]) return 'Loadout creates this folder at your first toggle.'
  const n = state.unmanaged.filter((u) => u.agentId === agent.id).length
  if (n === 0) return ''
  // Entries, not skills: they include files and dangling links, so the line promises only no change.
  if (n === 1) return '1 entry is already in this folder. Loadout leaves it as it is.'
  return `${n} entries are already in this folder. Loadout leaves them as they are.`
}
