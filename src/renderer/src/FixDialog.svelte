<script lang="ts">
  import { displayPath } from '../../core/paths'
  import type { Entry } from '../../core/ipc'

  let {
    dialog = $bindable(),
    entry,
    tesslUser,
    home,
    busy,
    onrun
  }: {
    dialog?: HTMLDialogElement
    entry: Entry | null
    tesslUser: string | null
    home: string
    busy: boolean
    onrun: () => void
  } = $props()

  // parseWhoami gives 'logged in' when the user record has no name to show.
  const who = $derived(
    tesslUser === null
      ? 'Not logged in to Tessl.'
      : tesslUser === 'logged in'
        ? 'Logged in to Tessl.'
        : `Logged in as ${tesslUser}.`
  )
</script>

<dialog class="cover" bind:this={dialog}>
  <div class="dialog-drag"></div>
  <div class="dialog-box">
    <span class="eyebrow">{entry?.name ?? ''}</span>
    <h2 class="title">FIX</h2>
    <p>
      Fix runs one improve-and-review round. It costs 100 credits times the model multiplier. {who} Run
      it?
    </p>
    {#if entry?.source.type === 'local'}
      <p class="muted small-note">
        Fix edits files in <span class="mono">{displayPath(entry.source.path, home)}</span>. Do not
        edit the skill while Fix runs: Undo puts back the whole folder, so it erases those edits
        too.
      </p>
    {/if}
    <div class="actions">
      <button onclick={() => dialog?.close()}>Cancel</button>
      <button
        class="primary"
        disabled={busy}
        onclick={() => {
          dialog?.close()
          onrun()
        }}>Run Fix</button
      >
    </div>
  </div>
</dialog>
