<script lang="ts">
  import { api } from './api'
  import Icon, { type IconName } from './Icon.svelte'
  import Logo from './Logo.svelte'
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

  const tabs: { name: Exclude<Page['name'], 'skill'>; label: string; icon: IconName }[] = [
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

  // A skill page belongs to the tab it was opened from.
  const current = $derived(app.page.name === 'skill' ? app.page.from : app.page.name)
</script>

<nav class="rail" aria-label="Main">
  <div class="drag rail-drag"></div>
  <div class="rail-logo"><Logo size={28} /></div>
  {#each tabs as tab (tab.name)}
    {#if tab.name === 'bootcamp'}<span class="rail-sep" aria-hidden="true"></span>{/if}
    <a
      href={`#${tab.name}`}
      class="rail-tab"
      class:on={current === tab.name}
      aria-current={current === tab.name ? 'page' : undefined}
      onclick={(e) => {
        e.preventDefault()
        app.page = { name: tab.name }
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
  {/each}
  <span class="spacer"></span>
  <button
    class="icon appearance"
    aria-label={appearanceLabel}
    title={appearanceLabel}
    onclick={toggleAppearance}><Icon name={dark ? 'sun' : 'moon'} size={16} /></button
  >
  <button class="icon" aria-label="Briefing" title="Briefing" onclick={() => openBriefing(false)}
    ><Icon name="circle-help" size={16} /></button
  >
  <button class="icon rail-settings" aria-label="Settings" title="Settings" onclick={onsettings}
    ><Icon name="settings" size={15} /></button
  >
  <span class="rail-status" class:busy={busy || mustering}
    >{mustering ? 'MUSTERING' : busy ? 'BUSY' : 'READY'}</span
  >
</nav>
