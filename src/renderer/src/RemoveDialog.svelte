<script lang="ts">
  import type { Entry } from '../../core/ipc'
  import type { Pack } from '../../core/packs'
  import { displayPath, pathsFrom } from '../../core/paths'

  let {
    dialog = $bindable(),
    entry,
    entries,
    pack = null,
    members = [],
    home,
    busy,
    onremove
  }: {
    dialog?: HTMLDialogElement
    entry: Entry | null
    /** The library, to tell whether `entry` is the last skill of its clone. */
    entries: Entry[]
    pack?: Pack | null
    members?: Entry[]
    home: string
    busy: boolean
    onremove: () => void
  } = $props()

  const n = $derived(entry?.enabledFor.length ?? 0)
  const m = $derived(members.reduce((sum, e) => sum + e.enabledFor.length, 0))
  const folder = $derived(
    !pack
      ? ''
      : pack.type === 'github'
        ? `The clone at ${displayPath(pack.folder, home)} is deleted, unless it holds local changes.`
        : `The plugin folder stays at ${displayPath(pack.folder, home)}.`
  )
  /** The clone a single Remove leaves unused: `entry` is a Link skill and no other skill uses its clone. */
  const lastOfClone = $derived.by(() => {
    const source = entry?.source
    if (pack || source?.type !== 'github') return ''
    const same = (e: Entry): boolean =>
      e.source.type === 'github' && e.source.owner === source.owner && e.source.repo === source.repo
    if (entries.filter(same).length !== 1) return ''
    const clone = `${pathsFrom(home).repos}/${source.owner}/${source.repo}`
    return `It is the last skill from ${source.owner}/${source.repo}, so the clone at ${displayPath(clone, home)} is deleted, unless it holds local changes.`
  })
</script>

<dialog class="cover" bind:this={dialog}>
  <div class="dialog-drag"></div>
  <div class="dialog-box">
    <span class="eyebrow">{pack ? pack.name : (entry?.name ?? '')}</span>
    <h2 class="title">REMOVE</h2>
    {#if pack}
      <p>
        Remove {pack.name}? {members.length} skills leave your loadout, and their {m}
        {m === 1 ? 'agent link is' : 'agent links are'} removed.
        {folder}
      </p>
    {:else}
      <p>
        Remove this skill from your loadout? Its {n}
        {n === 1 ? 'agent link is' : 'agent links are'} removed too.
        {lastOfClone || 'The source folder is not deleted.'}
      </p>
    {/if}
    <div class="actions">
      <button onclick={() => dialog?.close()}>Cancel</button>
      <button
        class="primary"
        disabled={busy}
        onclick={() => {
          dialog?.close()
          onremove()
        }}>Remove</button
      >
    </div>
  </div>
</dialog>
