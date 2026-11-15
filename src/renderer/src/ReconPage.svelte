<script lang="ts">
  import { displayPath } from '../../core/paths'
  import type { State } from '../../core/ipc'
  import {
    claudeEnabled,
    overridesBlock,
    SYNC_OFF_LINE,
    syncedLoad,
    type Synced
  } from '../../core/synced'
  import { relocate, remove, reveal, revealBackup } from './actions'
  import { api } from './api'
  import CopyBlock from './CopyBlock.svelte'
  import { plural } from './format'
  import Icon from './Icon.svelte'
  import Notice from './Notice.svelte'
  import PageHeader from './PageHeader.svelte'
  import { app, openRecruit, report } from './state.svelte'

  let { state: lib, eyebrow }: { state: State; eyebrow: string | null } = $props()

  const issues = $derived(lib.entries.filter((e) => e.status !== 'ok'))
  const label = (id: string): string => lib.agents.find((a) => a.id === id)?.label ?? id
  const folders = $derived(
    lib.agents.map((agent) => ({
      agent,
      scanned: lib.startup.folders[agent.id] !== false,
      count: `${lib.entries.filter((e) => e.enabledFor.includes(agent.id)).length} + ${lib.unmanaged.filter((u) => u.agentId === agent.id).length}`
    }))
  )

  const syncedLabel = (synced: Synced): string =>
    `Synced from your claude.ai account · ${synced.skills.length} ${plural(synced.skills.length, 'skill', 'skills')}${synced.syncOff ? ' · sync off, not loaded' : ''}`
  const inLibrary = (name: string): boolean => lib.entries.some((e) => e.name === name)
  /** The overlaps Claude Code loads, in name order: the fix block lists these. */
  const loaded = $derived(
    (lib.synced?.skills ?? []).filter((n) => inLibrary(n) && syncedLoad(lib.synced, n) === 'loaded')
  )
  const showFix = $derived(claudeEnabled(lib.synced, lib.agents) && loaded.length > 0)
  /** The `synced` folder rows the user unfolded, by agent id and name. They start folded. */
  let unfolded = $state<Record<string, boolean>>({})

  /** Recruit rows first, then Move to backup, then the rows with no action. */
  const GROUP = { recruit: 0, backup: 1, text: 2, none: 2 } as const
  const RANK = { recruit: 0, backup: 1, text: 2, none: 3 } as const
  const rows = $derived(
    lib.unmanaged.toSorted((a, b) => RANK[a.recruit.kind] - RANK[b.recruit.kind])
  )
  const KIND_TIP = {
    link: 'A symlink that Loadout did not make. TARGET shows where it points.',
    folder: 'A real folder in the agent folder, not a link.',
    file: 'A plain file, not a skill folder. Loadout leaves it alone.'
  } as const

  async function rescan(): Promise<void> {
    app.rowResult = {}
    app.undone = null
    report(await api.invoke('refresh'))
  }
</script>

<PageHeader
  title="RECON"
  line={`${lib.unmanaged.length} UNMANAGED · ${lib.backups.length} ${plural(lib.backups.length, 'BACKUP', 'BACKUPS')} · ${issues.length} LOADOUT ${plural(issues.length, 'ISSUE', 'ISSUES')} · ${lib.agents.length} AGENT FOLDERS SCANNED`}
  {eyebrow}
>
  {#snippet actions()}
    <button aria-label="Rescan" onclick={rescan} disabled={lib.busy !== null}
      ><Icon name="refresh" size={14} />RESCAN</button
    >
  {/snippet}
</PageHeader>
<Notice />
{#if app.undone}
  <p class="notice dismissable done" role="status">
    <span class="notice-text">{app.undone}</span>
    <button
      class="icon small-icon notice-close"
      aria-label="Dismiss"
      title="Dismiss"
      onclick={() => (app.undone = null)}><Icon name="x" size={13} /></button
    >
  </p>
{/if}

<div class="recon-body">
  <div class="recon-main">
    <section aria-label="Unmanaged" class="recon-section">
      <div class="recon-head">
        <span class="recon-title">UNMANAGED IN AGENT FOLDERS · {lib.unmanaged.length}</span>
      </div>
      {#if lib.unmanaged.length > 0}
        <table class="recon-table recon-cols">
          <colgroup>
            <col class="col-agent" /><col class="col-name" /><col class="col-kind" /><col /><col
              class="col-act"
            />
          </colgroup>
          <thead>
            <tr><th>AGENT</th><th>NAME</th><th>KIND</th><th>TARGET</th><th></th></tr>
          </thead>
          <tbody>
            {#each rows as item, i (item.agentId + '/' + item.name)}
              {@const key = item.agentId + '/' + item.name}
              {@const first = i > 0 && GROUP[item.recruit.kind] !== GROUP[rows[i - 1].recruit.kind]}
              {@const synced =
                item.name === 'synced' &&
                item.kind === 'folder' &&
                item.agentId === lib.synced?.agentId
                  ? lib.synced
                  : null}
              <tr class:group-start={first}>
                <td>{label(item.agentId)}</td>
                <td class="recon-name">
                  {#if synced}
                    <button
                      class="recon-fold"
                      aria-expanded={!!unfolded[key]}
                      title={unfolded[key] ? 'Hide the synced skills' : 'Show the synced skills'}
                      onclick={() => (unfolded[key] = !unfolded[key])}
                      >{item.name}<Icon
                        name={unfolded[key] ? 'chevron-down' : 'chevron-right'}
                        size={14}
                      /></button
                    >
                  {:else}
                    {item.name}
                  {/if}
                </td>
                <td
                  ><span class="tip"
                    ><span
                      class="recon-tag"
                      class:folder={item.kind === 'folder'}
                      aria-describedby={`tip-kind-${key}`}>{item.kind.toUpperCase()}</span
                    ><span class="tip-text float" id={`tip-kind-${key}`} role="tooltip"
                      >{KIND_TIP[item.kind]}</span
                    ></span
                  ></td
                >
                <!-- A row with nothing to offer gives its target the action column too. -->
                <td colspan={item.recruit.kind === 'none' ? 2 : 1}>
                  <span class="recon-target">
                    <span class="recon-path"
                      >{synced
                        ? syncedLabel(synced)
                        : item.target
                          ? displayPath(item.target, lib.home)
                          : '—'}</span
                    >
                    {#if item.dangling}
                      <span class="tip"
                        ><span class="recon-tag bad" aria-describedby={`tip-dangling-${key}`}
                          >DANGLING</span
                        ><span class="tip-text float" id={`tip-dangling-${key}`} role="tooltip"
                          >The link points at a folder that does not exist. MOVE TO BACKUP takes the
                          link out of the agent folder.</span
                        ></span
                      >
                    {/if}
                  </span>
                </td>
                {#if item.recruit.kind !== 'none'}
                  <td class="recon-act">
                    {#if item.recruit.kind === 'recruit'}
                      <button
                        class="small primary"
                        aria-label="Recruit"
                        onclick={() => openRecruit('recruit', item.agentId, item.name)}
                        disabled={lib.busy !== null}>RECRUIT</button
                      >
                    {:else if item.recruit.kind === 'backup'}
                      <button
                        class="small primary"
                        aria-label="Move to backup"
                        onclick={() => openRecruit('recruit', item.agentId, item.name)}
                        disabled={lib.busy !== null}>MOVE TO BACKUP</button
                      >
                    {:else if item.recruit.kind === 'text'}
                      <span class="tip tip-end"
                        ><span class="recon-tag warn" aria-describedby={`tip-act-${key}`}
                          >UNFIT FOR DUTY</span
                        ><span class="tip-text float" id={`tip-act-${key}`} role="tooltip"
                          >{item.recruit.text}</span
                        ></span
                      >
                    {/if}
                  </td>
                {/if}
              </tr>
              {#if synced && unfolded[key]}
                {#each synced.skills as name (name)}
                  <tr class="synced-row">
                    <td></td>
                    <td class="recon-name synced-name">{name}</td>
                    <td><span class="recon-tag synced">SYNCED</span></td>
                    <td colspan="2">
                      <span class="recon-target">
                        <span class="recon-path">anthropic-skills:{name}</span>
                        {#if inLibrary(name)}<span class="recon-tag">IN LOADOUT</span>{/if}
                      </span>
                    </td>
                  </tr>
                {/each}
                {#if showFix}
                  {@const n = loaded.length}
                  <tr>
                    <td></td>
                    <td colspan="4" class="synced-fix-cell">
                      <section aria-label="Also in your loadout" class="synced-fix">
                        <span class="recon-title">ALSO IN YOUR LOADOUT · {n}</span>
                        <p>
                          {n === 1
                            ? '1 skill in your loadout is also synced from claude.ai. Claude Code loads the synced copy whatever the Loadout toggles say. To turn it off, add one of these to ~/.claude/settings.json. Loadout never changes that file.'
                            : `${n} skills in your loadout are also synced from claude.ai. Claude Code loads the synced copies whatever the Loadout toggles say. To turn them off, add one of these to ~/.claude/settings.json. Loadout never changes that file.`}
                        </p>
                        <CopyBlock
                          label={n === 1
                            ? 'TURN OFF THIS SYNCED COPY'
                            : `TURN OFF THESE ${n} SYNCED COPIES`}
                          text={overridesBlock(loaded)}
                        />
                        <p>
                          Keeps the other synced skills. If the file already has "skillOverrides",
                          add the lines inside it. A new overlap needs a new line.
                        </p>
                        <CopyBlock label="OR TURN THE SYNC OFF" text={SYNC_OFF_LINE} />
                        <p>
                          Removes every synced skill from Claude Code, including pdf, docx, xlsx and
                          pptx. Loadout can then no longer show whether a claude.ai copy differs.
                        </p>
                        <p>Press RESCAN after you save the file.</p>
                      </section>
                    </td>
                  </tr>
                {/if}
              {/if}
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="muted recon-empty">Nothing unmanaged in the agent folders.</p>
      {/if}
    </section>

    <section aria-label="Backups" class="recon-section">
      <div class="recon-head">
        <span class="recon-title">BACKUPS · {lib.backups.length}</span>
        <span class="recon-sub"
          >Originals Loadout moved out. Loadout never deletes them; remove one in Finder.</span
        >
      </div>
      {#if lib.backups.length > 0}
        <!-- The same first three columns as the Unmanaged table, so the two line up. -->
        <table class="recon-table recon-cols">
          <colgroup>
            <col class="col-agent" /><col class="col-name" /><col class="col-kind" /><col />
          </colgroup>
          <thead>
            <tr><th>AGENT</th><th>NAME</th><th>KIND</th><th></th></tr>
          </thead>
          <tbody>
            {#each lib.backups as backup (backup.agentId + '/' + backup.entry)}
              <tr>
                <td>{label(backup.agentId)}</td>
                <td class="recon-name">{backup.entry}</td>
                <td
                  ><span class="recon-tag" class:folder={backup.kind === 'folder'}
                    >{backup.kind.toUpperCase()}</span
                  ></td
                >
                <td class="recon-act">
                  <button
                    class="small"
                    aria-label="Reveal"
                    onclick={() => revealBackup(backup.agentId, backup.entry)}
                    disabled={lib.busy !== null}>REVEAL</button
                  >
                  {#if lib.agents.some((a) => a.id === backup.agentId)}
                    <button
                      class="small"
                      aria-label="Undo"
                      onclick={() => openRecruit('undo', backup.agentId, backup.entry)}
                      disabled={lib.busy !== null}>UNDO</button
                    >
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="muted recon-empty">No backups.</p>
      {/if}
    </section>

    <section aria-label="Loadout issues" class="recon-section">
      <span class="recon-title">LOADOUT ISSUES · {issues.length}</span>
      {#each issues as entry (entry.name)}
        {#if entry.status === 'missing'}
          <article class="issue cut missing" aria-label={entry.name}>
            <span class="recon-tag bad">MISSING</span>
            <span class="issue-text">
              <strong>{entry.name}</strong>
              <span class="issue-path">{displayPath(entry.target, lib.home)}</span>
              <span
                >The source folder is gone. Its agent links point at nothing until you remove or
                relocate it.</span
              >
            </span>
            <button
              class="small"
              aria-label="Relocate"
              onclick={() => relocate(entry)}
              disabled={lib.busy !== null}>RELOCATE</button
            >
            <button
              class="small danger"
              aria-label="Remove"
              onclick={() => remove(entry)}
              disabled={lib.busy !== null}>REMOVE</button
            >
          </article>
        {:else}
          <article class="issue cut" aria-label={entry.name}>
            <span class="recon-tag warn">NOT A LINK</span>
            <span class="issue-text">
              <strong>{entry.name}</strong>
              <span>Not a symlink; Loadout only manages symlinks here. Fix it in Finder.</span>
            </span>
            <button
              class="small"
              aria-label="Reveal"
              onclick={() => reveal(entry)}
              disabled={lib.busy !== null}>REVEAL</button
            >
          </article>
        {/if}
      {:else}
        <p class="muted recon-empty">No loadout issues.</p>
      {/each}
    </section>
  </div>

  <aside class="recon-side narrow" aria-label="Folders scanned">
    <span class="recon-title">FOLDERS SCANNED</span>
    <div class="recon-panel">
      {#each folders as { agent, scanned, count } (agent.id)}
        <div class="folder-row">
          <span class="folder-swatch" class:off={!scanned}></span>
          <span class="folder-text">
            <strong>{agent.label}</strong>
            <span class="folder-path">{displayPath(agent.folder, lib.home)}</span>
            {#if !agent.enabled}<span class="folder-path">not enabled</span>{/if}
          </span>
          <span class="folder-count">{scanned ? count : 'not created yet'}</span>
        </div>
      {/each}
      <div class="folder-row">
        <span class="folder-swatch"></span>
        <span class="folder-text">
          <strong>Loadout</strong>
          <span class="folder-path">~/.loadout/skills</span>
        </span>
        <span class="folder-count">{lib.entries.length}</span>
      </div>
    </div>
    <div class="recon-panel notes">
      <span class="recon-title">FIELD NOTES</span>
      <span class="field-notes"
        >Recon only scans the agent skills folders. Skills that come inside a plugin are outside
        Loadout's scope.</span
      >
    </div>
  </aside>
</div>
