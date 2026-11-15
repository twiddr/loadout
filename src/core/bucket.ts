import { lstat, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { agentFolder, type Agent } from './config'
import type { Paths } from './paths'
import { bucketName, parseClaudeSettings, type Synced } from './synced'

/**
 * Reads the claude.ai synced skills of the live bucket, read only. Never throws and never logs.
 * `bucket` is the absolute path of the live bucket; main keeps it and never sends it to the renderer.
 */
export async function readSynced(
  paths: Paths,
  agents: Agent[]
): Promise<{ synced: Synced; bucket: string } | null> {
  try {
    const agent = agents.find((a) => agentFolder(a, paths) === dirname(paths.synced))
    if (!agent) return null
    const name = bucketName(await readFile(paths.claudeJson, 'utf8'))
    if (!name) return null
    const bucket = join(paths.synced, name)
    if (!(await lstat(bucket)).isDirectory()) return null
    const skills: string[] = []
    for (const entry of await readdir(bucket, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const file = await lstat(join(bucket, entry.name, 'SKILL.md')).catch(() => null)
      if (file?.isFile()) skills.push(entry.name)
    }
    const settings = await readFile(paths.claudeSettings, 'utf8').catch(() => '')
    return {
      synced: { agentId: agent.id, skills: skills.sort(), ...parseClaudeSettings(settings) },
      bucket
    }
  } catch {
    return null
  }
}
