<script lang="ts">
  import type { State } from '../../core/ipc'
  import { bootcampStatus, effectiveStartup, folderLine, rankWord, toolStatus } from './bootcamp'
  import { checkAgain, openTerminal } from './bootcamp/actions'
  import { CAMO_GROUND, CAMO_TILE, CAMO_TILES } from './bootcamp/camo'
  import CommandBox from './bootcamp/CommandBox.svelte'
  import InstallBlock from './bootcamp/InstallBlock.svelte'
  import { api } from './api'
  import { INSTALL_COMMANDS, LOGIN_COMMANDS, versionNumber } from './format'
  import type { InstallTool } from './format'
  import Icon from './Icon.svelte'
  import Notice from './Notice.svelte'
  import PageHeader from './PageHeader.svelte'
  import { displayPath } from '../../core/paths'
  import { app, report } from './state.svelte'

  let {
    state: lib,
    eyebrow,
    onsettings
  }: { state: State; eyebrow: string | null; onsettings: () => void } = $props()

  // The page shows the last completed check while a later one runs.
  const startup = $derived(effectiveStartup(lib.startup, app.lastStartup))
  const known = $derived({ ...lib, startup })
  const status = $derived(bootcampStatus(known))
  /** Only the first check after launch: no state is known yet. */
  const checking = $derived(startup.mustering)
  const busy = $derived(lib.busy !== null)

  // At 1200 px and wider the rank badge in the right column carries the progress; below, the header meter does.
  const wideQuery = window.matchMedia('(min-width: 1200px)')
  let wide = $state(wideQuery.matches)
  wideQuery.addEventListener('change', () => (wide = wideQuery.matches))
  const count = $derived(`${status.done} OF 3 DONE`)
  // The line never changes length on enlisting, so the page does not jump.
  const line = $derived(wide ? '' : count)

  const GIT_PLACEHOLDER =
    "On a Mac without Apple's command line developer tools, /usr/bin/git is a placeholder. Installing the tools gives you git."

  type Chip = { text: string; cls: string }
  function chip(done: boolean, optional = false, check = false): Chip {
    if (done) return { text: 'DONE', cls: 'ok' }
    if (check) return { text: 'CHECKING…', cls: '' }
    return optional ? { text: 'OPTIONAL', cls: 'dashed' } : { text: 'TO DO', cls: 'todo' }
  }

  const steps = $derived([
    {
      id: 'agents',
      title: 'AGENTS',
      purpose:
        'Choose the agents that get a toggle on every skill card. You can change this later in Settings.',
      chip: chip(status.agents)
    },
    {
      id: 'git',
      title: 'GIT',
      purpose: 'Needed for skills from GitHub. Skills from your own folders work without it.',
      chip: chip(status.git, false, checking)
    },
    {
      id: 'tessl',
      title: 'TESSL',
      purpose:
        'Reviews, fixes and publishes your own skills, and installs skills your team published. Skip it until you need it.',
      chip: chip(status.tessl, true, checking)
    }
  ])

  const installNeeded = (tool: string): boolean => {
    const st = toolStatus(startup, tool)
    return st === 'missing' || st === 'not-running'
  }

  /** The agent's own tool, when Loadout knows how to install it; custom agents have none. */
  const installTool = (command: string): InstallTool | null =>
    command in INSTALL_COMMANDS ? (command as InstallTool) : null
</script>

{#snippet statusLine(tool: string, agent: boolean)}
  {@const st = toolStatus(startup, tool)}
  {@const found = startup.tools[tool]}
  <div class="bc-status {st === 'checking' ? 'wait' : st === 'ok' ? 'ok' : 'bad'}">
    <span class="bc-dot"></span>
    <span>
      {#if st === 'checking'}
        Checking {tool}…
      {:else if st === 'ok' && agent}
        <strong>{tool}</strong> found on this Mac.
      {:else if st === 'ok' && found}
        <strong>{tool}</strong>
        {versionNumber(found.version)} found at {found.path}.
      {:else if st === 'not-running'}
        <strong>{tool}</strong> at {startup.notRunning[tool]} does not run.
      {:else}
        <strong>{tool}</strong> not found{agent ? ' on this Mac' : ''}.
      {/if}
    </span>
  </div>
{/snippet}

{#snippet agentRows()}
  <div class="bc-agents">
    {#each lib.agents as agent (agent.id)}
      {@const tool = installTool(agent.command)}
      {@const line = checking ? '' : folderLine(agent, known)}
      <div class="bc-agent">
        <div class="bc-agent-top">
          <div class="bc-agent-name">
            <strong>{agent.label}</strong>
            <span class="mono">{displayPath(agent.folder, lib.home)}</span>
          </div>
          <label class="switch-label"
            >{agent.enabled ? 'ENLISTED' : 'ENLIST'}<input
              type="checkbox"
              class="switch"
              aria-label={`Enlist ${agent.label}`}
              checked={agent.enabled}
              disabled={busy}
              onchange={async (e) => {
                const box = e.currentTarget
                const result = await api.invoke('set-agent-enabled', {
                  agentId: agent.id,
                  on: box.checked
                })
                report(result)
                if (!result.ok) box.checked = agent.enabled
              }}
            /></label
          >
        </div>
        {@render statusLine(agent.command, true)}
        {#if line}
          <div class="bc-line">
            {line}
            {#if startup.folders[agent.id]}
              <button type="button" class="link" onclick={() => (app.page = { name: 'recon' })}
                >See Recon</button
              >
            {/if}
          </div>
        {/if}
        {#if tool && installNeeded(agent.command)}
          <InstallBlock
            {tool}
            label={`INSTALL ${agent.label.toUpperCase()}`}
            homebrew={startup.homebrew}
            {busy}
          />
        {/if}
      </div>
    {/each}
  </div>
{/snippet}

{#snippet gitBody()}
  {@render statusLine('git', false)}
  {#if toolStatus(startup, 'git') === 'not-running' && startup.notRunning.git === '/usr/bin/git'}
    <p class="bc-hint">{GIT_PLACEHOLDER}</p>
  {/if}
  {#if installNeeded('git')}
    <InstallBlock tool="git" label="INSTALL GIT" homebrew={startup.homebrew} {busy} />
  {/if}
{/snippet}

{#snippet tesslBody()}
  {#if toolStatus(startup, 'tessl') !== 'ok'}
    {@render statusLine('tessl', false)}
    {#if installNeeded('tessl')}
      <InstallBlock tool="tessl" label="INSTALL TESSL" homebrew={startup.homebrew} {busy} />
    {/if}
  {:else if !startup.tesslUser}
    {@render statusLine('tessl', false)}
    <div class="bc-install">
      <span class="bc-install-label">LOG IN</span>
      <CommandBox lines={[LOGIN_COMMANDS.tessl]} />
      <p class="bc-hint">
        The Tessl login page opens in your browser. If you have no Tessl account, the login page
        lets you create one.
      </p>
      <div class="bc-row">
        <button type="button" disabled={busy} onclick={openTerminal}
          ><Icon name="square-terminal" size={13} />OPEN TERMINAL</button
        >
        <button type="button" class="primary" disabled={busy} onclick={checkAgain}
          ><Icon name="refresh" size={13} />CHECK AGAIN</button
        >
      </div>
    </div>
  {:else if !lib.tesslWorkspace}
    <div class="bc-status ok">
      <span class="bc-dot"></span>
      <span
        >Logged in as {startup.tesslUser}. Pick your default workspace in Settings; Review and Fix
        use it.</span
      >
    </div>
    <div class="bc-row">
      <button type="button" disabled={busy} onclick={onsettings}
        ><Icon name="settings" size={13} />OPEN SETTINGS</button
      >
    </div>
  {:else}
    <div class="bc-status ok">
      <span class="bc-dot"></span>
      <span>Logged in as {startup.tesslUser}, default workspace {lib.tesslWorkspace}.</span>
    </div>
  {/if}
{/snippet}

{#snippet exit()}
  {#if status.agents}
    <div class="bc-exit">
      <strong>READY</strong>
      <!-- With nothing to recruit in the agent folders, the first skill comes from the Loadout page. -->
      {#if lib.unmanaged.some((u) => u.recruit.kind === 'recruit')}
        <p>Recruit your first skill on the <strong>Recon</strong> page.</p>
        <div class="bc-row">
          <button type="button" class="primary" onclick={() => (app.page = { name: 'recon' })}
            >GO TO RECON <Icon name="arrow-right" size={12} /></button
          >
        </div>
      {:else}
        <p>Add your first skill on the Loadout page with <strong>Recruit skill</strong>.</p>
        <div class="bc-row">
          <button type="button" class="primary" onclick={() => (app.page = { name: 'loadout' })}
            >GO TO LOADOUT <Icon name="arrow-right" size={12} /></button
          >
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

<section class="main-col" aria-label="BOOT CAMP">
  <PageHeader title="BOOT CAMP" {line} {eyebrow}>
    {#snippet actions()}
      {#if !wide}
        <div class="bc-meter" aria-hidden="true">
          <span class:on={status.agents}></span><span class:on={status.git}></span><span
            class="opt"
            class:on={status.tessl}
          ></span>
        </div>
      {/if}
    {/snippet}
  </PageHeader>
  <Notice />
  <div class="bc-scroll">
    <p class="bc-lead">
      Loadout keeps one list of your skills and turns each skill on or off per agent, with links.<br
      />
      Your skill folders stay where they are.
    </p>
    <div class="bc-body">
      <div class="bc-steps">
        {#each steps as step, i (step.id)}
          <section
            class="bc-step cut"
            id={`bc-step-${step.id}`}
            aria-labelledby={`bc-h-${step.id}`}
          >
            <div class="bc-head">
              <span class="bc-num">{String(i + 1).padStart(2, '0')}</span>
              <h2 class="bc-title" id={`bc-h-${step.id}`}>{step.title}</h2>
              <span class="bc-chip {step.chip.cls}">{step.chip.text}</span>
            </div>
            <p class="bc-purpose">{step.purpose}</p>
            {#if step.id === 'agents'}
              {@render agentRows()}
            {:else if step.id === 'git'}
              {@render gitBody()}
            {:else}
              {@render tesslBody()}
            {/if}
          </section>
        {/each}
        {#if !wide}{@render exit()}{/if}
      </div>
      {#if wide}
        <!-- The rank badge: the brand's three chevrons, one per step; the bottom band is AGENTS. -->
        <aside class="bc-rank" aria-label="Rank">
          <div class="bc-rank-box cut">
            <span class="bc-rank-label">RANK</span>
            <svg
              class="bc-badge"
              viewBox="14 12 72 76"
              role="img"
              aria-label={`Rank badge: ${count.toLowerCase()}`}
            >
              <defs>
                {#each CAMO_TILES as tile (tile.id)}
                  <pattern
                    id={tile.id}
                    patternUnits="userSpaceOnUse"
                    width={CAMO_TILE}
                    height={CAMO_TILE}
                  >
                    <rect width={CAMO_TILE} height={CAMO_TILE} fill={CAMO_GROUND} />
                    {#each tile.layers as layer, i (i)}
                      <path d={layer.d} fill={layer.fill} />
                    {/each}
                  </pattern>
                {/each}
              </defs>
              <path
                class="band opt"
                class:on={status.tessl}
                style="--camo: url(#bc-camo-2)"
                d="M16 32 L50 14 L84 32 L84 44 L50 26 L16 44 Z"
              />
              <path
                class="band"
                class:on={status.git}
                style="--camo: url(#bc-camo-1)"
                d="M16 53 L50 35 L84 53 L84 65 L50 47 L16 65 Z"
              />
              <path
                class="band"
                class:on={status.agents}
                style="--camo: url(#bc-camo-0)"
                d="M16 74 L50 56 L84 74 L84 86 L50 68 L16 86 Z"
              />
            </svg>
            <span class="bc-rank-word" class:ok={status.agents && status.git}
              >{rankWord(status)}</span
            >
            {#if status.git || status.tessl}
              <span class="bc-rank-plus"
                >{[status.git && '[ GIT ]', status.tessl && '[ TESSL ]']
                  .filter(Boolean)
                  .join(' ')}</span
              >
            {/if}
            <span class="bc-rank-count">{count}</span>
          </div>
          {@render exit()}
        </aside>
      {/if}
    </div>
  </div>
</section>
