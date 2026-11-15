import type { LogEvent, Startup, State } from '../../core/ipc'
import { api } from './api'
import { shouldOpenBootCamp } from './bootcamp'
import { trimLog, type Filter } from './format'

export type Page =
  | { name: 'loadout' }
  | { name: 'intel' }
  | { name: 'recon' }
  | { name: 'log' }
  | { name: 'bootcamp' }
  | {
      name: 'skill'
      skill: string
      tab: 'briefing' | 'review' | 'fix' | 'diff' | 'history'
      /** The page the back link returns to. */
      from: 'loadout' | 'intel'
    }
export type { Filter }

export const app = $state<{
  state: State | null
  log: LogEvent[]
  notice: string | null
  rowResult: Record<string, string>
  page: Page
  search: string
  filter: Filter
  /** The key of the open pack on the LOADOUT page; never stored. */
  pack: string | null
  /** The clock for "checked <time ago>" texts; ticks every 30 s. */
  now: number
  /** The last completed check; BOOT CAMP shows it while a later one runs. */
  lastStartup: Startup | null
  /** The Recon page's notice after an UNDO; RESCAN or its X clears it. */
  undone: string | null
  /** The skill page hides the PLATOON panel; for this session only, never on the LOADOUT page. */
  platoonHidden: boolean
  /** The PLATOON panel slides; only a toggle animates it, never a page change. */
  platoonSliding: boolean
}>({
  state: null,
  log: [],
  notice: null,
  rowResult: {},
  page: { name: 'loadout' },
  search: '',
  filter: 'all',
  pack: null,
  now: Date.now(),
  lastStartup: null,
  undone: null,
  platoonHidden: false,
  platoonSliding: false
})

/** Hides or shows the PLATOON panel on the skill page, with the slide. */
export function togglePlatoon(): void {
  app.platoonSliding = true
  app.platoonHidden = !app.platoonHidden
}

setInterval(() => (app.now = Date.now()), 30_000)

/** The one Fix, one Publish, one Remove, one Fork and one Unpublish dialog, rendered in App, and the skill they act on. */
export const tesslDialogs = $state<{
  skill: string
  /** The key of the pack the Remove dialog acts on, or '' for a skill. */
  pack: string
  fix?: HTMLDialogElement
  publish?: HTMLDialogElement
  remove?: HTMLDialogElement
  fork?: HTMLDialogElement
  unpublish?: HTMLDialogElement
}>({ skill: '', pack: '' })

export function openTesslDialog(
  kind: 'fix' | 'publish' | 'remove' | 'fork' | 'unpublish',
  skill: string
): void {
  tesslDialogs.skill = skill
  tesslDialogs.pack = ''
  tesslDialogs[kind]?.showModal()
}

export function openPackRemove(key: string): void {
  tesslDialogs.pack = key
  tesslDialogs.remove?.showModal()
}

/** The one Recruit dialog, rendered in App: the preview of a Recon row, or the UNDO of a backup. */
export const recruitDialog = $state<{
  dialog?: HTMLDialogElement
  view: 'recruit' | 'undo'
  agentId: string
  entry: string
  /** The folder picked last in this session; kept in memory only. */
  parent: string | null
}>({ view: 'recruit', agentId: '', entry: '', parent: null })

export function openRecruit(view: 'recruit' | 'undo', agentId: string, entry: string): void {
  recruitDialog.view = view
  recruitDialog.agentId = agentId
  recruitDialog.entry = entry
  recruitDialog.dialog?.showModal()
}

/** The Briefing dialog's open request. `auto`: opened by the first-run rule, so its last button reports to BOOT CAMP. */
export const briefing = $state({ open: false, auto: false })

/** The dialog mounts after the first state, so the request is state it reads, not a `showModal()` call. */
export function openBriefing(auto: boolean): void {
  briefing.auto = auto
  briefing.open = true
}

/** True until the first state after launch; only that state can open BOOT CAMP and the Briefing. */
let firstState = true

function receive(next: State): void {
  // A `get-state` reply can land after a newer push; it must not replace it.
  if (app.state && next.seq < app.state.seq) return
  if (firstState) {
    firstState = false
    if (shouldOpenBootCamp(next.agents)) {
      app.page = { name: 'bootcamp' }
      openBriefing(true)
    }
  }
  if (!next.startup.mustering) app.lastStartup = next.startup
  app.state = next
}

api.on('state', receive)
/** The Log page keeps this many runs; older runs drop out. */
const MAX_LOG_RUNS = 200

api.on('log', (event) => {
  app.log.push(event)
  trimLog(app.log, MAX_LOG_RUNS)
})

export async function load(): Promise<void> {
  const result = await api.invoke('get-state')
  if (result.ok) {
    receive(result.state)
    app.notice = null
  } else app.notice = result.message
}

/** Shows a refusal or failure message under the page header. */
export function report(result: { ok: boolean; message?: string }): void {
  app.notice = result.ok ? null : (result.message ?? 'The action failed.')
}
