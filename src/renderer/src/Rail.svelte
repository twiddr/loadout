<script lang="ts">
  import { api } from './api'
  import Icon, { type IconName } from './Icon.svelte'
  import Logo from './Logo.svelte'
  import Tip from './Tip.svelte'
  import { sourceGroups } from './format'
  import { app, openBriefing, report, type Page } from './state.svelte'

  const intelCount = $derived(
    app.state
      ? sourceGroups(app.state.entries, app.state.checks).filter((g) => g.check?.state === 'ready')
          .length
      : 0
  )
  const mustering = $derived(app.state?.startup.mustering ?? true)
  const busy = $derived(app.state?.busy != null && !mustering)

  const tabs: {
    name: Exclude<Page['name'], 'skill' | 'candidate'>
    label: string
    icon: IconName
  }[] = [
    { name: 'loadout', label: 'LOADOUT', icon: 'layout-grid' },
    { name: 'intel', label: 'INTEL', icon: 'radio-tower' },
    { name: 'recon', label: 'RECON', icon: 'crosshair' },
    { name: 'log', label: 'LOG', icon: 'align-left' },
    { name: 'bootcamp', label: 'BOOT CAMP', icon: 'flag' }
  ]
  let { onsettings }: { onsettings: () => void } = $props()

  // The button shows the appearance it switches to; main sets nativeTheme and saves the choice.
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
  let dark = $state(darkQuery.matches)
  darkQuery.addEventListener('change', () => (dark = darkQuery.matches))
  const appearanceLabel = $derived(
    dark ? 'Switch to light appearance' : 'Switch to dark appearance'
  )

  async function toggleAppearance(): Promise<void> {
    const result = await api.invoke('set-appearance', { appearance: dark ? 'light' : 'dark' })
    if (!result.ok) report(result)
  }

  // A skill page belongs to the tab it was opened from; a candidate page to RECON.
  const current = $derived(
    app.page.name === 'skill'
      ? app.page.from
      : app.page.name === 'candidate'
        ? 'recon'
        : app.page.name
  )
</script>

<nav class="rail" aria-label="Main">
  <div class="drag rail-drag"></div>
  <div class="rail-logo"><Logo size={28} /></div>
  {#each tabs as tab (tab.name)}
    {#if tab.name === 'bootcamp'}<span class="rail-sep" aria-hidden="true"></span>{/if}
    <!-- With updates waiting, the INTEL tab's tip counts them. -->
    <Tip
      text={tab.name === 'intel' && intelCount > 0
        ? `${intelCount} ${intelCount === 1 ? 'source has an update' : 'sources have updates'}`
        : ''}
      place="side"
    >
      <a
        href={`#${tab.name}`}
        class="rail-tab"
        class:on={current === tab.name}
        aria-current={current === tab.name ? 'page' : undefined}
        onclick={(e) => {
          e.preventDefault()
          app.page = { name: tab.name }
          // LOADOUT always lands on the SKILLS / PACKS page; the mouse back button still reopens the pack.
          if (tab.name === 'loadout') app.pack = null
        }}
      >
        <Icon name={tab.icon} size={19} />{tab.label}
        {#if tab.name === 'intel' && intelCount > 0}
          <span class="rail-badge">{intelCount}</span>
        {/if}
        {#if tab.name === 'log' && busy}
          <span class="rail-dot" aria-hidden="true"></span>
        {/if}
      </a>
    </Tip>
  {/each}
  <span class="spacer"></span>
  <Tip text={appearanceLabel} place="side">
    <button class="icon appearance" aria-label={appearanceLabel} onclick={toggleAppearance}
      ><Icon name={dark ? 'sun' : 'moon'} size={16} /></button
    >
  </Tip>
  <Tip text="Briefing" place="side">
    <button class="icon" aria-label="Briefing" onclick={() => openBriefing(false)}
      ><Icon name="circle-help" size={16} /></button
    >
  </Tip>
  <Tip text="Settings" place="side">
    <button class="icon rail-settings" aria-label="Settings" onclick={onsettings}
      ><Icon name="settings" size={15} /></button
    >
  </Tip>
  <Tip
    text={mustering
      ? 'Checking git, tessl and the agents on this Mac.\nCommands wait until the check ends.'
      : busy
        ? 'A command is running.\nThe Log shows its output.'
        : ''}
    place="side"
  >
    <span class="rail-status" class:busy={busy || mustering}
      >{mustering ? 'MUSTERING' : busy ? 'BUSY' : 'READY'}</span
    >
  </Tip>
</nav>
