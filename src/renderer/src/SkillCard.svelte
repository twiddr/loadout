<script lang="ts">
  import type { Entry, State } from '../../core/ipc'
  import { sourceKey } from '../../core/checks'
  import { claudeEnabled, syncedLoad } from '../../core/synced'
  import { toggle } from './actions'
  import {
    agentCode,
    ago,
    fixLabel,
    isRunning,
    scoreText,
    scoreTone,
    serial,
    sourceLine
  } from './format'
  import Icon from './Icon.svelte'
  import Rank from './Rank.svelte'
  import SkillMenu from './SkillMenu.svelte'
  import { app } from './state.svelte'

  let {
    entry,
    index,
    state: lib,
    menu = true
  }: { entry: Entry; index: number; state: State; menu?: boolean } = $props()

  const agents = $derived(lib.agents.filter((a) => a.enabled))
  const stowed = $derived(entry.enabledFor.length === 0)
  const path = $derived(sourceLine(entry, lib.home))
  const kind = $derived({ local: 'Folder', github: 'Link', tessl: 'Registry' }[entry.source.type])
  const ready = $derived(lib.checks[sourceKey(entry.source) ?? '']?.state === 'ready')
  const icon = $derived(
    ({ local: 'folder', github: 'link', tessl: 'package' } as const)[entry.source.type]
  )

  const row = $derived(app.rowResult[entry.name])
  const reviewing = $derived(row === 'reviewing…')
  const fixing = $derived(row === 'fixing…')
  const saved = $derived(lib.reviews[entry.name])
  const fix = $derived(lib.fixes[entry.name])
  const manifest = $derived(lib.manifests[entry.name])
  // Files newer than the manifest: changed since the last publish (ADR 20261111-changed-since-publish).
  const edited = $derived(lib.edited[entry.name] !== undefined)
  const tipLines = $derived(
    manifest
      ? `Published to Tessl Registry\n${manifest.workspace}/${manifest.plugin}\nManifest version ${manifest.version}` +
          (edited ? '\nChanged since publish' : '')
      : ''
  )
  const tipLabel = $derived(
    manifest
      ? `Published to Tessl Registry: ${manifest.workspace}/${manifest.plugin}, manifest version ${manifest.version}` +
          (edited ? ', changed since publish' : '')
      : ''
  )

  const load = $derived(
    claudeEnabled(lib.synced, lib.agents) ? syncedLoad(lib.synced, entry.name) : 'none'
  )
  const syncedTip = $derived(
    load === 'loaded'
      ? 'Also synced from claude.ai.\nClaude Code loads the synced copy.\nOpen the skill for the fix.'
      : 'Also on claude.ai.\nClaude Code does not load the synced copy.'
  )

  function open(tab: 'briefing' | 'review' | 'fix' = 'briefing'): void {
    app.page = { name: 'skill', skill: entry.name, tab, from: 'loadout' }
  }

  function onclick(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('button, input, label, dialog, [popover]')) return
    open()
  }
</script>

<!-- The card name is a button, so the click handler here only adds a larger mouse target. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<article
  class="skill-card cut"
  class:stowed
  class:update={ready}
  class:broken={entry.status !== 'ok'}
  aria-label={entry.name}
  {onclick}
>
  <div class="card-top">
    <span class="card-top-id"
      ><span class="card-serial">{serial(index)}{stowed ? ' · STOWED' : ''}</span>
      {#if reviewing}
        <span class="card-status running">reviewing…</span>
      {:else if saved}
        <button
          class="card-review"
          aria-label={`Review ${entry.name}`}
          title={`Tessl review of ${entry.name}`}
          onclick={() => open('review')}
          ><span class="score {scoreTone(saved.score)}">{scoreText(saved.score)}</span> · {ago(
            saved.reviewedAt,
            app.now
          )}</button
        >
      {/if}
      {#if fixing}
        <span class="card-status running">fixing…</span>
      {:else if fix}
        <button
          class="card-review"
          aria-label={`Fix ${entry.name}`}
          title={`Tessl fix of ${entry.name}: keep or undo`}
          onclick={() => open('fix')}>{fixLabel(fix, app.now)}</button
        >
      {/if}
      {#if row && !reviewing && !fixing}
        <span class="card-status" class:running={isRunning(row)} title={row}>{row}</span>
      {/if}
      {#if ready}
        <button
          class="small amber card-intel"
          aria-label={`Intel for ${entry.name}`}
          title={`Intel for ${entry.name}`}
          onclick={() => open()}>↑ INTEL</button
        >
      {/if}
    </span>
    <span class="card-top-end">
      {#if load !== 'none'}
        <span class="tip card-synced" class:dimmed={load === 'not-loaded'}>
          <span
            role="img"
            aria-label={syncedTip.replaceAll('\n', ' ')}
            aria-describedby={`tip-synced-${entry.name}`}
            class="card-synced-icon"><Icon name="cloud-download" size={18} /></span
          >
          <span class="tip-text float" id={`tip-synced-${entry.name}`} role="tooltip"
            >{syncedTip}</span
          >
        </span>
      {/if}
      {#if manifest}
        <span class="tip card-tessl" class:edited>
          <span
            role="img"
            aria-label={tipLabel}
            aria-describedby={`tip-tessl-${entry.name}`}
            class="card-tessl-icon"><Icon name="package" size={18} /></span
          >
          <span class="tip-text float" id={`tip-tessl-${entry.name}`} role="tooltip"
            >{tipLines}</span
          >
        </span>
      {/if}
      <Rank count={entry.enabledFor.length} size={18} />
    </span>
  </div>
  <div class="card-main">
    <span class="tile {entry.source.type}" role="img" aria-label={kind}
      ><Icon name={icon} size={18} /></span
    >
    <div class="card-id">
      <button class="card-name" onclick={() => open()}>{entry.name}</button>
      <span class="card-path" title={path}>{path}</span>
    </div>
  </div>
  {#if entry.status === 'missing'}
    <span class="card-chip bad">MISSING</span>
  {:else if entry.status === 'not-a-link'}
    <span class="card-chip bad">NOT A LINK</span>
  {/if}
  <div class="card-foot">
    {#each agents as agent (agent.id)}
      {@const on = entry.enabledFor.includes(agent.id)}
      <label class="toggle">
        <input
          type="checkbox"
          aria-label={`${entry.name} ${agent.label}`}
          checked={on}
          disabled={lib.busy !== null || (entry.status !== 'ok' && !on)}
          onchange={(e) => toggle(entry.name, agent.id, e.currentTarget)}
        />
        <span>{agentCode(agent)}</span>
      </label>
    {/each}
    <span class="spacer"></span>
    {#if menu}<SkillMenu {entry} state={lib} />{/if}
  </div>
</article>
