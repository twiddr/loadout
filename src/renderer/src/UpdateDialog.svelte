<script lang="ts">
  import type { Result } from '../../core/ipc'
  import { INSTALL_COMMAND, releaseNotesUrl } from '../../core/release'
  import { api } from './api'
  import CommandBox from './bootcamp/CommandBox.svelte'
  import { openTerminal } from './bootcamp/actions'
  import Icon from './Icon.svelte'
  import { app } from './state.svelte'

  let { dialog = $bindable() }: { dialog?: HTMLDialogElement } = $props()

  const update = $derived(app.state?.appUpdate ?? null)
  const latest = $derived(update?.latest ?? null)
  // The steps open when Loadout cannot replace itself or the update failed; the user can open them any time.
  const handOpen = $derived(update !== null && (!update.replace.ok || update.stage === 'failed'))

  // The message of a refused DOWNLOAD, CANCEL or RESTART; local to the dialog.
  let refusal = $state<string | null>(null)

  async function act(call: () => Promise<Result>): Promise<void> {
    refusal = null
    const result = await call()
    if (!result.ok) refusal = result.message
  }
</script>

<dialog
  class="cover update"
  aria-labelledby="update-title"
  bind:this={dialog}
  ontoggle={(e) => {
    // Clear on close, not on open: `toggle` fires late after `showModal()`.
    if (e.newState === 'closed') refusal = null
  }}
>
  <div class="dialog-drag"></div>
  <div class="dialog-box">
    <span class="eyebrow">LOADOUT {__APP_VERSION__}</span>
    <h2 class="title" id="update-title">UPDATE</h2>
    {#if update}
      <div class="update-lead">
        <p>Loadout <b>{latest}</b> is out.</p>
        <a href={releaseNotesUrl(update.latest)} target="_blank" rel="noreferrer"
          >RELEASE NOTES<Icon name="external-link" size={12} /></a
        >
      </div>
      {#if !update.replace.ok}
        <p class="update-text muted">
          Loadout cannot replace itself here: {update.replace.reason} Install it by hand.
        </p>
      {:else if update.stage === 'offered'}
        <p class="update-text">
          Loadout downloads and checks {latest}. It restarts only when you click RESTART.
        </p>
      {:else if update.stage === 'failed'}
        <p class="notice" role="alert">The update failed: {update.message}</p>
      {:else}
        <div class="update-progress">
          <div class="update-progress-text">
            {#if update.stage === 'downloading'}
              <span>DOWNLOADING {latest}</span>
              {#if update.percent !== null}<span>{update.percent} %</span>{/if}
            {:else if update.stage === 'checking'}
              <span>CHECKING {latest}</span>
            {:else}
              <span>{latest} IS READY</span><span>CHECKED</span>
            {/if}
          </div>
          <div class="update-bar">
            <span style:width="{update.stage === 'downloading' ? (update.percent ?? 0) : 100}%"
            ></span>
          </div>
        </div>
        {#if update.stage === 'ready' && !refusal}
          <p class="update-text">
            Restart Loadout to finish the update. A running command must end first.
          </p>
        {/if}
      {/if}
      {#if refusal}
        <p class="notice" role="alert">{refusal}</p>
      {/if}
      <!-- Keyed, so the steps fold or open with the stage and COPY's autofocus follows them. -->
      {#key handOpen}
        <details class="update-hand" open={handOpen}>
          <summary>INSTALL BY HAND <span class="update-chevron">›</span></summary>
          <ol class="update-steps">
            <li>
              <span class="update-num">01</span>
              <div>
                <p>In Terminal, run:</p>
                <CommandBox lines={[INSTALL_COMMAND]} autofocus={handOpen} />
              </div>
            </li>
            <li>
              <span class="update-num">02</span>
              <p>Quit Loadout.</p>
            </li>
            <li>
              <span class="update-num">03</span>
              <p>
                Open <span class="mono">Loadout.dmg</span> in Downloads, drag Loadout to Applications
                and replace the old copy, then eject the Loadout disk.
              </p>
            </li>
            <li>
              <span class="update-num">04</span>
              <p>Start Loadout.</p>
            </li>
          </ol>
        </details>
      {/key}
      <p class="muted small-note">
        Your skills, agents and settings stay as they are. macOS can ask again for access to a
        skills folder in Documents, Desktop or Downloads.
      </p>
    {/if}
    <!-- svelte-ignore a11y_autofocus -->
    <div class="actions">
      {#if !update}
        <button type="button" class="primary" onclick={() => dialog?.close()}>Close</button>
      {:else if !update.replace.ok}
        <button type="button" onclick={openTerminal}
          ><Icon name="square-terminal" size={13} />OPEN TERMINAL</button
        >
        <button type="button" class="primary" onclick={() => dialog?.close()}>Close</button>
      {:else if update.stage === 'offered'}
        <button type="button" onclick={() => dialog?.close()}>Close</button>
        <button
          type="button"
          class="primary"
          autofocus
          onclick={() => act(() => api.invoke('update-download'))}
          ><Icon name="download" size={13} />DOWNLOAD</button
        >
      {:else if update.stage === 'downloading' || update.stage === 'checking'}
        <button type="button" onclick={() => act(() => api.invoke('update-cancel'))}>CANCEL</button>
        <button type="button" class="primary" autofocus onclick={() => dialog?.close()}
          >Close</button
        >
      {:else if update.stage === 'ready'}
        <button type="button" onclick={() => dialog?.close()}>Close</button>
        <button
          type="button"
          class="primary"
          autofocus
          onclick={() => act(() => api.invoke('update-restart'))}
          ><Icon name="rotate-ccw" size={13} />RESTART</button
        >
      {:else}
        <button type="button" onclick={openTerminal}
          ><Icon name="square-terminal" size={13} />OPEN TERMINAL</button
        >
        <button type="button" onclick={() => dialog?.close()}>Close</button>
        <button
          type="button"
          class="primary"
          onclick={() => act(() => api.invoke('update-download'))}
          ><Icon name="download" size={13} />TRY AGAIN</button
        >
      {/if}
    </div>
  </div>
</dialog>
