import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expandHome, type Paths } from './paths'

export interface Agent {
  id: string
  label: string
  command: string
  folder: string
  alsoReadBy: string[]
  enabled: boolean
}

export type Appearance = 'system' | 'light' | 'dark'

export const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark']

export type LoadoutView = 'skills' | 'packs'

export const LOADOUT_VIEWS: readonly LoadoutView[] = ['skills', 'packs']

export interface Config {
  agents: Agent[]
  /** The default workspace: Review and Fix use it, Publish starts from it. Always in tesslWorkspaces when set. */
  tesslWorkspace: string
  /** The workspaces the user picked in Settings; Publish offers these. */
  tesslWorkspaces: string[]
  appearance: Appearance
  loadoutView: LoadoutView
}

export const DEFAULT_CONFIG: Config = {
  agents: [
    {
      id: 'claude-code',
      label: 'Claude Code',
      command: 'claude',
      folder: '~/.claude/skills',
      alsoReadBy: ['OpenCode'],
      enabled: false
    },
    {
      id: 'codex',
      label: 'Codex',
      command: 'codex',
      folder: '~/.codex/skills',
      alsoReadBy: [],
      enabled: false
    }
  ],
  tesslWorkspace: '',
  tesslWorkspaces: [],
  appearance: 'dark',
  loadoutView: 'skills'
}

/** Each agent entry as the Agent type says, or an error naming the file and the entry. */
function parseAgents(agents: unknown[], path: string): Agent[] {
  return agents.map((agent, i) => {
    const bad = (why: string): Error => new Error(`Config at ${path}: agents[${i}] ${why}.`)
    if (typeof agent !== 'object' || agent === null) throw bad('is not an object')
    const a = agent as Record<string, unknown>
    for (const key of ['id', 'label', 'command', 'folder']) {
      if (typeof a[key] !== 'string') throw bad(`needs a string "${key}"`)
    }
    if (!Array.isArray(a.alsoReadBy) || !a.alsoReadBy.every((x) => typeof x === 'string')) {
      throw bad('needs a list of strings "alsoReadBy"')
    }
    if (typeof a.enabled !== 'boolean') throw bad('needs true or false "enabled"')
    return agent as Agent
  })
}

export function parseConfig(text: string, path: string): Config {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Config at ${path} is not valid JSON: ${reason}`, { cause: error })
  }
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Config>
  const workspace =
    typeof obj.tesslWorkspace === 'string' ? obj.tesslWorkspace : DEFAULT_CONFIG.tesslWorkspace
  // A config from before the list keeps its one workspace as the list.
  const workspaces = Array.isArray(obj.tesslWorkspaces)
    ? obj.tesslWorkspaces.filter((w): w is string => typeof w === 'string' && w !== '')
    : []
  return {
    agents: Array.isArray(obj.agents)
      ? parseAgents(obj.agents, path)
      : structuredClone(DEFAULT_CONFIG.agents),
    tesslWorkspace: workspace,
    tesslWorkspaces:
      workspace && !workspaces.includes(workspace) ? [workspace, ...workspaces] : workspaces,
    appearance: APPEARANCES.includes(obj.appearance as Appearance)
      ? (obj.appearance as Appearance)
      : DEFAULT_CONFIG.appearance,
    loadoutView: LOADOUT_VIEWS.includes(obj.loadoutView as LoadoutView)
      ? (obj.loadoutView as LoadoutView)
      : DEFAULT_CONFIG.loadoutView
  }
}

export function serializeConfig(config: Config): string {
  return JSON.stringify(config, null, 2) + '\n'
}

export async function readConfig(paths: Paths): Promise<Config> {
  let text: string
  try {
    text = await readFile(paths.config, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(DEFAULT_CONFIG)
    throw error
  }
  return parseConfig(text, paths.config)
}

let writes = 0

/** Writes a temporary file, then renames it over config.json, so a crash never leaves a half-written file. */
export async function writeConfig(paths: Paths, config: Config): Promise<void> {
  await mkdir(dirname(paths.config), { recursive: true })
  // A name per write: Settings writes are not refused while busy, so two can overlap.
  const temporary = `${paths.config}.${process.pid}.${++writes}.tmp`
  await writeFile(temporary, serializeConfig(config))
  await rename(temporary, paths.config)
}

export function agentFolder(agent: Agent, paths: Paths): string {
  return expandHome(agent.folder, paths.home)
}
