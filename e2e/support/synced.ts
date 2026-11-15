import { _electron, type ElectronApplication } from '@playwright/test'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')

/** Placeholder ids: never the account ids of a real ~/.claude.json. */
export const ORG = '00000000-0000-4000-8000-000000000001'
export const ACCOUNT = '00000000-0000-4000-8000-000000000002'
export const STALE_ORG = '00000000-0000-4000-8000-000000000009'

function skillFile(folder: string, text: string): void {
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'SKILL.md'), text)
}

/** Writes ~/.claude.json with the placeholder ids, the live bucket with one folder per key (the value is the SKILL.md text), and a stale bucket with the skill `stale-only`. Returns the live bucket path. */
export function addSynced(home: string, skills: Record<string, string>): string {
  writeFileSync(
    join(home, '.claude.json'),
    JSON.stringify({ oauthAccount: { organizationUuid: ORG, accountUuid: ACCOUNT } })
  )
  const synced = join(home, '.claude', 'skills', 'synced')
  const live = join(synced, `${ORG}_${ACCOUNT}`)
  mkdirSync(live, { recursive: true })
  for (const [name, text] of Object.entries(skills)) skillFile(join(live, name), text)
  skillFile(join(synced, `${STALE_ORG}_${ACCOUNT}`, 'stale-only'), '---\nname: stale-only\n---\n')
  return live
}

/** Writes ~/.claude/settings.json in the fake home. */
export function writeClaudeSettings(home: string, value: unknown): void {
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(value, null, 2))
}

/** Adds a Folder skill to the library of the fake home: ~/Code/Skills/<name>/SKILL.md and the library link; not linked into an agent folder. */
export function addLibrarySkill(home: string, name: string): void {
  const source = join(home, 'Code', 'Skills', name)
  skillFile(source, `---\nname: ${name}\ndescription: A library skill.\n---\n`)
  symlinkSync(source, join(home, '.loadout', 'skills', name))
}

/** Launches the built app on the fake home with --user-data-dir inside it. */
export function launch(home: string, env: Record<string, string>): Promise<ElectronApplication> {
  return _electron.launch({
    args: [`--user-data-dir=${join(home, 'electron-data')}`, join(ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, ...env } as Record<string, string>
  })
}
