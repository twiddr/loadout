<script lang="ts">
  import { releaseNotesUrl } from '../../core/release'
  import { api } from './api'
  import Icon from './Icon.svelte'
  import { app } from './state.svelte'

  // A launch or noon check found a newer release (ADR 20261116-app-update-prompt). UPDATE opens the
  // update dialog through `onupdate` and starts the download, as DOWNLOAD there does. After a
  // failed update it only opens the dialog, so the failure and the steps show (ADR 20261114-app-self-update, 5).
  let { dialog = $bindable(), onupdate }: { dialog?: HTMLDialogElement; onupdate: () => void } =
    $props()

  const update = $derived(app.state?.appUpdate ?? null)

  function updateNow(): void {
    dialog?.close()
    onupdate()
    if (update?.replace.ok && update.stage === 'offered') {
      void api.invoke('update-download')
    }
  }
</script>

<dialog class="cover update-prompt" aria-labelledby="update-prompt-title" bind:this={dialog}>
  <div class="dialog-drag"></div>
  <div class="dialog-box">
    <span class="eyebrow">LOADOUT {__APP_VERSION__}</span>
    <h2 class="title" id="update-prompt-title">UPDATE</h2>
    {#if update}
      <div class="update-lead">
        <p>Loadout <b>{update.latest}</b> is out.</p>
        <a href={releaseNotesUrl(update.latest)} target="_blank" rel="noreferrer"
          >RELEASE NOTES<Icon name="external-link" size={12} /></a
        >
      </div>
    {/if}
    <!-- svelte-ignore a11y_autofocus -->
    <div class="actions">
      <button type="button" onclick={() => dialog?.close()}>LATER</button>
      <button type="button" class="primary" autofocus onclick={updateNow}
        ><Icon name="download" size={13} />UPDATE</button
      >
    </div>
  </div>
</dialog>
