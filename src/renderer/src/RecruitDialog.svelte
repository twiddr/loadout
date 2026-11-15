<script lang="ts">
  import { displayPath } from '../../core/paths'
  import type { Agent } from '../../core/config'
  import type { Backup, Preview, Recruited, UnmanagedRow } from '../../core/recruit'
  import { revealBackup } from './actions'
  import { api } from './api'
  import { plural } from './format'
  import { app, recruitDialog } from './state.svelte'

  let {
    dialog = $bindable(),
    row,
    backup,
    agents,
    home,
    busy
  }: {
    dialog?: HTMLDialogElement
    /** The Recon row of the recruit view; null once it left the state. */
    row: UnmanagedRow | null
    /** The backup of the undo view; null once it left the state. */
    backup: Backup | null
    agents: Agent[]
    home: string
    busy: boolean
  } = $props()

  /** A preview or the UNDO steps; null while they load. */
  let preview = $state.raw<Preview | null>(null)
  let steps = $state.raw<string[] | null>(null)
  /** The UNDO backup is a link that leads nowhere: Loadout has no copy of its skill. */
  let backupDangling = $state(false)
  /** A refused preview, or a failed run (then `failed` is true). */
  let message = $state<string | null>(null)
  let failed = $state(false)
  let running = $state(false)
  let result = $state.raw<Recruited | null>(null)

  const agent = $derived(agents.find((a) => a.id === recruitDialog.agentId))
  const label = $derived(agent?.label ?? recruitDialog.agentId)
  const path = $derived(
    agent ? `${displayPath(agent.folder, home)}/${recruitDialog.entry}` : recruitDialog.entry
  )
  const dangling = $derived(row?.recruit.kind === 'backup' || preview?.mode === 'backup')
  const title = $derived(
    recruitDialog.view === 'undo' ? 'UNDO' : dangling ? 'MOVE TO BACKUP' : 'RECRUIT'
  )
  const copyMode = $derived(
    preview
      ? preview.mode === 'copy'
      : row?.recruit.kind === 'recruit' && row.recruit.mode === 'copy'
  )
  const skill = $derived(
    preview?.facts.skill ?? (row?.recruit.kind === 'recruit' ? row.recruit.name : '')
  )
  /** The folder line stays on a refused copy preview, so another folder can be picked. */
  const showFolder = $derived(
    !failed && copyMode && (preview !== null || (message !== null && recruitDialog.parent !== null))
  )

  // Its row or backup left the state (recruited elsewhere, a rescan): close, unless an outcome is shown.
  $effect(() => {
    const gone = recruitDialog.view === 'recruit' ? row === null : backup === null
    if (gone && !running && !failed && result === null) dialog?.close()
  })

  /** Raised by each open `toggle`: a late answer from an earlier open of the same row is stale. */
  let opens = 0

  /** A rejected invoke goes to the page notice and closes the dialog, as in the Fork dialog. */
  function rejected(error: unknown): void {
    app.notice = error instanceof Error ? error.message : String(error)
    dialog?.close()
  }

  async function load(): Promise<void> {
    const { agentId, entry } = recruitDialog
    const open = opens
    // True once the dialog closed, opened again or moved to another entry: a late answer then belongs to an older dialog.
    const stale = (): boolean =>
      !dialog?.open ||
      opens !== open ||
      recruitDialog.agentId !== agentId ||
      recruitDialog.entry !== entry
    try {
      await read(stale)
    } catch (error) {
      if (!stale()) rejected(error)
    }
  }

  async function read(stale: () => boolean): Promise<void> {
    const { view, agentId, entry, parent } = recruitDialog
    if (view === 'undo') {
      const loaded = await api.invoke('undo-preview', { agentId, entry })
      if (stale()) return
      if (loaded.ok) {
        steps = loaded.steps
        backupDangling = loaded.dangling
      } else message = loaded.message
      return
    }
    const loaded = await api.invoke('recruit-preview', {
      agentId,
      entry,
      parent: parent ?? undefined
    })
    if (stale()) return
    if (loaded.ok) preview = loaded
    else message = loaded.message
  }

  async function choose(): Promise<void> {
    let chosen
    try {
      chosen = await api.invoke('choose-folder')
    } catch (error) {
      return rejected(error)
    }
    if (!chosen.ok || chosen.folder === null) return
    recruitDialog.parent = chosen.folder
    preview = null
    message = null
    await load()
  }

  async function recruit(): Promise<void> {
    if (!preview) return
    const { agentId, entry, parent } = recruitDialog
    running = true
    try {
      const outcome = await api.invoke('recruit', {
        agentId,
        entry,
        parent: parent ?? undefined,
        shown: [...preview.notes, ...preview.steps, ...preview.more]
      })
      if (outcome.ok) result = outcome
      else {
        message = outcome.message
        failed = true
      }
    } catch (error) {
      rejected(error)
    } finally {
      running = false
    }
  }

  async function undo(): Promise<void> {
    const { agentId, entry } = recruitDialog
    running = true
    try {
      const outcome = await api.invoke('recruit-undo', { agentId, entry })
      if (outcome.ok) {
        app.notice = null
        app.undone =
          `Your original is back in ${outcome.path}.` +
          (outcome.off === null ? '' : ` "${outcome.off}" stays in your loadout, off for ${label}.`)
        dialog?.close()
      } else {
        message = outcome.message
        failed = true
      }
    } catch (error) {
      rejected(error)
    } finally {
      running = false
    }
  }
</script>

<dialog
  class="cover recruit"
  bind:this={dialog}
  oncancel={(e) => {
    // Escape must not close the dialog while a command runs: its outcome would land in a closed dialog.
    if (running) e.preventDefault()
  }}
  ontoggle={(e) => {
    // Clear on close, not on open: `toggle` fires late after `showModal()`. Nothing can be picked
    // before the preview arrives, so the open toggle only starts the read.
    if (e.newState === 'open') {
      opens += 1
      void load()
    } else {
      preview = null
      steps = null
      message = null
      failed = false
      result = null
    }
  }}
>
  <div class="dialog-drag"></div>
  <div class="dialog-box">
    <span class="eyebrow">{label.toUpperCase()} · {recruitDialog.entry}</span>
    <h2 class="title">{title}</h2>
    {#if result}
      <p>
        {dangling
          ? `Moved ${recruitDialog.entry} to the backup.`
          : `Recruited ${result.name} for ${label}.`}
      </p>
      {#if result.files !== null}
        <p>Verified: {result.files} {plural(result.files, 'file', 'files')}, identical.</p>
      {/if}
      <p>Nothing was deleted. Your original is in {result.backup}.</p>
      {#if result.chain !== null}
        <p class="recruit-chain">{result.chain}</p>
      {/if}
      <div class="actions">
        <button onclick={() => revealBackup(recruitDialog.agentId, recruitDialog.entry)}
          >Reveal backup</button
        >
        <button class="primary" onclick={() => dialog?.close()}>Done</button>
      </div>
    {:else if recruitDialog.view === 'undo'}
      {#if message}
        <p class="notice" role="alert">{message}</p>
        <div class="actions">
          <button onclick={() => dialog?.close()}>Close</button>
        </div>
      {:else}
        {#if steps}
          <div class="recruit-steps">
            <span class="label">LOADOUT WILL</span>
            <ol>
              {#each steps as step, i (i)}<li>{step}</li>{/each}
            </ol>
          </div>
          {#if !backupDangling}
            <p>
              Loadout's copy of the skill and its place in your loadout stay. Decommission the skill
              if you do not want it.
            </p>
          {/if}
        {/if}
        <div class="actions">
          <button disabled={running} onclick={() => dialog?.close()}>Cancel</button>
          <button class="primary" disabled={steps === null || busy || running} onclick={undo}
            >Undo</button
          >
        </div>
      {/if}
    {:else}
      {#if preview && !failed}
        <dl class="recruit-facts">
          <dt class="label">FOUND</dt>
          <dd>{preview.facts.found}</dd>
          {#if preview.facts.skill !== null}
            <dt class="label">SKILL</dt>
            <dd>{preview.facts.skill}</dd>
          {/if}
          {#if preview.facts.size !== null}
            <dt class="label">SIZE</dt>
            <dd>{preview.facts.size}</dd>
          {/if}
          {#if preview.facts.inLoadout !== null}
            <dt class="label">IN LOADOUT</dt>
            <dd>{preview.facts.inLoadout}</dd>
          {/if}
        </dl>
        {#if preview.notes.length > 0}
          <div class="recruit-notes">
            {#each preview.notes as note, i (i)}<p>{note}</p>{/each}
          </div>
        {/if}
      {:else if message === null}
        <p class="muted">Reading {path}…</p>
      {/if}
      {#if showFolder}
        <div class="recruit-folder">
          <p>Pick the folder where your own skills live. Loadout makes {skill} in it.</p>
          <div class="field-row">
            <span class="recruit-picked" class:muted={recruitDialog.parent === null}
              >{recruitDialog.parent === null
                ? 'No folder picked.'
                : displayPath(recruitDialog.parent, home)}</span
            >
            <button class="same-w" disabled={running} onclick={choose}>Choose folder…</button>
          </div>
        </div>
      {/if}
      {#if message}
        <p class="notice" role="alert">{message}</p>
        <div class="actions">
          <button onclick={() => dialog?.close()}>Close</button>
        </div>
      {:else}
        {#if preview && preview.steps.length > 0}
          <div class="recruit-steps">
            <span class="label">LOADOUT WILL</span>
            <ol>
              {#each preview.steps as step, i (i)}<li>{step}</li>{/each}
            </ol>
          </div>
        {/if}
        <p class="muted small-note">
          Loadout deletes nothing. UNDO on the Recon page puts your original back.
        </p>
        <div class="actions">
          <button disabled={running} onclick={() => dialog?.close()}>Cancel</button>
          <button
            class="primary"
            disabled={!preview || preview.steps.length === 0 || busy || running}
            onclick={recruit}>{dangling ? 'Move to backup' : 'Recruit'}</button
          >
        </div>
      {/if}
    {/if}
  </div>
</dialog>
