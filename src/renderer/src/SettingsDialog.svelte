<script lang="ts">
  import type { Appearance } from '../../core/config'
  import { LOADOUT_FOLDERS, MUSTER_LINE, type LoadoutFolder, type State } from '../../core/ipc'
  import { displayPath, pathsFrom } from '../../core/paths'
  import { api } from './api'
  import { INSTALL_HINTS } from './format'
  import Notice from './Notice.svelte'
  import Tip from './Tip.svelte'
  import { app, report } from './state.svelte'

  let { state: lib, dialog = $bindable() }: { state: State; dialog?: HTMLDialogElement } = $props()

  const busy = $derived(lib.busy !== null)
  // An agent or workspace save in flight: its controls wait, so the next change reads the saved state.
  let saving = $state(false)
  const tools = $derived(Object.entries(lib.startup.tools))
  const paths = $derived(pathsFrom(lib.home))
  const folderLabels: Record<LoadoutFolder, string> = {
    config: 'Config',
    library: 'Loadout links',
    repos: 'Link clones',
    tesslPlugins: 'Tessl plugins'
  }
  const pathSources: Record<State['startup']['pathSource'], string> = {
    'interactive-shell': 'PATH from the interactive login shell',
    'login-shell': 'PATH from the login shell (interactive shell failed)',
    inherited: 'login shell PATH unavailable; using fallback folders'
  }
  // `--version` output differs per tool ("2.1.319 (Claude Code)", "codex-cli 0.163.0").
  const versionNumber = (raw: string): string => /\d+(?:\.\d+)+/.exec(raw)?.[0] ?? raw

  // Fetched each time the dialog opens; the picked ones show even when the fetch fails.
  let fetched = $state<string[]>([])
  let workspaceNote = $state<string | null>(null)
  const shownWorkspaces = $derived([
    ...lib.tesslWorkspaces,
    ...fetched.filter((name) => !lib.tesslWorkspaces.includes(name))
  ])

  async function loadWorkspaces(): Promise<void> {
    workspaceNote = 'Loading your Tessl workspaces…'
    const result = await api.invoke('list-workspaces')
    if (result.ok) {
      fetched = result.workspaces.map((w) => w.name)
      workspaceNote = result.workspaces.length === 0 ? 'Your Tessl account has no workspace.' : null
    } else workspaceNote = result.message
  }

  async function saveWorkspaces(workspaces: string[], chosen: string): Promise<void> {
    saving = true
    try {
      report(await api.invoke('set-workspaces', { workspaces, default: chosen }))
    } finally {
      saving = false
    }
  }

  function toggleWorkspace(name: string, on: boolean): void {
    const workspaces = on
      ? [...lib.tesslWorkspaces, name]
      : lib.tesslWorkspaces.filter((w) => w !== name)
    // Unchecking the default moves it to the first workspace left, or clears it.
    const chosen = workspaces.includes(lib.tesslWorkspace)
      ? lib.tesslWorkspace
      : (workspaces[0] ?? '')
    void saveWorkspaces(workspaces, chosen)
  }

  function makeDefault(name: string): void {
    const workspaces = lib.tesslWorkspaces.includes(name)
      ? lib.tesslWorkspaces
      : [...lib.tesslWorkspaces, name]
    void saveWorkspaces(workspaces, name)
  }

  async function setAppearance(appearance: Appearance): Promise<void> {
    report(await api.invoke('set-appearance', { appearance }))
  }

  async function refresh(): Promise<void> {
    app.rowResult = {}
    report(await api.invoke('refresh'))
  }
</script>

<dialog
  bind:this={dialog}
  class="cover settings"
  ontoggle={(e) => {
    if (e.newState === 'open') void loadWorkspaces()
  }}
>
  <div class="dialog-drag"></div>
  <div class="dialog-box">
    <h2 class="title">SETTINGS</h2>
    <Notice />

    <section class="settings-section" aria-label="Agents">
      <h3 class="settings-head">PLATOON · AGENTS</h3>
      <div class="agent-list">
        {#each lib.agents as agent, i (agent.id)}
          <div class="agent-row">
            <span class="agent-label">{agent.label}</span>
            <span class="grow mono muted">{displayPath(agent.folder, lib.home)}</span>
            <!-- The first switch takes the focus on open, also when the box scrolls (a scrolling box is focusable). -->
            <!-- svelte-ignore a11y_autofocus -->
            <input
              autofocus={i === 0}
              type="checkbox"
              class="switch"
              aria-label={`Enable ${agent.label}`}
              checked={agent.enabled}
              disabled={busy || saving}
              onchange={async (e) => {
                const box = e.currentTarget
                saving = true
                try {
                  const result = await api.invoke('set-agent-enabled', {
                    agentId: agent.id,
                    on: box.checked
                  })
                  report(result)
                  if (!result.ok) box.checked = agent.enabled
                } finally {
                  saving = false
                }
              }}
            />
          </div>
        {/each}
      </div>
    </section>

    <section class="settings-section" aria-label="Tessl">
      <h3 class="settings-head">TESSL</h3>
      <div class="settings-rows">
        <div class="settings-row">
          <span class="settings-name">Account</span>
          <span class="grow mono muted"
            >{lib.startup.tools.tessl
              ? (lib.startup.tesslUser ?? 'not logged in')
              : 'tessl not found'}</span
          >
        </div>
      </div>
      <div class="settings-rows" role="group" aria-label="Workspaces">
        {#each shownWorkspaces as name (name)}
          {@const picked = lib.tesslWorkspaces.includes(name)}
          <div class="settings-row">
            <label class="workspace-pick">
              <input
                type="checkbox"
                checked={picked}
                disabled={busy || saving}
                onchange={(e) => toggleWorkspace(name, e.currentTarget.checked)}
              />
              <span class="mono">{name}</span>
            </label>
            <span class="grow"></span>
            <label class="workspace-default">
              <input
                type="radio"
                name="default-workspace"
                aria-label={`Default workspace ${name}`}
                checked={lib.tesslWorkspace === name}
                disabled={busy || saving}
                onchange={() => makeDefault(name)}
              />
              <span>DEFAULT</span>
            </label>
          </div>
        {/each}
      </div>
      {#if workspaceNote}<span class="muted small-note">{workspaceNote}</span>{/if}
      <span class="muted small-note"
        >Review and Fix use the default workspace; Publish offers the checked ones.</span
      >
    </section>

    <section class="settings-section" aria-label="Appearance">
      <fieldset class="segmented">
        <legend class="settings-head">APPEARANCE</legend>
        <div class="seg">
          {#each [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']] as const as [value, label] (value)}
            <label>
              <input
                type="radio"
                name="appearance"
                {value}
                checked={lib.appearance === value}
                onchange={() => setAppearance(value)}
              />
              {label}
            </label>
          {/each}
        </div>
      </fieldset>
    </section>

    <section class="settings-section" aria-label="Systems">
      <div class="settings-head-row">
        <h3 class="settings-head">SYSTEMS</h3>
        <button class="small settings-btn" onclick={refresh} disabled={busy}>Refresh</button>
      </div>
      {#if lib.startup.mustering}
        <span class="muted small-note">{MUSTER_LINE}</span>
      {:else}
        <div class="settings-rows">
          {#each tools as [name, tool] (name)}
            <div class="settings-row">
              <span class="settings-name">{name}</span>
              {#if tool}
                <Tip text={tool.path} overflow
                  ><span class="grow mono muted">{displayPath(tool.path, lib.home)}</span></Tip
                >
                <span class="mono">{versionNumber(tool.version)}</span>
              {:else}
                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <span class="tip bad" tabindex="0" aria-describedby={`settings-tip-${name}`}
                  >{name in lib.startup.notRunning ? 'does not run' : 'not found'}<span
                    class="tip-text float"
                    id={`settings-tip-${name}`}
                    role="tooltip">{INSTALL_HINTS[name] ?? ''}</span
                  ></span
                >
              {/if}
            </div>
          {/each}
        </div>
        <span class="muted small-note">{pathSources[lib.startup.pathSource]}</span>
      {/if}
    </section>

    <section class="settings-section" aria-label="Folders">
      <h3 class="settings-head">FOLDERS</h3>
      <div class="settings-rows">
        {#each LOADOUT_FOLDERS as folder (folder)}
          <div class="settings-row">
            <span class="settings-name">{folderLabels[folder]}</span>
            <span class="grow mono muted">{displayPath(paths[folder], lib.home)}</span>
            <button
              class="small settings-btn"
              aria-label={`Reveal ${folderLabels[folder]}`}
              onclick={async () => report(await api.invoke('reveal-folder', { folder }))}
              >Reveal</button
            >
          </div>
        {/each}
      </div>
    </section>

    <div class="actions">
      <button onclick={() => dialog?.close()}>Close</button>
    </div>
  </div>
</dialog>
