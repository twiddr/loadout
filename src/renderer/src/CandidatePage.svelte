<script lang="ts">
  import type { CandidateDetail, State } from '../../core/ipc'
  import { displayPath } from '../../core/paths'
  import { api } from './api'
  import { formatSize, splitFrontmatter } from './format'
  import Icon from './Icon.svelte'
  import { renderMarkdown } from './markdown'
  import Notice from './Notice.svelte'
  import { app, openRecruit } from './state.svelte'

  let { state: lib, agentId, entry }: { state: State; agentId: string; entry: string } = $props()

  const row = $derived(lib.unmanaged.find((u) => u.agentId === agentId && u.name === entry))
  const agent = $derived(lib.agents.find((a) => a.id === agentId))
  const isLink = $derived(row?.kind === 'link')
  /** Where the entry sits in the agent folder. */
  const place = $derived(agent ? displayPath(`${agent.folder}/${entry}`, lib.home) : entry)
  /** What the page reads: a link's target, else the entry itself. */
  const address = $derived(row?.target ? displayPath(row.target, lib.home) : place)
  const busy = $derived(lib.busy !== null)

  // A recruit, a Rescan or a change on disk can end the row; the page then returns to RECON.
  $effect(() => {
    if (row?.recruit.kind !== 'recruit') app.page = { name: 'recon' }
  })

  let loaded = $state<{ key: string; detail: CandidateDetail } | null>(null)
  const key = $derived(`${agentId}/${entry}`)
  const detail = $derived(loaded?.key === key ? loaded.detail : null)
  const parts = $derived(detail?.skillMd != null ? splitFrontmatter(detail.skillMd) : null)
  let reads = 0

  // Read when the page opens and again on every state push; a newer read, or leaving the page,
  // drops an older reply. A row that is no longer a candidate is not read: the page is leaving.
  $effect(() => {
    void lib
    if (row?.recruit.kind !== 'recruit') return
    const mine = ++reads
    const want = key
    void api.invoke('candidate-detail', { agentId, entry }).then((result) => {
      if (mine !== reads) return
      if (result.ok) loaded = { key: want, detail: result.detail }
      else app.notice = result.message
    })
    return () => {
      reads++
    }
  })
</script>

{#if row}
  <div class="skill-page">
    <div class="drag skill-top">
      <button class="back" aria-label="Back to Recon" onclick={() => (app.page = { name: 'recon' })}
        ><Icon name="chevron-left" size={13} />RECON</button
      >
      <span>/</span><span>NOT IN LOADOUT</span>
    </div>
    <div class="skill-head">
      <span class="tile big cut local" role="img" aria-label={isLink ? 'Link' : 'Folder'}
        ><Icon name={isLink ? 'link' : 'folder'} size={28} /></span
      >
      <div class="skill-id">
        <div class="skill-name">
          <h1>{entry}</h1>
        </div>
        <div class="skill-address">
          <span class="swatch-line local"
            ><span class="swatch-sq local"></span>{isLink ? 'LINK' : 'FOLDER'}</span
          >
          <span class="skill-source" title={address}>{address}</span>
        </div>
      </div>
      <div class="skill-actions">
        <button
          class="primary"
          aria-label="Recruit"
          onclick={() => openRecruit('recruit', agentId, entry)}
          disabled={busy}>RECRUIT</button
        >
      </div>
    </div>
    <Notice extra="skill-notice" />
    <div class="skill-body">
      <section class="skill-file" aria-label="Skill file">
        <div class="skill-tabs" role="tablist">
          <button role="tab" class="skill-tab" aria-selected="true">Briefing</button>
          <span class="spacer"></span>
          <span class="skill-file-note">SKILL.md · read-only</span>
        </div>
        <div class="skill-file-body">
          {#if !detail}
            <p class="note">Loading…</p>
          {:else if parts}
            {#if parts.fields.length > 0}
              <div class="frontmatter">
                {#each parts.fields as [name, value], i (i)}
                  <div>
                    <span class="fm-key">{name}:</span> <span class="fm-value">{value}</span>
                  </div>
                {/each}
              </div>
            {/if}
            <div class="md">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown escapes raw HTML -->
              {@html renderMarkdown(parts.body)}
            </div>
          {:else}
            <p class="muted">No SKILL.md in {address}.</p>
          {/if}
        </div>
      </section>
      <div class="skill-side">
        <section class="side-card cut" aria-label="Found in">
          <div class="side-title"><span>FOUND IN</span></div>
          <div class="issued-row">
            <span class="issued-id">
              <span class="issued-name">{agent?.label ?? agentId}</span>
              <span class="agent-folder">{place}</span>
            </span>
            <span class="recon-tag" class:folder={!isLink}>{isLink ? 'LINK' : 'FOLDER'}</span>
          </div>
        </section>
        <div class="side-card">
          <div class="side-title"><span>SPEC</span></div>
          <div class="spec-row"><span>SOURCE</span><span>{isLink ? 'Link' : 'Folder'}</span></div>
          {#if detail?.size}
            <div class="spec-row"><span>SIZE</span><span>{formatSize(detail.size)}</span></div>
          {/if}
        </div>
        <div class="side-card">
          <div class="side-title"><span>FILES</span></div>
          {#each detail?.files ?? [] as file (file.name)}
            <span class="file-row"
              ><span class="file-mark">{file.folder ? '▸' : '▪'}</span>{file.name}{file.folder
                ? '/'
                : ''}</span
            >
          {/each}
        </div>
      </div>
    </div>
  </div>
{/if}
