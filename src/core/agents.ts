import { lstat, readdir, readlink, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { agentFolder, type Agent } from './config'
import type { Paths } from './paths'

export interface Unmanaged {
  agentId: string
  name: string
  kind: 'link' | 'folder' | 'file'
  /** Raw link target resolved to absolute; null for a folder or file. */
  target: string | null
  dangling: boolean
}

export interface AgentFolder {
  agentId: string
  folder: string
  folderExists: boolean
  /** Skill names whose link target is exactly paths.library/<name>. */
  managed: string[]
  unmanaged: Unmanaged[]
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code
}

export async function readAgentFolder(agent: Agent, paths: Paths): Promise<AgentFolder> {
  const folder = agentFolder(agent, paths)
  const result: AgentFolder = {
    agentId: agent.id,
    folder,
    folderExists: true,
    managed: [],
    unmanaged: []
  }

  let names: string[]
  try {
    names = (await readdir(folder)).filter((name) => !name.startsWith('.'))
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { ...result, folderExists: false }
    throw error
  }
  // A relative link resolves against the folder's real path, as the system does when the folder is itself a link.
  const base = await realpath(folder)

  for (const name of names.sort()) {
    const path = join(folder, name)
    const info = await lstat(path)
    if (!info.isSymbolicLink()) {
      result.unmanaged.push({
        agentId: agent.id,
        name,
        kind: info.isDirectory() ? 'folder' : 'file',
        target: null,
        dangling: false
      })
      continue
    }
    const raw = await readlink(path)
    const target = isAbsolute(raw) ? raw : resolve(base, raw)
    if (target === join(paths.library, name)) {
      result.managed.push(name)
      continue
    }
    // Any stat error (ENOENT, a link loop's ELOOP, EACCES) means the link leads nowhere usable.
    const dangling = await stat(path).then(
      () => false,
      () => true
    )
    result.unmanaged.push({ agentId: agent.id, name, kind: 'link', target, dangling })
  }
  return result
}
