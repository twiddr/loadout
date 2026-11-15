import { join } from 'node:path'
import type { AgentFolder } from './agents'
import { agentFolder, type Agent } from './config'
import type { LibraryEntry } from './library'
import type { Paths } from './paths'

export interface ToggleRequest {
  skill: string
  agentId: string
  on: boolean
}

export type Op =
  | { op: 'mkdir'; path: string }
  | { op: 'link'; path: string; target: string }
  /** `target`: the link target the plan read, absolute; the link is removed only while it still has it. */
  | { op: 'unlink'; path: string; target: string }

export type Plan = { ok: true; ops: Op[] } | { ok: false; message: string }

const refuse = (message: string): Plan => ({ ok: false, message })

/** Why a toggle for `agentId` is refused before any skill is read; null when the agent can take one. */
export function agentRefusal(agents: Agent[], agentId: string): string | null {
  const agent = agents.find((a) => a.id === agentId)
  if (!agent) return `Unknown agent "${agentId}".`
  if (!agent.enabled) return `${agent.label} is not enabled. Enable it in Settings first.`
  return null
}

/** Pure: decides which disk operations a toggle needs. Never touches the disk. */
export function planToggle(
  request: ToggleRequest,
  agents: Agent[],
  library: LibraryEntry[],
  folders: AgentFolder[],
  paths: Paths
): Plan {
  const { skill, agentId, on } = request
  const refused = agentRefusal(agents, agentId)
  if (refused !== null) return refuse(refused)
  const agent = agents.find((a) => a.id === agentId) as Agent
  const entry = library.find((e) => e.name === skill)
  if (!entry) return refuse(`"${skill}" is not in your loadout.`)

  const state = folders.find((f) => f.agentId === agentId)
  const folder = state?.folder ?? agentFolder(agent, paths)
  const link = join(folder, skill)
  const unmanaged = state?.unmanaged.some((u) => u.name === skill) ?? false
  const managed = state?.managed.includes(skill) ?? false

  if (!on) {
    if (unmanaged) {
      return refuse(`${link} was not created by Loadout, so Loadout will not remove it.`)
    }
    const ops: Op[] = managed
      ? [{ op: 'unlink', path: link, target: join(paths.library, skill) }]
      : []
    return { ok: true, ops }
  }

  if (entry.status === 'missing') {
    return refuse(
      `"${skill}" cannot be enabled: its source folder ${entry.target} is missing. Remove or relocate it first.`
    )
  }
  if (entry.status === 'not-a-link') {
    return refuse(`"${skill}" is not a symlink in your loadout. Fix it in Finder first.`)
  }
  if (unmanaged) {
    return refuse(
      `${link} already exists and Loadout did not create it. Recruit it on the Recon page, or remove it by hand.`
    )
  }
  if (managed) return { ok: true, ops: [] }

  const ops: Op[] = []
  if (!(state?.folderExists ?? false)) ops.push({ op: 'mkdir', path: folder })
  ops.push({ op: 'link', path: link, target: join(paths.library, skill) })
  return { ok: true, ops }
}
