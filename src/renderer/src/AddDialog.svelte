<script lang="ts">
  import { sourceKey } from '../../core/checks'
  import type { Candidate, RegistryPlugin, Workspace } from '../../core/ipc'
  import { api } from './api'
  import { addedText, agentCode } from './format'
  import Icon from './Icon.svelte'
  import Tip from './Tip.svelte'
  import { app, report, setRow } from './state.svelte'

  let {
    kind,
    busy,
    dialog = $bindable()
  }: { kind: 'github' | 'tessl'; busy: boolean; dialog?: HTMLDialogElement } = $props()

  let repo = $state('')
  let message = $state<string | null>(null)
  let root = $state('')
  /** The source key of the scanned link or plugin. */
  let scanned = $state<string | null>(null)
  let candidates = $state<Candidate[] | null>(null)
  let ticked = $state<Record<string, boolean>>({})
  let adding = $state(false)
  /** The agents ticked in the footer; Add deploys the added skills to them. */
  let deployTo = $state<Record<string, boolean>>({})
  const agents = $derived((app.state?.agents ?? []).filter((a) => a.enabled))
  const id = $props.id()

  // The Registry browse (kind 'tessl'): the memberships, the shown workspace and its plugins.
  let workspaces = $state<Workspace[]>([])
  let workspace = $state<Workspace | null>(null)
  let plugins = $state<RegistryPlugin[]>([])
  let listNote = $state<string | null>(null)
  /** Counts loads and closes; a load whose number is no longer current drops its answer. */
  let listId = 0

  const inLibrary = $derived(
    new Set((app.state?.entries ?? []).map((entry) => sourceKey(entry.source)))
  )
  const shown = $derived(plugins.filter((p) => p.hasSkills))
  /** Library skills recruited from the scanned source: their rows show ticked. */
  const owned = $derived(
    new Set(
      (app.state?.entries ?? [])
        .filter((entry) => scanned !== null && sourceKey(entry.source) === scanned)
        .map((entry) => entry.name)
    )
  )

  async function loadWorkspaces(): Promise<void> {
    const load = ++listId
    listNote = 'Loading your Tessl workspaces…'
    const result = await api.invoke('list-workspaces')
    if (load !== listId) return
    if (!result.ok) {
      listNote = result.message
      return
    }
    workspaces = result.workspaces
    const chosen =
      workspaces.find((w) => w.name === app.state?.tesslWorkspace) ?? workspaces[0] ?? null
    if (chosen === null) {
      listNote = 'Your Tessl account has no workspace.'
      return
    }
    await pickWorkspace(chosen)
  }

  async function pickWorkspace(chosen: Workspace): Promise<void> {
    const load = ++listId
    workspace = chosen
    plugins = []
    listNote = `Loading the plugins of ${chosen.name}…`
    const result = await api.invoke('list-plugins', { workspace: $state.snapshot(chosen) })
    if (load !== listId) return
    if (!result.ok) {
      listNote = result.message
      return
    }
    plugins = result.plugins
    listNote = plugins.some((p) => p.hasSkills) ? null : `No plugin with skills in ${chosen.name}.`
  }

  /** The dropdown is a shortcut for typing: it fills the field, and Scan stays the user's step. */
  function pick(plugin: RegistryPlugin): void {
    repo = `${plugin.workspace}/${plugin.plugin}`
    forget()
  }

  const names = $derived(
    Object.entries(ticked)
      .filter(([, on]) => on)
      .map(([name]) => name)
  )

  /** The names the scan offers: candidates with a name and no reason to refuse them. */
  const addable = $derived(
    (candidates ?? []).flatMap((c) => (c.disabled === null && c.name !== null ? [c.name] : []))
  )
  const tickedCount = $derived(addable.filter((name) => ticked[name] === true).length)

  /** The header checkbox ticks every addable skill, or clears them all. */
  function tickAll(on: boolean): void {
    ticked = on ? Object.fromEntries(addable.map((name) => [name, true])) : {}
  }

  /** Counts scans and closes; a scan whose number is no longer current drops its result. */
  let scanId = 0

  async function scan(): Promise<void> {
    const id = ++scanId
    message = null
    candidates = null
    const result =
      kind === 'github'
        ? await api.invoke('scan-github', { repo })
        : await api.invoke('scan-tessl', { plugin: repo })
    if (id !== scanId) return
    if (!result.ok) {
      message = result.message ?? 'The scan failed.'
      return
    }
    root = result.root
    scanned = result.key
    candidates = result.candidates
    ticked = {}
  }

  async function add(): Promise<void> {
    adding = true
    try {
      const result = await api.invoke('add-candidates', {
        root,
        names,
        agents: agents.filter((a) => deployTo[a.id] === true).map((a) => a.id)
      })
      if (!result.ok) {
        message = result.message ?? 'The action failed.'
        return
      }
      report(result)
      for (const name of result.added) setRow(name, addedText(result.lint[name] ?? 'ok'))
      if (result.refused.length > 0) {
        app.notice = `Added, but not deployed: ${result.refused.map((r) => `${r.skill}: ${r.message}`).join('; ')}`
      }
      dialog?.close()
    } finally {
      adding = false
    }
  }

  /** Opens the dialog on `value` (a link or a plugin) and scans it at once. */
  export function scanSource(value: string): void {
    repo = value
    dialog?.showModal()
    void scan()
  }

  /** Drops the results and any running scan, so Add never uses a scan of other input. */
  function forget(): void {
    scanId++
    message = null
    scanned = null
    candidates = null
    ticked = {}
  }

  function reset(): void {
    forget()
    repo = ''
    deployTo = {}
    listId++
    workspaces = []
    workspace = null
    plugins = []
    listNote = null
  }
</script>

<dialog
  class="cover scan"
  bind:this={dialog}
  onclose={reset}
  ontoggle={(e) => {
    if (e.newState === 'open' && kind === 'tessl') void loadWorkspaces()
  }}
>
  <div class="dialog-drag"></div>
  <div class="dialog-box">
    <h2 class="title">{kind === 'github' ? 'RECRUIT SKILL · LINK' : 'RECRUIT SKILL · REGISTRY'}</h2>
    {#if kind === 'tessl' && workspace !== null}
      <div class="field-label">
        <span class="label" id="add-workspace-label-{id}">Workspace</span>
        <div>
          <button
            class="select"
            aria-labelledby="add-workspace-label-{id}"
            aria-haspopup="menu"
            popovertarget="add-workspace-{id}"
            style:anchor-name="--add-workspace-{id}"
            ><span class="select-value">{workspace.name}</span><Icon
              name="chevron-down"
              size={12}
            /></button
          >
          <div
            popover
            id="add-workspace-{id}"
            class="menu-pop float select-pop"
            role="menu"
            style:position-anchor="--add-workspace-{id}"
          >
            {#each workspaces as option (option.id)}
              <button
                role="menuitemradio"
                aria-checked={option.id === workspace.id}
                popovertarget="add-workspace-{id}"
                popovertargetaction="hide"
                onclick={() => {
                  if (option.id !== workspace?.id) void pickWorkspace(option)
                }}
                ><span class="select-value">{option.name}</span
                >{#if option.id === workspace.id}<Icon name="check" size={12} />{/if}</button
              >
            {/each}
          </div>
        </div>
      </div>
    {/if}
    <div class="field-label">
      <label class="label" for="add-repo-{kind}"
        >{kind === 'github' ? 'GitHub link' : 'Tessl plugin'}</label
      >
      <div class="field-row">
        <div class="combo" style:anchor-name="--add-plugins-{id}">
          <input
            id="add-repo-{kind}"
            type="text"
            placeholder={kind === 'github' ? 'https://github.com/owner/repo' : 'workspace/plugin'}
            bind:value={repo}
            oninput={forget}
          />
          {#if kind === 'tessl'}
            <button
              class="icon combo-open"
              aria-label="Plugins of the workspace"
              aria-haspopup="menu"
              popovertarget="add-plugins-{id}"><Icon name="chevron-down" size={12} /></button
            >
          {/if}
        </div>
        <button class="same-w" onclick={scan} disabled={busy || repo.trim() === ''}>Scan</button>
      </div>
      {#if kind === 'tessl'}
        <div
          popover
          id="add-plugins-{id}"
          class="menu-pop float select-pop plugin-list"
          role="menu"
          style:position-anchor="--add-plugins-{id}"
        >
          {#if listNote}
            <p class="muted small-note plugin-note">{listNote}</p>
          {:else}
            {#each shown as plugin (`${plugin.workspace}/${plugin.plugin}`)}
              {@const taken = inLibrary.has(`tessl:${plugin.workspace}/${plugin.plugin}`)}
              <button
                role="menuitem"
                class="plugin-row"
                disabled={taken}
                popovertarget="add-plugins-{id}"
                popovertargetaction="hide"
                onclick={() => pick(plugin)}
              >
                <span class="plugin-name">{plugin.plugin}</span>
                <span class="plugin-version">{plugin.version ?? ''}</span>
                <span class="plugin-fill"></span>
                {#if taken}<span class="plugin-taken">in library</span>{/if}
              </button>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
    {#if message}
      <p class="notice" role="alert">{message}</p>
    {/if}
    {#if candidates}
      <div class="box">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Add all skills"
                  disabled={addable.length === 0}
                  checked={addable.length > 0 && tickedCount === addable.length}
                  indeterminate={tickedCount > 0 && tickedCount < addable.length}
                  onchange={(e) => tickAll(e.currentTarget.checked)}
                />
              </th>
              <th>Folder</th>
              <th>Skill</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {#each candidates as candidate (candidate.subpath)}
              <tr>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Add ${candidate.subpath || '.'}`}
                    disabled={candidate.disabled !== null || candidate.name === null}
                    checked={candidate.name !== null &&
                      (owned.has(candidate.name) ||
                        (candidate.disabled === null && ticked[candidate.name] === true))}
                    onchange={(e) => {
                      if (candidate.name !== null) ticked[candidate.name] = e.currentTarget.checked
                    }}
                  />
                </td>
                <td
                  class="mono"
                  class:muted={candidate.disabled !== null || candidate.name === null}
                  >{candidate.subpath || '.'}</td
                >
                <td>{candidate.name ?? ''}</td>
                <td class="muted">{candidate.disabled ?? ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    <div class="actions">
      {#if candidates && agents.length > 0}
        <div class="deploy-to">
          <span class="muted">Deploy to</span>
          {#each agents as agent (agent.id)}
            <Tip text={agent.label} place="above">
              <label class="toggle">
                <input
                  type="checkbox"
                  aria-label={`Deploy to ${agent.label}`}
                  bind:checked={deployTo[agent.id]}
                />
                <span>{agentCode(agent)}</span>
              </label>
            </Tip>
          {/each}
        </div>
      {/if}
      {#if busy}
        <button onclick={() => api.invoke('cancel')}>Cancel</button>
      {/if}
      <button onclick={() => dialog?.close()}>Close</button>
      {#if candidates}
        <button class="primary" onclick={add} disabled={busy || adding || names.length === 0}
          >Add</button
        >
      {/if}
    </div>
  </div>
</dialog>
