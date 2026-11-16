<script lang="ts">
  import BootCampPage from './BootCampPage.svelte'
  import BriefingDialog from './BriefingDialog.svelte'
  import CandidatePage from './CandidatePage.svelte'
  import FixDialog from './FixDialog.svelte'
  import Icon from './Icon.svelte'
  import ForkDialog from './ForkDialog.svelte'
  import IntelPage from './IntelPage.svelte'
  import LoadoutPage from './LoadoutPage.svelte'
  import LogPage from './LogPage.svelte'
  import PublishDialog from './PublishDialog.svelte'
  import RecruitDialog from './RecruitDialog.svelte'
  import ReconPage from './ReconPage.svelte'
  import Rail from './Rail.svelte'
  import RemoveDialog from './RemoveDialog.svelte'
  import SettingsDialog from './SettingsDialog.svelte'
  import UnpublishDialog from './UnpublishDialog.svelte'
  import UpdateDialog from './UpdateDialog.svelte'
  import UpdatePrompt from './UpdatePrompt.svelte'
  import SkillPage from './SkillPage.svelte'
  import SquadPanel from './SquadPanel.svelte'
  import { sourceKey } from '../../core/checks'
  import { confirmRemove, confirmRemovePack, publish, runFix, unpublish } from './actions'
  import { api } from './api'
  import { backFrom, visit } from './history'
  import {
    app,
    load,
    recruitDialog,
    report,
    tesslDialogs,
    togglePlatoon,
    type Page
  } from './state.svelte'
  import { untrack } from 'svelte'

  let settingsDialog = $state<HTMLDialogElement>()
  let updateDialog = $state<HTMLDialogElement>()
  let updatePrompt = $state<HTMLDialogElement>()

  void load()

  async function retry(): Promise<void> {
    report(await api.invoke('refresh'))
    await load()
  }

  // The mouse back button returns to the page and open pack seen before. A plain stack, not reactive state.
  type Spot = Page & { pack: string | null }
  const back: Spot[] = []
  let shown: Spot = { ...app.page, pack: app.pack }
  let goingBack = false
  $effect(() => {
    const spot: Spot = { ...app.page, pack: app.pack }
    untrack(() => {
      if (goingBack) goingBack = false
      else visit(back, shown, spot)
      shown = spot
    })
  })

  /** Returns to the page seen before; a modal dialog keeps the page behind it as it is. */
  function goBack(): void {
    if (document.querySelector('dialog[open]')) return
    const exists = (skill: string): boolean =>
      app.state?.entries.some((x) => x.name === skill) ?? false
    const packExists = (key: string): boolean =>
      app.state?.packs.some((p) => p.key === key) ?? false
    const candidateExists = (agentId: string, entry: string): boolean =>
      app.state?.unmanaged.some(
        (u) => u.agentId === agentId && u.name === entry && u.recruit.kind === 'recruit'
      ) ?? false
    // SKILLS always shows the flat view, so a step back there drops its pack.
    const flat = app.state?.loadoutView === 'skills'
    const spot = backFrom(back, shown, exists, packExists, candidateExists, flat)
    if (!spot) return
    const { pack, ...page } = spot
    goingBack = true
    app.page = page
    app.pack = pack
  }

  // Button 3 is a mouse's back button; Logi Options+ sends Back as a swipe instead, which main forwards.
  function onmouseup(e: MouseEvent): void {
    if (e.button !== 3) return
    e.preventDefault()
    goBack()
  }
  api.on('back', goBack)

  // UPDATE ›, the menu's Check for Updates… and the prompt's UPDATE open the same dialog.
  function openUpdate(): void {
    updatePrompt?.close()
    if (!updateDialog?.open) updateDialog?.showModal()
  }
  api.on('open-app-update', openUpdate)

  // A launch or noon check found a newer release; the prompt never opens over another dialog.
  api.on('prompt-app-update', () => {
    if (app.state?.appUpdate && !document.querySelector('dialog[open]')) updatePrompt?.showModal()
  })

  const eyebrow = $derived(app.state?.startup.tesslUser?.toUpperCase() ?? null)

  // A state push can remove the dialogs' skill; close them rather than leave a button that does nothing.
  $effect(() => {
    const lib = app.state
    if (!lib) return
    const gone = tesslDialogs.pack
      ? !lib.packs.some((p) => p.key === tesslDialogs.pack)
      : !lib.entries.some((e) => e.name === tesslDialogs.skill)
    if (gone) {
      tesslDialogs.fix?.close()
      tesslDialogs.publish?.close()
      tesslDialogs.remove?.close()
      tesslDialogs.fork?.close()
      tesslDialogs.unpublish?.close()
    }
  })
</script>

<svelte:window {onmouseup} />

<div class="shell">
  <Rail onsettings={() => settingsDialog?.showModal()} />
  {#if app.state}
    {@const state = app.state}
    {#if app.page.name === 'bootcamp'}
      <BootCampPage {state} {eyebrow} onsettings={() => settingsDialog?.showModal()} />
    {:else}
      <section class="main-col">
        {#if app.page.name === 'loadout'}
          <LoadoutPage {state} {eyebrow} />
        {:else if app.page.name === 'intel'}
          <IntelPage {state} {eyebrow} />
        {:else if app.page.name === 'recon'}
          <ReconPage {state} {eyebrow} />
        {:else if app.page.name === 'log'}
          <LogPage {state} {eyebrow} />
        {:else if app.page.name === 'candidate'}
          <CandidatePage {state} agentId={app.page.agentId} entry={app.page.entry} />
        {:else if app.page.name === 'skill'}
          <SkillPage {state} skill={app.page.skill} tab={app.page.tab} from={app.page.from} />
        {/if}
      </section>
      {#if app.page.name === 'loadout' || app.page.name === 'skill'}
        <SquadPanel
          {state}
          collapsible={app.page.name === 'skill'}
          onenlist={() => settingsDialog?.showModal()}
        />
      {/if}
    {/if}
  {:else if app.notice}
    <section class="main-col">
      <div class="load-error-body">
        <p class="notice" role="alert">{app.notice}</p>
        <button onclick={retry}>Refresh</button>
      </div>
    </section>
  {:else}
    <section class="main-col"><p class="note">Loading…</p></section>
  {/if}
</div>
<!-- After .shell: Chromium lets a later drag region win, so the Show platoon button must follow the page's drag strips. -->
<div class="app-corner">
  {#if app.state && app.page.name === 'skill' && app.platoonHidden}
    <button
      class="icon platoon-show"
      aria-label="Show platoon"
      title="Show platoon"
      aria-controls="platoon"
      aria-expanded="false"
      onclick={togglePlatoon}><Icon name="panel-right" /></button
    >
  {/if}
  {#if app.state?.appUpdate}
    {@const latest = app.state.appUpdate.latest}
    <span class="app-version">{__APP_VERSION__} → {latest}</span>
    <button type="button" class="app-update" aria-label="Update to {latest}" onclick={openUpdate}
      >UPDATE<span aria-hidden="true">›</span></button
    >
  {:else}
    <span class="app-version">{__APP_VERSION__}</span>
  {/if}
</div>
{#if app.state}
  {@const lib = app.state}
  {@const busy = lib.busy !== null}
  {@const entry = lib.entries.find((e) => e.name === tesslDialogs.skill) ?? null}
  {@const pack = lib.packs.find((p) => p.key === tesslDialogs.pack) ?? null}
  {@const packMembers = pack ? lib.entries.filter((e) => sourceKey(e.source) === pack.key) : []}
  <SettingsDialog state={lib} bind:dialog={settingsDialog} />
  <BriefingDialog />
  <UpdateDialog bind:dialog={updateDialog} />
  <UpdatePrompt bind:dialog={updatePrompt} onupdate={openUpdate} />
  <FixDialog
    bind:dialog={tesslDialogs.fix}
    {entry}
    tesslUser={lib.startup.tesslUser}
    home={lib.home}
    {busy}
    onrun={() => entry && runFix(entry)}
  />
  <RemoveDialog
    bind:dialog={tesslDialogs.remove}
    {entry}
    entries={lib.entries}
    {pack}
    members={packMembers}
    home={lib.home}
    {busy}
    onremove={() => (pack ? confirmRemovePack(pack) : entry && confirmRemove(entry))}
  />
  <PublishDialog
    bind:dialog={tesslDialogs.publish}
    name={tesslDialogs.skill}
    workspace={lib.tesslWorkspace}
    workspaces={lib.tesslWorkspaces}
    manifest={lib.manifests[tesslDialogs.skill] ?? null}
    folder={entry?.target ?? ''}
    home={lib.home}
    gitFound={lib.startup.tools.git !== null}
    {busy}
    onpublish={(bump, workspace, commit) => entry && publish(entry, bump, workspace, commit)}
  />
  <UnpublishDialog
    bind:dialog={tesslDialogs.unpublish}
    name={tesslDialogs.skill}
    manifest={lib.manifests[tesslDialogs.skill] ?? null}
    folder={entry?.target ?? ''}
    home={lib.home}
    {busy}
    onunpublish={() => entry && unpublish(entry)}
  />
  <ForkDialog bind:dialog={tesslDialogs.fork} {entry} home={lib.home} {busy} />
  <!-- Given null once its row or backup leaves the state, the dialog closes itself. -->
  <RecruitDialog
    bind:dialog={recruitDialog.dialog}
    row={recruitDialog.view === 'recruit'
      ? (lib.unmanaged.find(
          (u) => u.agentId === recruitDialog.agentId && u.name === recruitDialog.entry
        ) ?? null)
      : null}
    backup={recruitDialog.view === 'undo'
      ? (lib.backups.find(
          (b) => b.agentId === recruitDialog.agentId && b.entry === recruitDialog.entry
        ) ?? null)
      : null}
    agents={lib.agents}
    home={lib.home}
    {busy}
  />
{/if}
