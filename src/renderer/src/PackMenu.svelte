<script lang="ts">
  import type { Entry, State } from '../../core/ipc'
  import type { Pack } from '../../core/packs'
  import Icon from './Icon.svelte'
  import { check, reveal, update, updateLabel } from './actions'
  import { openPackRemove } from './state.svelte'

  let { pack, members, state: lib }: { pack: Pack; members: Entry[]; state: State } = $props()

  const id = $props.id()

  const busy = $derived(lib.busy !== null)
  const noTool = $derived(lib.startup.tools[pack.type === 'github' ? 'git' : 'tessl'] === null)
  // Check, Update and Reveal act on the first member, as they open or check the whole source.
  const first = $derived(members[0])
  const source = $derived(first?.source)
</script>

<button
  class="icon"
  aria-label={`Actions for ${pack.name}`}
  title={`Actions for ${pack.name}`}
  popovertarget={`menu-${id}`}
  style:anchor-name={`--menu-${id}`}><Icon name="ellipsis" /></button
>
<div popover id={`menu-${id}`} class="menu-pop float" style:position-anchor={`--menu-${id}`}>
  {#if first && (source?.type === 'github' || source?.type === 'tessl')}
    <button
      popovertarget={`menu-${id}`}
      popovertargetaction="hide"
      onclick={() => check(first)}
      disabled={busy || noTool}>Check source</button
    >
    <button
      popovertarget={`menu-${id}`}
      popovertargetaction="hide"
      onclick={() => update(first, lib.entries)}
      disabled={busy || noTool}>{updateLabel(source, lib.entries)}</button
    >
    <hr class="menu-sep" />
    <button
      popovertarget={`menu-${id}`}
      popovertargetaction="hide"
      onclick={() => reveal(first, true)}
      disabled={busy}>Reveal in Finder</button
    >
  {/if}
  <button
    popovertarget={`menu-${id}`}
    popovertargetaction="hide"
    onclick={() => openPackRemove(pack.key)}
    disabled={busy}>Remove</button
  >
</div>
