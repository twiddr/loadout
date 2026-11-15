// No Node import: the sandboxed renderer bundles this file. The file reader is `bucket.ts`.
import type { Agent } from './config'

export interface Synced {
  /** The config agent whose folder is ~/.claude/skills. */
  agentId: string
  /** Folder names in the live bucket that hold SKILL.md, sorted. */
  skills: string[]
  /** settings.json has "syncClaudeAiSkills": false. */
  syncOff: boolean
  /** Names whose "anthropic-skills:<name>" override is "off", sorted. */
  off: string[]
}

export type SyncedLoad = 'none' | 'loaded' | 'not-loaded'

const PREFIX = 'anthropic-skills:'
const ID = /^[0-9A-Za-z-]+$/

/** The line that turns the sync off, for the copy block. */
export const SYNC_OFF_LINE = '"syncClaudeAiSkills": false'

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    return value as Record<string, unknown>
  } catch {
    return null
  }
}

/** '<organizationUuid>_<accountUuid>' from the text of ~/.claude.json; null when either id is missing or unsafe. */
export function bucketName(claudeJson: string): string | null {
  const account = parseObject(claudeJson)?.oauthAccount
  if (typeof account !== 'object' || account === null) return null
  const { organizationUuid, accountUuid } = account as Record<string, unknown>
  if (typeof organizationUuid !== 'string' || !ID.test(organizationUuid)) return null
  if (typeof accountUuid !== 'string' || !ID.test(accountUuid)) return null
  return `${organizationUuid}_${accountUuid}`
}

/** The sync switch and the names of the skills turned off, from the text of settings.json. Never throws. */
export function parseClaudeSettings(text: string): { syncOff: boolean; off: string[] } {
  const settings = parseObject(text)
  const overrides = settings?.skillOverrides
  const off: string[] = []
  if (typeof overrides === 'object' && overrides !== null && !Array.isArray(overrides)) {
    for (const [key, value] of Object.entries(overrides)) {
      if (key.startsWith(PREFIX) && value === 'off') off.push(key.slice(PREFIX.length))
    }
  }
  return { syncOff: settings?.syncClaudeAiSkills === false, off: off.sort() }
}

/** Whether Claude Code loads the synced skill `name`: none when it is not in the bucket. */
export function syncedLoad(synced: Synced | null, name: string): SyncedLoad {
  if (!synced?.skills.includes(name)) return 'none'
  return synced.syncOff || synced.off.includes(name) ? 'not-loaded' : 'loaded'
}

/** Whether the agent that owns ~/.claude/skills is enabled. */
export function claudeEnabled(synced: Synced | null, agents: Agent[]): boolean {
  if (!synced) return false
  return agents.some((a) => a.id === synced.agentId && a.enabled)
}

/** The settings.json block that turns the named synced skills off. */
export function overridesBlock(names: string[]): string {
  const lines = names.map((n) => `  ${JSON.stringify(PREFIX + n)}: "off"`)
  return `"skillOverrides": {\n${lines.join(',\n')}\n}`
}
