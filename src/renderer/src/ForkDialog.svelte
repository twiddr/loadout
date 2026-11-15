<script lang="ts">
  import { displayPath } from '../../core/paths'
  import type { Entry, Forked } from '../../core/ipc'
  import { fork } from './actions'
  import { app } from './state.svelte'

  let {
    dialog = $bindable(),
    entry,
    home,
    busy
  }: {
    dialog?: HTMLDialogElement
    entry: Entry | null
    home: string
    busy: boolean
  } = $props()

  let name = $state('')
  let message = $state<string | null>(null)
  let running = $state(false)
  let done = $state<Forked | null>(null)

  const old = $derived(entry?.name ?? '')

  async function choose(): Promise<void> {
    if (!entry) return
    running = true
    message = null
    try {
      const result = await fork(entry, name.trim())
      if (!result.ok) message = result.message
      else if (!('cancelled' in result)) done = result
    } catch (error) {
      app.notice = error instanceof Error ? error.message : String(error)
      dialog?.close()
    } finally {
      running = false
    }
  }
</script>

<dialog
  class="cover"
  bind:this={dialog}
  oncancel={(e) => {
    // Escape must not close the dialog while a command runs: its outcome would land in a closed dialog.
    if (running) e.preventDefault()
  }}
  ontoggle={(e) => {
    // Clear on close, not on open: `toggle` fires after `showModal()`, so a reset on open can wipe a name typed at once.
    if (e.newState === 'closed') {
      name = ''
      message = null
      done = null
    }
  }}
>
  <div class="dialog-drag"></div>
  <div class="dialog-box">
    {#if done}
      {@const forked = done}
      <span class="eyebrow">{forked.name}</span>
      <h2 class="title">FORKED</h2>
      <p>"{forked.name}" is at {displayPath(forked.folder, home)}.</p>
      {#if forked.moved.length > 0}
        <p>Switched on for {forked.moved.join(', ')}; "{old}" switched off there.</p>
      {/if}
      {#each forked.failed as failure (failure.agent)}
        <p>Not switched for {failure.agent}: {failure.message} "{old}" stays on there.</p>
      {/each}
      {#if forked.occurrences.length > 0}
        <h3 class="settings-head">OTHER MENTIONS OF "{old.toUpperCase()}"</h3>
        <p>
          Fork changed only the frontmatter name. Edit these lines by hand where they should name "{forked.name}":
        </p>
        <pre class="copy-block">{forked.occurrences.join('\n')}</pre>
      {:else}
        <p>"{old}" appears nowhere else in the copy.</p>
      {/if}
      <div class="actions">
        <button onclick={() => dialog?.close()}>Close</button>
        <button
          class="primary"
          onclick={() => {
            app.page = { name: 'skill', skill: forked.name, tab: 'briefing', from: 'loadout' }
            dialog?.close()
          }}>Open skill page</button
        >
      </div>
    {:else}
      <span class="eyebrow">{old}</span>
      <h2 class="title">FORK</h2>
      <p>
        Fork copies this skill to a new folder under a new name and adds the copy as a Folder skill.
        The agents that have "{old}" on switch to the copy. The original stays in your loadout,
        switched off.
      </p>
      {#if entry && entry.source.type !== 'local'}
        <p>
          Updates to the original do not reach the copy; Loadout does not check the copy for
          updates.
        </p>
      {/if}
      <div class="field-label">
        <label class="label" for="fork-name">New name</label>
        <input id="fork-name" type="text" bind:value={name} />
      </div>
      {#if message}
        <p class="notice" role="alert">{message}</p>
      {/if}
      <p class="muted small-note">
        Next, pick the parent folder. The copy goes to &lt;parent&gt;/{name.trim() || '<new name>'}.
      </p>
      <div class="actions">
        <button disabled={running} onclick={() => dialog?.close()}>Cancel</button>
        <button class="primary" disabled={busy || running || name.trim() === ''} onclick={choose}
          >Choose folder…</button
        >
      </div>
    {/if}
  </div>
</dialog>
