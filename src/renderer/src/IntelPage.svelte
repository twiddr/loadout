<script lang="ts">
  import type { State } from '../../core/ipc'
  import { checkAll, reveal, update, updateAll } from './actions'
  import { ago, plural, sourceGroups, type SourceGroup } from './format'
  import Icon from './Icon.svelte'
  import Notice from './Notice.svelte'
  import PageHeader from './PageHeader.svelte'
  import Tip from './Tip.svelte'
  import { app } from './state.svelte'

  let { state: lib, eyebrow }: { state: State; eyebrow: string | null } = $props()

  const groups = $derived(sourceGroups(lib.entries, lib.checks))
  const ready = $derived(groups.filter((g) => g.check?.state === 'ready'))
  const blocked = $derived(groups.filter((g) => g.check?.state === 'blocked'))
  const fieldUpdates = $derived(groups.filter((g) => g.check && g.check.state !== 'up-to-date'))
  const upToDate = $derived(groups.filter((g) => g.check?.state === 'up-to-date'))
  const checked = $derived(groups.filter((g) => g.check))
  const unchecked = $derived(groups.filter((g) => !g.check))
  const lastChecked = $derived(Math.max(...checked.map((g) => g.check?.checkedAt ?? 0)))
  const registry = $derived(lib.entries.filter((e) => e.source.type === 'tessl').length)
  const folder = $derived(lib.entries.filter((e) => e.source.type === 'local').length)
  const busy = $derived(lib.busy !== null)
  const linkSources = $derived(groups.filter((g) => g.source.type === 'github').length)
  const registrySources = $derived(groups.filter((g) => g.source.type === 'tessl').length)

  const line = $derived(
    `${groups.length} ${plural(groups.length, 'SOURCE', 'SOURCES')} TRACKED · ${ready.length} READY · ${blocked.length} BLOCKED · ${
      checked.length > 0
        ? `CHECKED ${ago(lastChecked, app.now).toUpperCase()}${
            unchecked.length > 0 ? ` · ${unchecked.length} NOT CHECKED` : ''
          }`
        : 'NOT CHECKED THIS SESSION'
    }`
  )

  const entryOf = (g: SourceGroup): State['entries'][number] | undefined =>
    lib.entries.find((e) => e.name === g.skills[0])
  const noTool = (g: SourceGroup): boolean =>
    lib.startup.tools[g.source.type === 'github' ? 'git' : 'tessl'] === null
  const skillsLine = (g: SourceGroup): string =>
    `${g.skills.length} ${plural(g.skills.length, 'skill', 'skills')} · ${g.skills.join(', ')}`

  function openDiff(skill: string): void {
    app.page = { name: 'skill', skill, tab: 'diff', from: 'intel' }
  }
</script>

<PageHeader title="INTEL" {line} {eyebrow}>
  {#snippet actions()}
    <Tip
      text="Ask every source for news: git fetch for each Link clone, tessl outdated for the Registry plugins. Nothing changes until you press Update."
      end
    >
      <button aria-label="Check all" onclick={checkAll} disabled={busy}
        ><Icon name="refresh" size={14} />CHECK ALL</button
      >
    </Tip>
    <button
      class="amber"
      aria-label="Update all"
      onclick={updateAll}
      disabled={busy || ready.length === 0}>UPDATE {ready.length} READY</button
    >
  {/snippet}
</PageHeader>
<Notice />

<div class="recon-body">
  <section class="recon-main" aria-label="Field updates">
    <div class="recon-head">
      <span class="recon-title">FIELD UPDATES · {fieldUpdates.length}</span>
    </div>
    {#each fieldUpdates as g, i (g.key)}
      {@const c = g.check}
      {@const entry = entryOf(g)}
      {#if c && entry}
        <article class="intel-card cut {c.state}" aria-label={g.name}>
          <div class="intel-card-head">
            <span
              class="tile {g.source.type}"
              role="img"
              aria-label={g.source.type === 'github' ? 'Link' : 'Registry'}
              ><Icon name={g.source.type === 'github' ? 'link' : 'package'} size={18} /></span
            >
            <div class="intel-card-id">
              <span class="intel-card-name source-name">{g.name}</span>
              <span class="intel-card-skills">{skillsLine(g)}</span>
            </div>
            {#if c.state === 'ready'}
              <span class="intel-chip"
                >{g.source.type === 'github' ? `${c.behind} BEHIND` : `${c.from} → ${c.to}`}</span
              >
              <span class="head-sep" aria-hidden="true"></span>
              {#if g.source.type === 'github'}
                {#if g.skills.length === 1}
                  <button
                    class="small amber-outline"
                    aria-label="View diff"
                    onclick={() => openDiff(g.skills[0])}>VIEW DIFF</button
                  >
                {:else}
                  <button
                    class="small amber-outline"
                    aria-label="View diff"
                    aria-haspopup="menu"
                    popovertarget={`diff-${i}`}
                    style:anchor-name={`--diff-${i}`}>VIEW DIFF</button
                  >
                  <div
                    popover
                    id={`diff-${i}`}
                    class="menu-pop float"
                    style:position-anchor={`--diff-${i}`}
                  >
                    {#each g.skills as skill (skill)}
                      <button
                        popovertarget={`diff-${i}`}
                        popovertargetaction="hide"
                        onclick={() => openDiff(skill)}>{skill}</button
                      >
                    {/each}
                  </div>
                {/if}
              {/if}
              <button
                class="small amber"
                aria-label="Update"
                onclick={() => update(entry, lib.entries)}
                disabled={busy || noTool(g)}>UPDATE</button
              >
            {:else if c.state === 'blocked'}
              <span class="recon-tag bad">BLOCKED</span>
              <button
                class="small"
                aria-label="Reveal clone"
                onclick={() => reveal(entry, true)}
                disabled={busy}>REVEAL CLONE</button
              >
            {:else}
              <span class="recon-tag bad">CHECK FAILED</span>
            {/if}
          </div>
          {#if c.state === 'ready' && c.commits.length > 0}
            <div class="intel-card-rows">
              {#each c.commits as commit (commit.hash)}
                <span><span class="hash">{commit.hash}</span> {commit.subject}</span>
              {/each}
            </div>
          {:else if c.message}
            <div class="intel-card-rows">{c.message}</div>
          {/if}
        </article>
      {/if}
    {:else}
      <div class="intel-empty" role="status">
        <div class="intel-empty-body">
          <span
            class="radar"
            class:quiet={checked.length > 0 && unchecked.length === 0}
            aria-hidden="true"><Icon name="radio-tower" size={34} /></span
          >
          {#if groups.length === 0}
            <h2 class="intel-empty-title">NOTHING TO TRACK</h2>
            <p class="intel-empty-text">
              Intel watches skills recruited from a link or the registry. Your loadout has none yet.
            </p>
          {:else if checked.length === 0}
            <h2 class="intel-empty-title">NO INTEL YET</h2>
            <p class="intel-empty-text">
              Check all asks every tracked source for news: <code>git fetch</code> for each Link
              clone and <code>tessl outdated</code> for the Registry plugins. Updates then show here as
              field updates.
            </p>
          {:else if unchecked.length > 0}
            <h2 class="intel-empty-title">PARTIAL INTEL</h2>
            <p class="intel-empty-text">
              {unchecked.length} of {groups.length} tracked sources not checked this session: {unchecked
                .map((g) => g.name)
                .join(', ')}. The sources checked so far are up to date.
            </p>
          {:else}
            <h2 class="intel-empty-title">ALL QUIET</h2>
            <p class="intel-empty-text">
              Every tracked source is up to date · checked {ago(lastChecked, app.now)}.
            </p>
          {/if}
          <div class="intel-empty-counts">
            <span><span class="swatch-sq github"></span>LINK {linkSources}</span>
            <span><span class="swatch-sq tessl"></span>REGISTRY {registrySources}</span>
            <span><span class="swatch-sq local"></span>FOLDER {folder} · NOT TRACKED</span>
          </div>
          {#if groups.length > 0}
            <button class="primary" onclick={checkAll} disabled={busy}
              ><Icon name="refresh" size={14} />{checked.length === 0 || unchecked.length > 0
                ? 'CHECK ALL'
                : 'CHECK AGAIN'}</button
            >
          {/if}
        </div>
      </div>
    {/each}
  </section>

  <aside class="recon-side" aria-label="Sources">
    <div class="recon-head">
      <span class="recon-title">UP TO DATE · {upToDate.length}</span>
    </div>
    {#if upToDate.length > 0}
      <div class="recon-panel">
        {#each upToDate as g (g.key)}
          <div class="folder-row">
            <span class="folder-text">
              <strong class="source-name">{g.name}</strong>
              {#each g.skills as skill (skill)}
                <span class="folder-path">{skill}</span>
              {/each}
            </span>
            <span class="folder-count"
              >{g.skills.length} {plural(g.skills.length, 'SKILL', 'SKILLS')}</span
            >
          </div>
        {/each}
      </div>
    {/if}
    <div class="recon-panel">
      <span class="recon-title swatch-title"
        ><span class="swatch-sq tessl"></span>REGISTRY · {registry}</span
      >
      <span class="field-notes"
        >Tessl plugins are checked with tessl outdated and updated by reinstalling the plugin.{registry ===
        0
          ? ' None installed yet.'
          : ''}</span
      >
    </div>
    <div class="recon-panel">
      <span class="recon-title swatch-title"
        ><span class="swatch-sq local"></span>FOLDER · {folder}</span
      >
      <span class="field-notes"
        >Your own skills get no update checks. Review, Fix and Publish them from each skill's page;
        there, the refresh button on the TESSL card compares a published skill with the Tessl
        Registry.</span
      >
    </div>
  </aside>
</div>
