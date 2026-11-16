<script lang="ts">
  import type { Entry, State } from '../../core/ipc'
  import AddDialog from './AddDialog.svelte'
  import Icon from './Icon.svelte'
  import { check, relocate, remove, reveal, review, update, updateLabel } from './actions'
  import { openTesslDialog } from './state.svelte'

  // `labeled` draws the skill page's ACTIONS button instead of the card's ⋯ icon.
  let {
    entry,
    state: lib,
    labeled = false
  }: { entry: Entry; state: State; labeled?: boolean } = $props()

  const id = $props.id()

  const busy = $derived(lib.busy !== null)
  const noTessl = $derived(lib.startup.tools.tessl === null)
  /** The skill page's Add dialog for Recruit more; the LOADOUT page's dialogs are not mounted here. */
  let add = $state<AddDialog>()
</script>

{#if labeled}
  <button
    class="primary requisition"
    aria-label={`Actions for ${entry.name}`}
    aria-haspopup="menu"
    popovertarget={`menu-${id}`}
    style:anchor-name={`--menu-${id}`}
    >ACTIONS<span class="divider"></span><Icon name="chevron-down" size={12} /></button
  >
{:else}
  <button
    class="icon"
    aria-label={`Actions for ${entry.name}`}
    title={`Actions for ${entry.name}`}
    popovertarget={`menu-${id}`}
    style:anchor-name={`--menu-${id}`}><Icon name="ellipsis" /></button
  >
{/if}
<div popover id={`menu-${id}`} class="menu-pop float" style:position-anchor={`--menu-${id}`}>
  {#if entry.source.type === 'github' || entry.source.type === 'tessl'}
    {@const source = entry.source}
    {@const noTool = lib.startup.tools[source.type === 'github' ? 'git' : 'tessl'] === null}
    <button
      popovertarget={`menu-${id}`}
      popovertargetaction="hide"
      onclick={() => check(entry)}
      disabled={busy || noTool}>Check source</button
    >
    <button
      popovertarget={`menu-${id}`}
      popovertargetaction="hide"
      onclick={() => update(entry, lib.entries)}
      disabled={busy || noTool}>{updateLabel(source, lib.entries)}</button
    >
    {#if labeled}
      {@const name =
        source.type === 'github'
          ? `${source.owner}/${source.repo}`
          : `${source.workspace}/${source.plugin}`}
      <button
        popovertarget={`menu-${id}`}
        popovertargetaction="hide"
        onclick={() => add?.scanSource(name)}
        disabled={busy || noTool}>Recruit more from {name}</button
      >
    {/if}
  {/if}
  {#if entry.status === 'ok'}
    <button
      popovertarget={`menu-${id}`}
      popovertargetaction="hide"
      onclick={() => review(entry)}
      disabled={busy || noTessl}>Tessl review</button
    >
    {#if entry.source.type === 'local'}
      <button
        popovertarget={`menu-${id}`}
        popovertargetaction="hide"
        onclick={() => openTesslDialog('fix', entry.name)}
        disabled={busy || noTessl}>Tessl fix</button
      >
      <button
        popovertarget={`menu-${id}`}
        popovertargetaction="hide"
        onclick={() => openTesslDialog('publish', entry.name)}
        disabled={busy || noTessl}>Tessl publish</button
      >
      {#if lib.manifests[entry.name]}
        <button
          popovertarget={`menu-${id}`}
          popovertargetaction="hide"
          onclick={() => openTesslDialog('unpublish', entry.name)}
          disabled={busy || noTessl}>Tessl unpublish</button
        >
      {/if}
    {/if}
    <hr class="menu-sep" />
    <button
      popovertarget={`menu-${id}`}
      popovertargetaction="hide"
      onclick={() => openTesslDialog('fork', entry.name)}
      disabled={busy}>Fork</button
    >
  {/if}
  {#if entry.source.type !== 'local' || entry.status === 'ok'}
    <hr class="menu-sep" />
  {/if}
  <button
    popovertarget={`menu-${id}`}
    popovertargetaction="hide"
    onclick={() => reveal(entry)}
    disabled={busy}>Reveal in Finder</button
  >
  {#if entry.status === 'missing'}
    <button
      popovertarget={`menu-${id}`}
      popovertargetaction="hide"
      onclick={() => relocate(entry)}
      disabled={busy}>Relocate</button
    >
  {/if}
  {#if entry.status !== 'not-a-link'}
    <button
      popovertarget={`menu-${id}`}
      popovertargetaction="hide"
      onclick={() => remove(entry)}
      disabled={busy}>Remove</button
    >
  {/if}
</div>
{#if labeled && (entry.source.type === 'github' || entry.source.type === 'tessl')}
  <AddDialog kind={entry.source.type} {busy} bind:this={add} />
{/if}
