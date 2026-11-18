<script lang="ts">
  import { untrack } from 'svelte'
  import { app } from './state.svelte'

  let dialog = $state<HTMLDialogElement>()
  // The text stays while the dialog closes, so it is kept apart from app.fixDone.
  let shown = $state<{ skill: string; files: number } | null>(null)
  const lead = $derived(
    shown?.files === 1
      ? 'The fix changed 1 file. Read it on the FIX tab, then keep or undo the fix.'
      : `The fix changed ${shown?.files} files. Read them on the FIX tab, then keep or undo the fix.`
  )

  /** Opens the dialog for a waiting fix; it never opens over another dialog. */
  function offer(): void {
    if (!app.fixDone || dialog?.open || document.querySelector('dialog[open]')) return
    shown = app.fixDone
    dialog?.showModal()
  }

  $effect(() => {
    if (app.fixDone) untrack(offer)
  })

  function openFix(): void {
    if (shown) app.page = { name: 'skill', skill: shown.skill, tab: 'fix', from: 'loadout' }
    dialog?.close()
  }
</script>

<!-- A fix that ended under another dialog waits until that dialog closes. -->
<svelte:document
  onclosecapture={(e) => {
    if (e.target !== dialog) offer()
  }}
/>

<!-- LATER, OPEN FIX and Escape all close it, and every close ends the wait. -->
<dialog
  class="cover fix-done"
  aria-labelledby="fix-done-title"
  bind:this={dialog}
  onclose={() => (app.fixDone = null)}
>
  <div class="dialog-drag"></div>
  <div class="dialog-box">
    <span class="eyebrow">{shown?.skill ?? ''}</span>
    <h2 class="title" id="fix-done-title">FIXED</h2>
    <p>{lead}</p>
    <!-- svelte-ignore a11y_autofocus -->
    <div class="actions">
      <button type="button" onclick={() => dialog?.close()}>LATER</button>
      <button type="button" class="primary" autofocus onclick={openFix}>OPEN FIX</button>
    </div>
  </div>
</dialog>
