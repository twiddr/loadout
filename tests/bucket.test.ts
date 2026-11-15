import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { readSynced } from '../src/core/bucket'
import { DEFAULT_CONFIG } from '../src/core/config'
import { pathsFrom } from '../src/core/paths'

const ORG = '00000000-0000-4000-8000-000000000001'
const ACC = '00000000-0000-4000-8000-000000000002'
const STALE = '00000000-0000-4000-8000-000000000009'
const IDS = JSON.stringify({ oauthAccount: { organizationUuid: ORG, accountUuid: ACC } })

let home: string
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'loadout-bucket-'))
})
afterEach(() => rm(home, { recursive: true, force: true }))

async function skill(bucket: string, name: string): Promise<void> {
  await mkdir(join(bucket, name), { recursive: true })
  await writeFile(join(bucket, name, 'SKILL.md'), '---\nname: x\n---\n')
}

async function seed(
  opts: { claudeJson?: string; settings?: string; live?: string[]; stale?: string[] } = {}
): Promise<void> {
  const paths = pathsFrom(home)
  await mkdir(join(home, '.claude'), { recursive: true })
  await writeFile(paths.claudeJson, opts.claudeJson ?? IDS)
  if (opts.settings !== undefined) await writeFile(paths.claudeSettings, opts.settings)
  for (const name of opts.live ?? []) await skill(join(paths.synced, `${ORG}_${ACC}`), name)
  for (const name of opts.stale ?? []) await skill(join(paths.synced, `${STALE}_${ACC}`), name)
}

const read = (): ReturnType<typeof readSynced> => readSynced(pathsFrom(home), DEFAULT_CONFIG.agents)
const live = (): string => join(pathsFrom(home).synced, `${ORG}_${ACC}`)

test('reads the live bucket, sorted, and ignores a stale bucket', async () => {
  await seed({ live: ['pdf', 'alpha'], stale: ['old'] })
  expect(await read()).toEqual({
    synced: { agentId: 'claude-code', skills: ['alpha', 'pdf'], syncOff: false, off: [] },
    bucket: live()
  })
})

test('skips folders without a SKILL.md file, hidden folders and symlinks', async () => {
  await seed({ live: ['pdf'] })
  await mkdir(join(live(), 'empty'))
  await skill(live(), '.hidden')
  await skill(join(home, 'elsewhere'), 'target')
  await symlink(join(home, 'elsewhere', 'target'), join(live(), 'linked'))
  await mkdir(join(live(), 'dirmd', 'SKILL.md'), { recursive: true })
  expect((await read())?.synced.skills).toEqual(['pdf'])
})

test.each([
  ['absent', null],
  ['with unknown skills', '{"skills":[{"name":"ghost"}]}'],
  ['not JSON', '{']
])('manifest.json %s changes nothing', async (_name, manifest) => {
  await seed({ live: ['pdf', 'alpha'], stale: ['old'] })
  if (manifest !== null) await writeFile(join(live(), 'manifest.json'), manifest)
  expect((await read())?.synced.skills).toEqual(['alpha', 'pdf'])
})

test('reads the sync switch and the skill overrides from settings.json', async () => {
  await seed({
    live: ['pdf'],
    settings: '{"syncClaudeAiSkills":false,"skillOverrides":{"anthropic-skills:pdf":"off"}}'
  })
  const synced = (await read())?.synced
  expect(synced?.syncOff).toBe(true)
  expect(synced?.off).toEqual(['pdf'])
})

test('returns null when the bucket cannot be named or read', async () => {
  const paths = pathsFrom(home)
  const elsewhere = DEFAULT_CONFIG.agents.map((a) => ({ ...a, folder: '~/elsewhere/skills' }))

  // no .claude.json
  expect(await read()).toBeNull()

  // logged out
  await seed({ claudeJson: '{"oauthAccount":null}', stale: ['old'] })
  expect(await read()).toBeNull()

  // live bucket absent, stale bucket present
  await seed({ stale: ['old'] })
  expect(await read()).toBeNull()

  // live bucket is a regular file
  await writeFile(live(), 'x')
  expect(await read()).toBeNull()
  await rm(live())

  // live bucket is a symlink to a folder with skills
  await skill(join(home, 'elsewhere'), 'pdf')
  await symlink(join(home, 'elsewhere'), live())
  expect(await read()).toBeNull()
  await rm(live())

  // no agent owns ~/.claude/skills
  await skill(live(), 'pdf')
  expect(await readSynced(paths, elsewhere)).toBeNull()
})

test('an empty live bucket gives no skills, not null', async () => {
  await seed()
  await mkdir(live(), { recursive: true })
  expect((await read())?.synced.skills).toEqual([])
})

test.each([
  ['no settings.json', undefined],
  ['settings.json that is not JSON', '{']
])('%s gives sync on and no overrides', async (_name, settings) => {
  await seed({ live: ['pdf'], settings })
  const synced = (await read())?.synced
  expect(synced?.syncOff).toBe(false)
  expect(synced?.off).toEqual([])
})
