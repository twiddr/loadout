<script lang="ts">
  import type { State } from '../../core/ipc'
  import { sourceKey } from '../../core/checks'
  import AddDialog from './AddDialog.svelte'
  import { addFolder, setView, updateAll } from './actions'
  import { gridItems, matches, plural, sourceGroups, type Filter } from './format'
  import Icon from './Icon.svelte'
  import Notice from './Notice.svelte'
  import PackCard from './PackCard.svelte'
  import PageHeader from './PageHeader.svelte'
  import SkillCard from './SkillCard.svelte'
  import { app } from './state.svelte'

  let { state: lib, eyebrow }: { state: State; eyebrow: string | null } = $props()

  let addDialog = $state<HTMLDialogElement>()
  let registryDialog = $state<HTMLDialogElement>()
  let linkAdd = $state<AddDialog>()
  let registryAdd = $state<AddDialog>()

  const issued = $derived(lib.entries.filter((e) => e.enabledFor.length > 0).length)
  const shown = $derived(
    gridItems(lib.entries, lib.packs, lib.home, lib.loadoutView, app.pack, app.search, app.filter)
  )
  /** The members of the open pack; empty when no pack is open or its last member left. */
  const members = $derived(
    app.pack === null ? [] : lib.entries.filter((e) => sourceKey(e.source) === app.pack)
  )
  // The key is `github:<owner>/<repo>` or `tessl:<workspace>/<plugin>`, so it names the pack with one member left too.
  const sourceName = $derived(app.pack?.slice(app.pack.indexOf(':') + 1) ?? '')
  const fromRegistry = $derived(app.pack?.startsWith('tessl:') ?? false)
  /** Why the open pack cannot recruit more, or null when it can. */
  const recruitBlock = $derived(
    fromRegistry
      ? lib.startup.tools.tessl === null
        ? 'tessl not found'
        : null
      : lib.startup.tools.git === null
        ? 'git not found'
        : null
  )
  const membersOn = $derived(members.filter((e) => e.enabledFor.length > 0).length)
  const count = (filter: Filter): number =>
    (app.pack === null ? lib.entries : members).filter((e) => matches(e, lib.home, '', filter))
      .length
  const allChips: { filter: Filter; label: string }[] = [
    { filter: 'all', label: 'All' },
    { filter: 'local', label: 'Folder' },
    { filter: 'github', label: 'Link' },
    { filter: 'tessl', label: 'Registry' },
    { filter: 'stowed', label: 'Stowed' }
  ]
  // An open pack filters its members by All and Stowed only.
  const chips = $derived(
    app.pack === null
      ? allChips
      : allChips.filter((c) => c.filter === 'all' || c.filter === 'stowed')
  )

  // The open pack's last member left: back to the grid.
  $effect(() => {
    if (app.pack !== null && members.length === 0) app.pack = null
  })
  const busy = $derived(lib.busy !== null)
  const updates = $derived(
    sourceGroups(lib.entries, lib.checks)
      .filter((g) => g.check?.state === 'ready')
      .flatMap((g) => g.skills)
      .sort()
  )
  const updateText = $derived(
    `${updates.length} ${plural(updates.length, 'update', 'updates')} available — ${updates.join(', ')}`
  )
</script>

<PageHeader
  title="LOADOUT"
  line={`${lib.entries.length} ${plural(lib.entries.length, 'SKILL', 'SKILLS')} · ${issued} DEPLOYED · ${lib.entries.length - issued} STOWED`}
  {eyebrow}
  lineBody={members.length > 0 ? packLine : undefined}
>
  {#snippet actions()}
    <button
      class="primary requisition"
      popovertarget="requisition"
      style:anchor-name="--requisition"
      aria-haspopup="menu"
    >
      <Icon name="plus" size={15} />RECRUIT SKILL<span class="divider"></span><Icon
        name="chevron-down"
        size={12}
      />
    </button>
  {/snippet}
</PageHeader>
{#snippet packLine()}
  <button class="back" aria-label="Back to packs" onclick={() => (app.pack = null)}
    ><Icon name="chevron-left" size={13} />PACKS</button
  >
  <span class="sep">/</span>
  <span class="pack-name">{sourceName}</span>
  <span class="tip">
    <button
      class="back recruit-more"
      aria-label={`Recruit more from ${sourceName}`}
      disabled={busy || recruitBlock !== null}
      onclick={() => (fromRegistry ? registryAdd : linkAdd)?.scanSource(sourceName)}
      ><Icon name="square-plus" size={15} /></button
    >
    <span class="tip-text float" role="tooltip"
      >{recruitBlock ?? `Recruit more from ${sourceName}`}</span
    >
  </span>
  <span class="sep">·</span>
  <span>{members.length} {plural(members.length, 'SKILL', 'SKILLS')}</span>
  <span class="sep">·</span>
  <span>{membersOn} DEPLOYED</span>
  <span class="sep">·</span>
  <span>{members.length - membersOn} STOWED</span>
{/snippet}
<div popover id="requisition" class="menu-pop float" style:position-anchor="--requisition">
  <button popovertarget="requisition" popovertargetaction="hide" onclick={addFolder} disabled={busy}
    ><Icon name="folder" />Add from folder</button
  >
  <button
    popovertarget="requisition"
    popovertargetaction="hide"
    onclick={() => addDialog?.showModal()}
    disabled={busy || lib.startup.tools.git === null}
    title={lib.startup.tools.git === null ? 'git not found' : undefined}
    ><Icon name="link" />Add from link</button
  >
  <button
    popovertarget="requisition"
    popovertargetaction="hide"
    onclick={() => registryDialog?.showModal()}
    disabled={busy || lib.startup.tools.tessl === null}
    title={lib.startup.tools.tessl === null ? 'tessl not found' : undefined}
    ><Icon name="package" />Add from registry</button
  >
</div>
<Notice />
{#if updates.length > 0}
  <div class="intel-strip hazard page-strip">
    <div class="intel-strip-body">
      <span class="intel-strip-label">INTEL</span>
      <span class="intel-strip-text">{updateText}</span>
      <span class="spacer"></span>
      <button class="small amber" aria-label="Update all" onclick={updateAll} disabled={busy}
        >UPDATE ALL</button
      >
    </div>
  </div>
{/if}

<div class="filter-row">
  <label class="search">
    <Icon name="search" size={15} />
    <input
      type="text"
      aria-label="Search your loadout"
      placeholder="Search your loadout…"
      bind:value={app.search}
    />
  </label>
  {#each chips as { filter, label } (filter)}
    <button
      class="filter-chip"
      aria-pressed={app.filter === filter}
      onclick={() => (app.filter = filter)}
    >
      {#if filter === 'local' || filter === 'github' || filter === 'tessl'}
        <span class="swatch-sq {filter}"></span>
      {/if}
      {label}
      <span aria-hidden="true">{count(filter)}</span>
    </button>
  {/each}
  <div class="view-switch">
    <span class="tip">
      <button
        class="filter-chip"
        aria-pressed={lib.loadoutView === 'skills'}
        aria-describedby="view-tip-skills"
        onclick={() => setView('skills')}>SKILLS</button
      >
      <span class="tip-text float" id="view-tip-skills" role="tooltip"
        >Show every skill as its own card</span
      >
    </span>
    <span class="tip">
      <button
        class="filter-chip"
        aria-pressed={lib.loadoutView === 'packs'}
        aria-describedby="view-tip-packs"
        onclick={() => setView('packs')}>PACKS</button
      >
      <span class="tip-text float" id="view-tip-packs" role="tooltip"
        >Group the skills from one Link or Registry source into one pack card</span
      >
    </span>
  </div>
</div>

<div class="view card-view">
  {#if lib.entries.length === 0}
    <div class="empty-card">
      <div class="empty-title">Your loadout is empty</div>
      <div class="muted">
        Add a skill with Recruit skill: Folder, Link or Registry. Use + Enlist agent to choose which
        agents get a toggle.
      </div>
    </div>
  {:else if shown.length === 0}
    <p class="no-match">
      {#if app.search.trim()}
        No skill matches "{app.search.trim()}".
      {:else}
        No skill matches the {chips.find((c) => c.filter === app.filter)?.label} filter.
      {/if}
    </p>
  {:else}
    <div class="card-grid">
      {#each shown as item (item.kind === 'skill' ? item.entry.name : item.pack.key)}
        {#if item.kind === 'skill'}
          <SkillCard entry={item.entry} index={item.index} state={lib} />
        {:else}
          <PackCard pack={item.pack} members={item.members} state={lib} />
        {/if}
      {/each}
    </div>
  {/if}
</div>

<AddDialog kind="github" {busy} bind:dialog={addDialog} bind:this={linkAdd} />
<AddDialog kind="tessl" {busy} bind:dialog={registryDialog} bind:this={registryAdd} />
