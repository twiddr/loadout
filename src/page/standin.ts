// The stand-in for the main process in the download page's app (ADR 20261119-page-web-build).
// It answers from memory: no network request, no storage, no file, no child process.
import type {
  CandidateDetail,
  INVOKE_CHANNELS,
  LoadoutApi,
  Result,
  SkillDetail,
  State,
  Workspace
} from '../core/ipc'
import type { ToggleRequest } from '../core/planner'

/** What `scripts/landing-shots/shoot.ts` dumps from the real app into `sample.json`. */
export interface Sample {
  /** When the dump was taken; the times in the sample move from here to the page's clock. */
  takenAt: number
  state: State
  /** Keyed by skill name. */
  details: Record<string, Result<{ detail: SkillDetail }>>
  /** Keyed by `<agentId>/<entry>`. */
  candidates: Record<string, Result<{ detail: CandidateDetail }>>
  workspaces: Result<{ workspaces: Workspace[] }>
}

/** The answer to every action that needs the installed app. */
export const REFUSAL = 'Sample skills only. Install Loadout to do this.'

type Channel = (typeof INVOKE_CHANNELS)[number]
/** Null: the channel needs the installed app. */
type Handlers = Record<Channel, ((payload: never) => unknown) | null>

const refuse = (message: string): Result => ({ ok: false, message })

/** Adds `by` to every review and fix time below `value`, in place. */
function shiftTimes(value: unknown, by: number): void {
  if (value === null || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  for (const [key, inner] of Object.entries(record)) {
    if ((key === 'reviewedAt' || key === 'fixedAt') && typeof inner === 'number') {
      record[key] = inner + by
    } else shiftTimes(inner, by)
  }
}

export function createStandIn(sample: Sample, now: number = Date.now()): LoadoutApi {
  const { state, details, candidates, workspaces } = structuredClone(sample)
  shiftTimes(state, now - sample.takenAt)
  shiftTimes(details, now - sample.takenAt)
  const listeners = new Set<(state: State) => void>()

  function push(): void {
    state.seq += 1
    for (const listener of listeners) listener(structuredClone(state))
  }

  /** Why a switch for `agentId` is refused, in the app's own words; null when it can change. */
  function agentRefusal(agentId: string): string | null {
    return state.agents.some((a) => a.id === agentId) ? null : `Unknown agent "${agentId}".`
  }

  /** Sets one switch; true when it changed. `enabledFor` keeps the order of the agents. */
  function set(skill: string, agentId: string, on: boolean): boolean {
    const entry = state.entries.find((e) => e.name === skill)
    if (!entry || entry.enabledFor.includes(agentId) === on) return false
    entry.enabledFor = state.agents
      .map((a) => a.id)
      .filter((id) => (id === agentId ? on : entry.enabledFor.includes(id)))
    return true
  }

  const handlers: Handlers = {
    'get-state': () => ({ ok: true, state }),
    toggle: ({ skill, agentId, on }: ToggleRequest) => {
      const refused = agentRefusal(agentId)
      if (refused !== null) return refuse(refused)
      if (!state.entries.some((e) => e.name === skill)) {
        return refuse(`"${skill}" is not in your loadout.`)
      }
      set(skill, agentId, on)
      push()
      return { ok: true }
    },
    'toggle-pack': ({ pack, agentId, on }: { pack: string; agentId: string; on: boolean }) => {
      const refused = agentRefusal(agentId)
      if (refused !== null) return refuse(refused)
      const found = state.packs.find((p) => p.key === pack)
      if (!found) return refuse(REFUSAL)
      const changed: string[] = []
      const already: string[] = []
      for (const skill of found.skills) (set(skill, agentId, on) ? changed : already).push(skill)
      push()
      return { ok: true, changed, already, refused: [] }
    },
    'set-loadout-view': ({ view }: { view: State['loadoutView'] }) => {
      state.loadoutView = view
      push()
      return { ok: true }
    },
    'skill-detail': ({ skill }: { skill: string }) =>
      Object.hasOwn(details, skill) ? details[skill] : refuse(REFUSAL),
    'candidate-detail': ({ agentId, entry }: { agentId: string; entry: string }) =>
      Object.hasOwn(candidates, `${agentId}/${entry}`)
        ? candidates[`${agentId}/${entry}`]
        : refuse(REFUSAL),
    'list-workspaces': () => workspaces,
    refresh: null,
    'set-agent-enabled': null,
    'set-workspaces': null,
    'list-plugins': null,
    'set-appearance': null,
    'remove-pack': null,
    'copy-text': null,
    'open-terminal': null,
    'reveal-folder': null,
    'git-work-tree': null,
    'add-local': null,
    'scan-github': null,
    'add-candidates': null,
    update: null,
    'scan-tessl': null,
    review: null,
    fix: null,
    'fix-undo': null,
    'fix-keep': null,
    publish: null,
    unpublish: null,
    remove: null,
    relocate: null,
    fork: null,
    reveal: null,
    'recruit-preview': null,
    'choose-folder': null,
    recruit: null,
    'undo-preview': null,
    'recruit-undo': null,
    'reveal-backup': null,
    check: null,
    'check-all': null,
    'check-registry': null,
    'update-all': null,
    'skill-diff': null,
    cancel: null,
    'update-download': null,
    'update-cancel': null,
    'update-restart': null
  }

  const api = {
    // A channel outside the table gets the refusal too, so the page never waits for an answer.
    async invoke(channel: string, payload?: unknown): Promise<unknown> {
      const handler = Object.hasOwn(handlers, channel) ? handlers[channel as Channel] : null
      const answer = handler ? (handler as (payload: unknown) => unknown)(payload) : refuse(REFUSAL)
      return structuredClone(answer)
    },
    // Only `state` is ever sent: nothing runs, so there is no log, and no update or back gesture.
    on(channel: string, handler: (state: State) => void): () => void {
      if (channel !== 'state') return () => {}
      listeners.add(handler)
      return () => listeners.delete(handler)
    }
  }
  return api as LoadoutApi
}
