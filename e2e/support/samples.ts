import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseConfig, serializeConfig } from '../../src/core/config'
import { addSynced } from './synced'

function skill(folder: string, name: string | null, body = 'A sample skill.'): void {
  mkdirSync(folder, { recursive: true })
  const head = name === null ? [] : [`name: ${name}`]
  writeFileSync(
    join(folder, 'SKILL.md'),
    ['---', ...head, `description: ${body}`, '---', ''].join('\n')
  )
}

/**
 * The sample set of the recruit spec, in the fake home only: twelve entries in the Claude Code and
 * Codex folders, two link targets, `sample-in-library` also in the library, both agents enabled.
 */
export function addSamples(home: string): void {
  const claude = join(home, '.claude', 'skills')
  const codex = join(home, '.codex', 'skills')
  mkdirSync(codex, { recursive: true })

  for (const folder of [claude, codex]) skill(join(folder, 'sample-plain'), 'sample-plain')
  skill(join(claude, 'sample-differs'), 'sample-differs')
  skill(join(codex, 'sample-differs'), 'sample-differs', 'Another body.')
  skill(join(claude, 'sample-claude-only'), 'sample-claude-only')

  const linked = join(home, 'Code', 'my-skills', 'sample-linked')
  skill(linked, 'sample-linked')
  symlinkSync(linked, join(claude, 'sample-linked'))
  symlinkSync(join(home, 'missing', 'sample-dangling'), join(claude, 'sample-dangling'))
  skill(join(claude, 'soft-skill'), 'sample-misnamed')

  skill(join(claude, 'sample-in-library'), 'sample-in-library')
  const other = join(home, 'Code', 'other', 'sample-in-library')
  skill(other, 'sample-in-library')
  symlinkSync(other, join(home, '.loadout', 'skills', 'sample-in-library'))

  skill(join(codex, 'sample-git'), 'sample-git')
  mkdirSync(join(codex, 'sample-git', '.git'))
  writeFileSync(join(codex, 'sample-git', '.git', 'HEAD'), 'ref: refs/heads/main\n')
  skill(join(codex, 'sample-symlink'), 'sample-symlink')
  symlinkSync('SKILL.md', join(codex, 'sample-symlink', 'alias.md'))
  skill(join(codex, 'sample-noname'), null)
  const tessl = join(home, '.agents', 'skills', 'tessl__sample')
  skill(tessl, 'tessl-sample')
  symlinkSync(tessl, join(codex, 'tessl__sample'))

  writeFileSync(join(claude, 'notes.md'), '# Notes\n')
  addSynced(home, { 'synced-one': '---\nname: synced-one\ndescription: Synced.\n---\n' })

  const configPath = join(home, '.loadout', 'config.json')
  const config = parseConfig(readFileSync(configPath, 'utf8'), configPath)
  for (const agent of config.agents) agent.enabled = true
  writeFileSync(configPath, serializeConfig(config))
}
