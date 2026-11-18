<script lang="ts">
  import { displayPath } from '../../core/paths'
  import { MUSTER_LINE, type Entry, type State } from '../../core/ipc'
  import { api } from './api'
  import { INSTALL_HINTS, plural, versionNumber } from './format'
  import Icon from './Icon.svelte'
  import Tip from './Tip.svelte'
  import { app, report, togglePlatoon } from './state.svelte'

  let {
    state: lib,
    collapsible = false,
    onenlist
  }: { state: State; collapsible?: boolean; onenlist: () => void } = $props()

  const hidden = $derived(collapsible && app.platoonHidden)
  function slid(e: TransitionEvent): void {
    if (e.target === e.currentTarget) app.platoonSliding = false
  }

  const enabled = $derived(lib.agents.filter((a) => a.enabled))
  const tools = $derived(Object.entries(lib.startup.tools))
  const issued = (entry: Entry, id: string): boolean => entry.enabledFor.includes(id)
  // The kit slot under the pointer; its skill name shows in the one slot tip.
  let hovered = $state<{ agent: string; name: string } | null>(null)

  async function refresh(): Promise<void> {
    app.rowResult = {}
    report(await api.invoke('refresh'))
  }
</script>

<aside
  id="platoon"
  class="squad"
  class:hidden
  class:sliding={app.platoonSliding}
  aria-label="Platoon"
  inert={hidden}
  ontransitionend={slid}
  ontransitioncancel={slid}
>
  <div class="drag squad-drag">
    {#if collapsible}
      <Tip text="Hide platoon" end>
        <button
          class="icon squad-toggle"
          aria-label="Hide platoon"
          aria-controls="platoon"
          aria-expanded="true"
          onclick={togglePlatoon}><Icon name="panel-right" /></button
        >
      </Tip>
    {/if}
  </div>
  <div class="drag squad-head">
    <h2 class="squad-title">PLATOON</h2>
    <span class="squad-count"
      >{enabled.length} {plural(enabled.length, 'OPERATIVE', 'OPERATIVES')}</span
    >
  </div>
  {#each enabled as agent (agent.id)}
    {@const kit = lib.entries.filter((e) => issued(e, agent.id)).length}
    <section class="agent cut" aria-label={agent.label}>
      <div class="agent-head">
        <span class="agent-name">
          <strong>{agent.label}</strong>
          <span class="agent-folder">{displayPath(agent.folder, lib.home)}</span>
        </span>
        {#if lib.startup.mustering}
          <span class="chip muster">MUSTERING</span>
        {:else if lib.startup.tools[agent.command]}
          <span class="chip ok">READY</span>
        {:else}
          <Tip
            text={`${agent.command} is not found on this Mac. ${agent.label} loads its skills once it is installed; SYSTEMS below shows how.`}
            end
          >
            <span class="chip bad">NOT FOUND</span>
          </Tip>
        {/if}
      </div>
      <div class="kit-line">
        <span>KIT</span>
        <Tip
          text={`${kit} of the ${lib.entries.length} skills in your loadout ${kit === 1 ? 'is' : 'are'} deployed to ${agent.label}. Each square is one skill.`}
          place="above"
          end
        >
          <span><b>{kit}</b> / {lib.entries.length} SLOTS</span>
        </Tip>
      </div>
      <div class="slots">
        {#each lib.entries as entry (entry.name)}
          {#if issued(entry, agent.id)}
            <span
              class="slot {entry.source.type}"
              role="img"
              aria-label={entry.name}
              style:anchor-name={hovered?.agent === agent.id && hovered.name === entry.name
                ? '--slot-tip'
                : null}
              onpointerenter={() => (hovered = { agent: agent.id, name: entry.name })}
              onpointerleave={() => (hovered = null)}
            ></span>
          {:else}
            <span class="slot empty"></span>
          {/if}
        {/each}
      </div>
    </section>
  {:else}
    <div class="muted squad-none">No agent enabled.</div>
  {/each}
  {#if hovered}
    <span class="tip-text float slot-tip" role="tooltip">{hovered.name}</span>
  {/if}
  <button class="enlist" aria-label="Enlist agent" onclick={onenlist}>+ ENLIST AGENT</button>

  {#if lib.unmanaged.length > 0}
    <div class="recon-card">
      <span class="recon-label">RECON</span>
      <span class="recon-text"
        >{lib.unmanaged.length}
        {plural(lib.unmanaged.length, 'unmanaged skill', 'unmanaged skills')} identified.</span
      >
      <button class="recon-link" onclick={() => (app.page = { name: 'recon' })}>VIEW →</button>
    </div>
  {/if}

  <span class="spacer"></span>
  <div class="systems">
    <div class="systems-head">
      <span>SYSTEMS</span>
      <Tip text="Check git, tessl and the agents again, and rescan the folders" place="above" end>
        <button
          class="icon small-icon"
          aria-label="Refresh"
          onclick={refresh}
          disabled={lib.busy !== null}><Icon name="refresh" size={12} /></button
        >
      </Tip>
    </div>
    {#if lib.startup.mustering}
      <div class="muted muster-note">{MUSTER_LINE}</div>
    {/if}
    {#each tools as [name, tool] (name)}
      {#if tool}
        <div class="system">
          <span class="swatch"></span>
          <span class="system-name">{name}</span>{#if name === 'tessl' && lib.tesslUpdating}<span
              class="tool-updating">UPDATING</span
            >{/if}
          <span class="muted">{versionNumber(tool.version)}</span>
        </div>
      {:else}
        <div class="system bad">
          <span class="swatch off"></span>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <span class="tip" tabindex="0" aria-describedby={`tip-${name}`}>
            {name}
            {name in lib.startup.notRunning ? 'does not run' : 'not found'}
            <Icon name="info" size={12} />
            <span class="tip-text float" id={`tip-${name}`} role="tooltip"
              >{INSTALL_HINTS[name] ?? ''}</span
            >
          </span>
        </div>
      {/if}
    {/each}
    {#if lib.startup.pathSource === 'login-shell'}
      <div class="muted path-note">PATH from the login shell (interactive shell failed)</div>
    {:else if lib.startup.pathSource === 'inherited'}
      <div class="muted path-note">login shell PATH unavailable; using fallback folders</div>
    {/if}
    {#if lib.startup.tools.tessl}
      <div class="account">
        <span>TESSL ACCOUNT</span>
        <span>{lib.startup.tesslUser?.toUpperCase() ?? 'not logged in'}</span>
      </div>
    {/if}
  </div>
</aside>
