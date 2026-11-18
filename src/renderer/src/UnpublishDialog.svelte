<script lang="ts">
  import type { Manifest } from '../../core/ipc'
  import { displayPath } from '../../core/paths'
  import Tip from './Tip.svelte'

  let {
    dialog = $bindable(),
    name,
    manifest,
    folder,
    home,
    busy,
    onunpublish
  }: {
    dialog?: HTMLDialogElement
    name: string
    /** The skill's local Tessl manifest; the dialog opens only for a skill that has one. */
    manifest: Manifest | null
    /** The skill folder, where Loadout deletes the manifest after a full removal. */
    folder: string
    home: string
    busy: boolean
    onunpublish: () => void
  } = $props()

  const plugin = $derived(manifest ? `${manifest.workspace}/${manifest.plugin}` : '')
</script>

<dialog class="cover" autofocus bind:this={dialog}>
  <div class="dialog-drag"></div>
  <div class="dialog-box">
    <h2 class="title">UNPUBLISH</h2>
    <p>
      {name}
      <span class="muted">from the Tessl Registry</span>
    </p>
    <div class="publish-grid">
      <span class="label">Plugin</span>
      <Tip text={plugin} overflow><span class="publish-visibility plugin">{plugin}</span></Tip>
      <span class="label">Removes</span>
      <span class="publish-visibility">every version Loadout can find</span>
    </div>
    <p>
      Tessl: “Unpublish removes a version as if it was never published.” “Unpublished versions are
      completely removed and cannot be recovered.”
    </p>
    <p class="muted small-note">
      Colleagues who installed the skill keep their copy, but cannot update it or install it again.
      When every version is gone, Loadout deletes the Tessl manifest
      <span class="mono">.tessl-plugin/plugin.json</span> in
      <span class="mono">{displayPath(folder, home)}</span>. A new Publish starts the plugin again
      at version 0.1.0.
    </p>
    <div class="actions">
      <button onclick={() => dialog?.close()}>Cancel</button>
      <button
        class="primary"
        disabled={busy}
        onclick={() => {
          dialog?.close()
          onunpublish()
        }}>Unpublish</button
      >
    </div>
  </div>
</dialog>

<style>
  .plugin {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
