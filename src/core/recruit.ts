import { join } from 'node:path'
import type { AgentFolder, Unmanaged } from './agents'
import { agentFolder, type Agent } from './config'
import type { LibraryEntry } from './library'
import { displayPath, type Paths } from './paths'
import { NAME_PATTERN } from './validate'

export type Mode = 'copy' | 'in-place' | 'library'

export type RecruitStatus =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  | { kind: 'recruit'; mode: Mode; name: string }
  | { kind: 'backup' }

/** What main read about one unmanaged entry; every path absolute. */
export interface EntryFacts {
  agentId: string
  /** The name in the agent folder. */
  entry: string
  /** `<agent folder>/<entry>`. */
  path: string
  kind: 'link' | 'folder' | 'file'
  /** A link's absolute target, not followed further. */
  target: string | null
  dangling: boolean
  /** `<path>/SKILL.md` is readable, through a link. */
  hasSkillMd: boolean
  /** The frontmatter name of that SKILL.md. `Unmanaged.name` is the entry name, never this. */
  skillName: string | null
}

/** An original Loadout moved to `backups/<agentId>/<entry>`. */
export interface Backup {
  agentId: string
  entry: string
  kind: 'folder' | 'link'
}

export interface Preview {
  mode: Mode | 'backup'
  facts: { found: string; skill: string | null; size: string | null; inLoadout: string | null } // the dialog's value texts
  notes: string[]
  needsFolder: boolean
  steps: string[] // describeStep per step; [] while a folder is needed
  /** The difference lines past the 20 in the notes: not shown, but sent back with `shown`, so a change there is seen. */
  more: string[]
}

export interface Recruited {
  name: string | null
  files: number | null
  backup: string
  chain: string | null
}

export type UnmanagedRow = Unmanaged & { recruit: RecruitStatus }

const text = (value: string): RecruitStatus => ({ kind: 'text', text: value })

function isUnder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`)
}

/** The row text for a link into ~/.loadout; step 0 also gives it for a link that only resolves there. */
export const LOADOUT_LINK =
  'A link into ~/.loadout, where Loadout keeps its own files. Loadout leaves it alone.'

/** The row of the spec table "What each kind of entry gets": the first match wins. */
export function rowStatus(
  facts: EntryFacts,
  agents: Agent[],
  libraryNames: string[],
  paths: Paths
): RecruitStatus {
  const shown = (path: string): string => displayPath(path, paths.home)

  if (facts.entry === 'synced' && facts.kind === 'folder' && facts.path === paths.synced) {
    return { kind: 'none' }
  }
  if (facts.kind === 'file') return { kind: 'none' }

  const agent = agents.find((a) => a.id === facts.agentId)
  if (!agent?.enabled) return text(`Enlist ${agent?.label ?? facts.agentId} to recruit this.`)

  if (facts.dangling) return { kind: 'backup' }

  const target = facts.kind === 'link' ? facts.target : null
  if (target !== null) {
    if (isUnder(target, paths.tesslPlugins)) {
      return text(
        `A link into ${shown(paths.tesslPlugins)}, which Tessl manages. Loadout leaves it alone. To get this skill, use Recruit skill › Registry.`
      )
    }
    const other = [
      paths.agentsSkills,
      `${paths.home}/.claude/plugins`,
      `${paths.home}/.codex/plugins`
    ].find((folder) => isUnder(target, folder))
    if (other) {
      return text(
        `A link into ${shown(other)}, which another tool manages. Loadout leaves it alone.`
      )
    }
    if (isUnder(target, paths.loadout)) return text(LOADOUT_LINK)
  }

  if (!facts.hasSkillMd) return text(`No SKILL.md in ${shown(target ?? facts.path)}.`)

  const name = facts.skillName
  if (name === null) {
    return text(
      `SKILL.md in ${shown(target ?? facts.path)} has no "name" in its frontmatter. Add the name line, then press Rescan.`
    )
  }
  if (!NAME_PATTERN.test(name)) {
    return text(
      `Skill name "${name}" must be lowercase letters, digits and single hyphens. Change the name line, then press Rescan.`
    )
  }
  if (name === 'synced') return text('The name "synced" is reserved by Claude Code.')

  if (libraryNames.includes(name)) return { kind: 'recruit', mode: 'library', name }

  if (target !== null) {
    if (agents.some((a) => isUnder(target, agentFolder(a, paths)))) {
      return text(`This link points at ${shown(target)}. Recruit that one first.`)
    }
    return { kind: 'recruit', mode: 'in-place', name }
  }
  return { kind: 'recruit', mode: 'copy', name }
}

export type Step =
  | { op: 'copy'; from: string; to: string }
  | { op: 'verify'; a: string; b: string }
  | { op: 'add'; name: string; target: string }
  | { op: 'move'; from: string; to: string; back?: true }
  | { op: 'link'; path: string; name: string; label: string }
  | { op: 'unlink'; path: string; target: string }

export type RecruitPlan =
  { ok: true; mode: Mode | 'backup'; steps: Step[] } | { ok: false; message: string }

export function describeStep(step: Step, home: string): string {
  const shown = (path: string): string => displayPath(path, home)
  switch (step.op) {
    case 'copy':
      return `Copy ${shown(step.from)} to ${shown(step.to)}.`
    case 'verify':
      return 'Check that the copy is identical to your original.'
    case 'add':
      return `Add ${step.name} to your loadout, linked to ${shown(step.target)}.`
    case 'move':
      return step.back
        ? `Move your original from ${shown(step.from)} back to ${shown(step.to)}.`
        : `Move your original from ${shown(step.from)} to ${shown(step.to)}. It stays there, unchanged.`
    case 'link':
      return `Link ${shown(step.path)} to your loadout's ${step.name}, so ${step.label} keeps loading the skill.`
    case 'unlink':
      return `Remove Loadout's link ${shown(step.path)}.`
  }
}

export function backupPath(agentId: string, entry: string, paths: Paths): string {
  return join(paths.backups, agentId, entry)
}

export function planRecruit(input: {
  facts: EntryFacts
  status: RecruitStatus
  agent: Agent
  /** The picked folder; null before the user picked one (mode copy then gives steps []). */
  parent: string | null
  library: LibraryEntry[]
  folder: AgentFolder
  agents: Agent[]
  /** `stat().dev` of the resolved agent folder and of paths.loadout, read by main. */
  devices: { agent: number; loadout: number }
  paths: Paths
}): RecruitPlan {
  const { facts, status, agent, parent, library, folder, agents, devices, paths } = input
  const shown = (path: string): string => displayPath(path, paths.home)
  const refuse = (message: string): RecruitPlan => ({ ok: false, message })

  if (status.kind === 'text') return refuse(status.text)
  if (status.kind === 'none') return refuse(`${shown(facts.path)} cannot be recruited.`)

  const mode = status.kind === 'backup' ? 'backup' : status.mode
  const name = status.kind === 'recruit' ? status.name : facts.entry

  if (mode === 'copy' && parent !== null) {
    const inside = [...agents.map((a) => agentFolder(a, paths)), paths.loadout]
    if (inside.some((root) => isUnder(parent, root))) {
      return refuse('Pick a folder outside the agent folders and ~/.loadout.')
    }
  }

  if (mode !== 'backup' && name !== facts.entry && folder.unmanaged.some((u) => u.name === name)) {
    return refuse(
      `${shown(join(folder.folder, name))} already exists and Loadout did not create it. Recruit it first, or remove it by hand.`
    )
  }

  if (devices.agent !== devices.loadout) {
    return refuse(
      `${shown(folder.folder)} and ~/.loadout are on different disks, so Loadout cannot move ${facts.entry} without copying it. Nothing changed.`
    )
  }

  if (mode === 'library') {
    const entry = library.find((e) => e.name === name)
    if (entry && entry.status !== 'ok') {
      return refuse(`"${name}" in your loadout has no source folder. Remove or relocate it first.`)
    }
  }

  const move: Step = {
    op: 'move',
    from: facts.path,
    to: backupPath(agent.id, facts.entry, paths)
  }
  if (mode === 'backup') return { ok: true, mode, steps: [move] }

  const link: Step[] =
    facts.entry !== name && folder.managed.includes(name)
      ? []
      : [{ op: 'link', path: join(folder.folder, name), name, label: agent.label }]

  if (mode === 'library') return { ok: true, mode, steps: [move, ...link] }
  if (mode === 'in-place') {
    const add: Step = { op: 'add', name, target: facts.target ?? facts.path }
    return { ok: true, mode, steps: [add, move, ...link] }
  }
  if (parent === null) return { ok: true, mode, steps: [] }
  const to = join(parent, name)
  return {
    ok: true,
    mode,
    steps: [
      { op: 'copy', from: facts.path, to },
      { op: 'verify', a: facts.path, b: to },
      { op: 'add', name, target: to },
      move,
      ...link
    ]
  }
}

export function planUndo(input: {
  agent: Agent
  entry: string
  /** The skill name read from the backup's SKILL.md; null for a dangling link or no name. */
  name: string | null
  /** The raw `readAgentFolder` result, not the snapshot's: the snapshot lists Loadout's own link as unmanaged when its library entry is gone, and UNDO must still remove that link. */
  folder: AgentFolder
  paths: Paths
}): RecruitPlan {
  const { agent, entry, name, folder, paths } = input
  const path = join(folder.folder, entry)
  const steps: Step[] = []
  if (name !== null && folder.managed.includes(name)) {
    steps.push({
      op: 'unlink',
      path: join(folder.folder, name),
      target: join(paths.library, name)
    })
  }
  // Taken after the plan's own unlink: anything Loadout did not make, or a Loadout link the unlink does not remove.
  const occupied =
    folder.unmanaged.some((u) => u.name === entry) ||
    (folder.managed.includes(entry) && name !== entry)
  if (occupied) {
    return {
      ok: false,
      message: `${displayPath(path, paths.home)} is in use, so Loadout cannot put your original back there. Move it away, then press Undo again.`
    }
  }
  steps.push({ op: 'move', from: backupPath(agent.id, entry, paths), to: path, back: true })
  return { ok: true, mode: 'backup', steps }
}

/** Sorted, SKILL.md first: `<rel> differs`, `<rel> is only in <a>`, `<rel> is only in <b>`. */
export function differenceLines(
  d: { differ: string[]; onlyA: string[]; onlyB: string[] },
  a: string,
  b: string
): string[] {
  const rows = [
    ...d.differ.map((rel) => ({ rel, line: `${rel} differs` })),
    ...d.onlyA.map((rel) => ({ rel, line: `${rel} is only in ${a}` })),
    ...d.onlyB.map((rel) => ({ rel, line: `${rel} is only in ${b}` }))
  ]
  const rank = (rel: string): number => (rel === 'SKILL.md' ? 0 : 1)
  rows.sort((x, y) => rank(x.rel) - rank(y.rel) || (x.rel < y.rel ? -1 : x.rel > y.rel ? 1 : 0))
  return rows.map((r) => r.line)
}
