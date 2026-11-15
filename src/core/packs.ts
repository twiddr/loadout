// No Node import: the sandboxed renderer bundles this file (packBox). macOS only, so '/' is the separator.
import { sourceKey } from './checks'
import type { LibraryEntry } from './library'
import type { Paths } from './paths'

export interface Pack {
  key: string
  type: 'github' | 'tessl'
  name: string
  skills: string[]
  folder: string
}

export type BoxLook = 'none' | 'some' | 'all'

/** One pack per Link or Registry source with two or more library skills, sorted by key. */
export function derivePacks(entries: LibraryEntry[], paths: Paths): Pack[] {
  const packs = new Map<string, Pack>()
  for (const { name, source } of entries) {
    const key = sourceKey(source)
    if (key === null || source.type === 'local') continue
    let pack = packs.get(key)
    if (!pack) {
      pack =
        source.type === 'github'
          ? {
              key,
              type: 'github',
              name: `${source.owner}/${source.repo}`,
              skills: [],
              folder: `${paths.repos}/${source.owner}/${source.repo}`
            }
          : {
              key,
              type: 'tessl',
              name: `${source.workspace}/${source.plugin}`,
              skills: [],
              folder: `${paths.tesslPlugins}/${source.workspace}/${source.plugin}`
            }
      packs.set(key, pack)
    }
    pack.skills.push(name)
  }
  return [...packs.values()]
    .filter((pack) => pack.skills.length >= 2)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/** The pack box for one agent: `all` counts the members that can deploy, so a missing member does not block it. */
export function packBox(
  members: { status: string; enabledFor: string[] }[],
  agentId: string
): { look: BoxLook; deployed: number; total: number; deployable: number } {
  const on = (m: { enabledFor: string[] }): boolean => m.enabledFor.includes(agentId)
  const deployed = members.filter(on).length
  const ok = members.filter((m) => m.status === 'ok')
  const deployable = ok.length
  const look: BoxLook =
    deployed === 0 ? 'none' : ok.filter(on).length === deployable ? 'all' : 'some'
  return { look, deployed, total: members.length, deployable }
}

export function boxClickOn(look: BoxLook): boolean {
  return look !== 'all'
}
