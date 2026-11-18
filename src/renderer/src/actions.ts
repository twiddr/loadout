import type { Agent, LoadoutView } from '../../core/config'
import type { Bump, Entry, Forked, Result } from '../../core/ipc'
import type { Pack } from '../../core/packs'
import { api } from './api'
import { addedText, packRemoveText, packToggleText, publishedText, type Remote } from './format'
import { app, openTesslDialog, report, setRow } from './state.svelte'

function sameSource(a: Entry['source'], b: Remote): boolean {
  return b.type === 'github'
    ? a.type === 'github' && a.owner === b.owner && a.repo === b.repo
    : a.type === 'tessl' && a.workspace === b.workspace && a.plugin === b.plugin
}

export async function toggle(skill: string, agentId: string, box: HTMLInputElement): Promise<void> {
  const on = box.checked
  try {
    const result = await api.invoke('toggle', { skill, agentId, on })
    report(result)
    if (!result.ok) box.checked = !on
  } catch (error) {
    box.checked = !on
    app.notice = error instanceof Error ? error.message : String(error)
  }
}

/** `SKILLS` always means every skill as its own card, so it also closes an open pack. */
export async function setView(view: LoadoutView): Promise<void> {
  if (view === 'skills') app.pack = null
  // Only the inactive half changes the stored view.
  if (app.state?.loadoutView === view) return
  const result = await api.invoke('set-loadout-view', { view })
  if (!result.ok) report(result)
}

export function openPack(key: string): void {
  app.pack = key
  app.filter = 'all'
}

/** The pack card resets its box from the state afterwards; main pushes the state before it replies. */
export async function togglePack(pack: Pack, agent: Agent, on: boolean): Promise<void> {
  try {
    const result = await api.invoke('toggle-pack', { pack: pack.key, agentId: agent.id, on })
    if (result.ok) app.notice = packToggleText(result, on, agent.label)
    else report(result)
  } catch (error) {
    app.notice = error instanceof Error ? error.message : String(error)
  }
}

export async function addFolder(): Promise<void> {
  const result = await api.invoke('add-local')
  if (!result.ok) return report(result)
  app.notice = null
  if ('name' in result) {
    setRow(result.name, addedText(result.lint))
  }
}

/** Opens the Remove dialog; its Remove button runs `confirmRemove`. */
export function remove(entry: Entry): void {
  openTesslDialog('remove', entry.name)
}

export async function confirmRemovePack(pack: Pack): Promise<void> {
  const result = await api.invoke('remove-pack', { pack: pack.key })
  if (!result.ok) return report(result)
  const text = [packRemoveText(result, pack.name), result.clone].filter((t) => t !== null)
  app.notice = text.length > 0 ? text.join(' ') : null
}

export async function confirmRemove(entry: Entry): Promise<void> {
  const result = await api.invoke('remove', { skill: entry.name })
  report(result)
  if (result.ok && result.clone !== null) app.notice = result.clone
}

export async function relocate(entry: Entry): Promise<void> {
  report(await api.invoke('relocate', { skill: entry.name }))
}

export async function update(entry: Entry, entries: Entry[]): Promise<void> {
  const result = await api.invoke('update', { skill: entry.name })
  report(result)
  if (result.ok) {
    for (const name of result.updated) setRow(name, 'updated')
    return
  }
  const source = entry.source
  if (source.type === 'local') return
  for (const e of entries) if (sameSource(e.source, source)) delete app.rowResult[e.name]
}

export async function check(entry: Entry): Promise<void> {
  setRow(entry.name, 'checking…')
  const result = await api.invoke('check', { skill: entry.name })
  report(result)
  if (result.ok && result.check.state === 'up-to-date') setRow(entry.name, 'up to date')
  else delete app.rowResult[entry.name]
}

export async function checkRegistry(entry: Entry): Promise<void> {
  setRow(entry.name, 'checking…')
  // The side card and the strips show the result from the next state; the notice is for refusals.
  report(await api.invoke('check-registry', { skill: entry.name }))
  delete app.rowResult[entry.name]
}

export async function checkAll(): Promise<void> {
  report(await api.invoke('check-all'))
}

export async function updateAll(): Promise<void> {
  const result = await api.invoke('update-all')
  report(result)
  if (!result.ok) return
  for (const name of result.updated) setRow(name, 'updated')
  const n = result.failed.length
  if (n > 0) {
    app.notice = `Update all: ${n} ${n === 1 ? 'source' : 'sources'} failed (${result.failed.join(', ')}); see the log.`
  }
}

export function updateLabel(source: Remote, entries: Entry[]): string {
  const n = entries.filter((e) => sameSource(e.source, source)).length
  const name =
    source.type === 'github'
      ? `${source.owner}/${source.repo}`
      : `${source.workspace}/${source.plugin}`
  return `Update ${name} (${n} ${n === 1 ? 'skill' : 'skills'})`
}

export async function review(entry: Entry): Promise<void> {
  setRow(entry.name, 'reviewing…')
  const result = await api.invoke('review', { skill: entry.name })
  report(result)
  // The score comes from the saved review in the next state push; output Loadout cannot read is not saved.
  if (result.ok && !result.saved) setRow(entry.name, 'review done, see the log')
  else delete app.rowResult[entry.name]
}

export async function runFix(entry: Entry): Promise<void> {
  setRow(entry.name, 'fixing…')
  const result = await api.invoke('fix', { skill: entry.name })
  report(result)
  // A fix that changed something shows as FIXED from the next state push; that links to the FIX tab.
  if (result.ok && !result.changed) setRow(entry.name, 'no changes')
  else delete app.rowResult[entry.name]
}

export async function undoFix(entry: Entry): Promise<void> {
  report(await api.invoke('fix-undo', { skill: entry.name }))
}

export async function keepFix(entry: Entry): Promise<void> {
  const result = await api.invoke('fix-keep', { skill: entry.name })
  report(result)
  // Fix output holds no review, so the kept folder gets a fresh one for the REVIEW tab.
  if (result.ok) await review(entry)
}

export async function publish(
  entry: Entry,
  bump: Bump,
  workspace: string,
  commit: boolean
): Promise<void> {
  setRow(entry.name, 'publishing…')
  const result = await api.invoke('publish', { skill: entry.name, bump, workspace, commit })
  report(result)
  if (!result.ok) delete app.rowResult[entry.name]
  else setRow(entry.name, publishedText(result.manifest, result.version))
}

export async function unpublish(entry: Entry): Promise<void> {
  setRow(entry.name, 'unpublishing…')
  const result = await api.invoke('unpublish', { skill: entry.name })
  report(result)
  if (!result.ok) delete app.rowResult[entry.name]
  else {
    const note = result.manifestDeleted ? '' : '; manifest not deleted (see Log)'
    setRow(entry.name, `unpublished ${result.removed.join(', ')}${note}`)
  }
}

/** The Fork dialog shows the result: a refusal in its form, a success in its result view. */
export function fork(entry: Entry, name: string): Promise<Result<{ cancelled: true } | Forked>> {
  return api.invoke('fork', { skill: entry.name, name })
}

export async function reveal(entry: Entry, root?: boolean): Promise<void> {
  report(await api.invoke('reveal', { skill: entry.name, root }))
}

export async function revealBackup(agentId: string, entry: string): Promise<void> {
  report(await api.invoke('reveal-backup', { agentId, entry }))
}
