<script lang="ts">
  import type { SkillDetail, State } from '../../core/ipc'
  import { sourceKey } from '../../core/checks'
  import { displayPath } from '../../core/paths'
  import { compareVersions, editedTitle, registryUrl, shareMessage } from '../../core/tessl'
  import { checkRegistry, keepFix, remove, review, toggle, undoFix, update } from './actions'
  import { api } from './api'
  import {
    agentCode,
    ago,
    diffFiles,
    formatSize,
    localDate,
    plural,
    scoreText,
    scoreTone,
    serial,
    splitFrontmatter
  } from './format'
  import { claudeEnabled, overridesBlock, syncedLoad } from '../../core/synced'
  import CopyBlock from './CopyBlock.svelte'
  import Icon from './Icon.svelte'
  import { renderMarkdown } from './markdown'
  import Notice from './Notice.svelte'
  import Rank from './Rank.svelte'
  import SkillMenu from './SkillMenu.svelte'
  import Tip from './Tip.svelte'
  import { app, openTesslDialog } from './state.svelte'

  let {
    state: lib,
    skill,
    tab,
    from
  }: { state: State; skill: string; tab: Tab; from: 'loadout' | 'intel' } = $props()

  type Tab = 'briefing' | 'review' | 'fix' | 'diff' | 'history'

  const index = $derived(lib.entries.findIndex((e) => e.name === skill))
  const entry = $derived(index === -1 ? undefined : lib.entries[index])
  const agents = $derived(lib.agents.filter((a) => a.enabled))
  const busy = $derived(lib.busy !== null)

  let loaded = $state<{ skill: string; detail: SkillDetail } | null>(null)
  const detail = $derived(loaded?.skill === skill ? loaded.detail : null)
  let reads = 0
  let readFor: string | null = null

  // The page reads the disk when it opens (busy or not) and again on every state push while no
  // command runs. A read started while idle is dropped when the next push arrives, so a read from
  // before a command never lands after it; the first read of a busy page is kept until a newer one.
  $effect(() => {
    void lib
    if (!entry || (lib.busy !== null && readFor === skill)) return
    readFor = skill
    const mine = ++reads
    void api.invoke('skill-detail', { skill }).then((result) => {
      if (mine !== reads) return
      if (result.ok) loaded = { skill, detail: result.detail }
      else app.notice = result.message
    })
    if (lib.busy !== null) return
    return () => {
      reads++
    }
  })

  // Removing the skill (here or in the menu) returns to the page it was opened from.
  $effect(() => {
    if (!entry) app.page = { name: from }
  })

  const kind = $derived(
    entry ? { local: 'Folder', github: 'Link', tessl: 'Registry' }[entry.source.type] : ''
  )
  const icon = $derived(
    entry
      ? ({ local: 'folder', github: 'link', tessl: 'package' } as const)[entry.source.type]
      : 'folder'
  )
  const address = $derived.by(() => {
    const s = entry?.source
    if (!s) return ''
    if (s.type === 'local') return displayPath(s.path, lib.home)
    if (s.type === 'github')
      return ['github.com', s.owner, s.repo, s.subpath].filter(Boolean).join('/')
    return [s.workspace, s.plugin, s.subpath].filter(Boolean).join('/')
  })
  const parts = $derived(detail?.skillMd != null ? splitFrontmatter(detail.skillMd) : null)
  const isGithub = $derived(entry?.source.type === 'github')
  const sourceCheck = $derived(entry ? lib.checks[sourceKey(entry.source) ?? ''] : undefined)
  const ready = $derived(sourceCheck?.state === 'ready')
  const noTool = $derived(
    lib.startup.tools[entry?.source.type === 'github' ? 'git' : 'tessl'] === null
  )
  const manifest = $derived(entry?.source.type === 'local' ? lib.manifests[entry.name] : undefined)
  /** The TESSL card's plugin: an own skill's manifest, or a Registry skill's installed copy. */
  const card = $derived(manifest ?? detail?.installed ?? undefined)
  const plugin = $derived(card ? `${card.workspace}/${card.plugin}` : '')
  const registry = $derived(card ? lib.registry[plugin] : undefined)
  /** Files newer than the manifest, newest first (ADR 20261111-changed-since-publish). */
  const edited = $derived(manifest && entry ? lib.edited[entry.name] : undefined)
  // 1 when the manifest is ahead of the registry, -1 when the registry is ahead, else null.
  const direction = $derived(
    manifest && registry?.state === 'found'
      ? compareVersions(manifest.version, registry.version)
      : null
  )
  /** The SHARE button shows a tick for a moment after a copy. */
  let shared = $state(false)

  async function share(): Promise<void> {
    if (!card) return
    const result = await api.invoke('copy-text', { text: shareMessage(skill, card) })
    if (!result.ok) {
      app.notice = `Copy failed: ${result.message}`
      return
    }
    shared = true
    setTimeout(() => (shared = false), 1500)
  }
  const hasDiff = $derived(isGithub && ready)
  const hasFix = $derived(entry ? lib.fixes[entry.name] !== undefined : false)
  const shownTab = $derived<Tab>(
    tab === 'review'
      ? 'review'
      : tab === 'fix' && hasFix
        ? 'fix'
        : tab === 'history' && isGithub
          ? 'history'
          : tab === 'diff' && hasDiff
            ? 'diff'
            : 'briefing'
  )
  const saved = $derived(entry ? lib.reviews[entry.name] : undefined)
  const savedReview = $derived(detail?.review ?? null)
  const noTessl = $derived(lib.startup.tools.tessl === null)
  const savedFix = $derived(detail?.fix ?? null)
  // BEFORE holds for one fix only: a new fix, or another skill, opens on AFTER.
  const fixKey = $derived(savedFix ? `${skill} ${savedFix.fixedAt}` : null)
  let beforeOf = $state<string | null>(null)
  const fixSide = $derived(fixKey !== null && beforeOf === fixKey ? 'before' : 'after')
  const fixTag = { added: 'ADDED', changed: 'CHANGED', removed: 'REMOVED' } as const
  const headline = $derived(
    !sourceCheck
      ? ''
      : isGithub
        ? `Update available — ${sourceCheck.behind} ${plural(sourceCheck.behind, 'commit', 'commits')} behind ${sourceCheck.upstream}`
        : `Update available — ${sourceCheck.from} → ${sourceCheck.to}`
  )
  const statusText = $derived(
    entry?.status === 'missing'
      ? 'The source folder is gone. Its agent links point at nothing until you remove or relocate it.'
      : entry?.status === 'not-a-link'
        ? 'Not a symlink; Loadout only manages symlinks here. Fix it in Finder.'
        : null
  )
  const oldest = $derived(detail?.history?.at(-1)?.hash)

  function pick(next: Tab): void {
    app.page = { name: 'skill', skill, tab: next, from }
  }

  // The diff is read when the Diff tab opens, and again after a new check.
  let diff = $state<{ skill: string; at: number; text: string; failed: boolean } | null>(null)
  const checkedAt = $derived(sourceCheck?.checkedAt)
  const shownDiff = $derived(diff?.skill === skill && diff.at === checkedAt ? diff : null)
  $effect(() => {
    if (shownTab !== 'diff' || checkedAt === undefined) return
    const at = checkedAt
    let stale = false
    void api.invoke('skill-diff', { skill }).then((result) => {
      if (stale) return
      diff = result.ok
        ? { skill, at, text: result.diff, failed: false }
        : { skill, at, text: result.message, failed: true }
    })
    return () => {
      stale = true
    }
  })
  const files = $derived(shownDiff && !shownDiff.failed ? diffFiles(shownDiff.text) : [])
  const behind = $derived(sourceCheck?.behind ?? 0)
  const repo = $derived(
    entry?.source.type === 'github' ? `${entry.source.owner}/${entry.source.repo}` : ''
  )
  /** The CLAUDE.AI card's effect state (1 to 5); null when the card does not show. */
  const claudeAi = $derived.by(() => {
    if (!entry || !lib.synced) return null
    const load = syncedLoad(lib.synced, entry.name)
    if (load === 'none' || !claudeEnabled(lib.synced, lib.agents)) return null
    if (lib.synced.syncOff) return 4
    if (load === 'not-loaded') return 3
    if (!entry.enabledFor.includes(lib.synced.agentId)) return 2
    // Without its folder, Claude Code loads only the synced copy (backlog 28).
    return entry.status === 'missing' ? 5 : 1
  })
  const CLAUDE_AI_TEXT = {
    1: 'Claude Code loads both copies: your loadout copy and the synced copy.',
    2: 'The Claude Code toggle is off, but Claude Code still loads the synced copy.',
    3: 'The synced copy is turned off by "skillOverrides" in ~/.claude/settings.json. Claude Code does not load it.',
    4: 'The claude.ai sync is turned off in ~/.claude/settings.json. Claude Code does not load the synced copy.',
    5: 'The source folder is gone, so Claude Code loads only the synced copy.'
  } as const
</script>

{#if entry}
  <div class="skill-page">
    <div class="drag skill-top">
      <button
        class="back"
        aria-label={from === 'intel' ? 'Back to Intel' : 'Back to Loadout'}
        onclick={() => (app.page = { name: from })}
        ><Icon name="chevron-left" size={13} />{from === 'intel' ? 'INTEL' : 'LOADOUT'}</button
      >
      <span>/</span><span>{serial(index)}</span>
    </div>
    <div class="skill-head">
      <span class="tile big cut {entry.source.type}" role="img" aria-label={kind}
        ><Icon name={icon} size={28} /></span
      >
      <div class="skill-id">
        <div class="skill-name">
          <h1>{entry.name}</h1>
          <Rank count={entry.enabledFor.length} size={22} />
        </div>
        <div class="skill-address">
          <span class="swatch-line {entry.source.type}"
            ><span class="swatch-sq {entry.source.type}"></span>{kind.toUpperCase()}</span
          >
          <Tip text={address} overflow><span class="skill-source">{address}</span></Tip>
          {#if saved}
            <span class="skill-result"
              >· review <span class="score {scoreTone(saved.score)}">{scoreText(saved.score)}</span>
              · {ago(saved.reviewedAt, app.now)}</span
            >
          {/if}
          {#if app.rowResult[entry.name]}
            <span class="skill-result">· {app.rowResult[entry.name]}</span>
          {/if}
        </div>
      </div>
      <div class="skill-actions">
        <SkillMenu {entry} state={lib} labeled />
      </div>
    </div>
    <Notice extra="skill-notice" />
    {#if sourceCheck && ready}
      <div class="intel-strip hazard">
        <div class="intel-strip-body">
          <span class="intel-strip-label">INTEL</span>
          <span class="intel-strip-text">{headline}</span>
          <span class="intel-strip-meta"
            >{sourceCheck.from} → {sourceCheck.to} · checked {ago(
              sourceCheck.checkedAt,
              app.now
            )}</span
          >
          <span class="spacer"></span>
          {#if isGithub}
            <button class="small amber-outline" aria-label="View diff" onclick={() => pick('diff')}
              >VIEW DIFF</button
            >
          {/if}
          <button
            class="small amber"
            aria-label="Update"
            onclick={() => update(entry, lib.entries)}
            disabled={busy || noTool}>UPDATE</button
          >
        </div>
      </div>
    {:else if sourceCheck?.state === 'blocked' || sourceCheck?.state === 'failed'}
      <div class="check-strip">
        <span class="recon-tag bad"
          >{sourceCheck.state === 'blocked' ? 'BLOCKED' : 'CHECK FAILED'}</span
        >
        <span>{sourceCheck.message}</span>
      </div>
    {:else if manifest && registry && (direction === 1 || direction === -1)}
      <div class="intel-strip hazard">
        <div class="intel-strip-body">
          <span class="intel-strip-label">TESSL</span>
          <span class="intel-strip-text"
            >{direction === 1
              ? `The manifest in ${address} says ${manifest.version}; the registry has ${registry.version}. Version ${manifest.version} is not published.`
              : `The registry has ${registry.version}; the manifest in ${address} says ${manifest.version}. A newer version was published from another copy of this skill. Bring that copy into this folder before you publish again.`}</span
          >
          <span class="intel-strip-meta tessl-meta">checked {ago(registry.checkedAt, app.now)}</span
          >
          <span class="spacer"></span>
          {#if direction === 1}
            <button
              class="small amber"
              aria-label="Publish"
              onclick={() => openTesslDialog('publish', entry.name)}
              disabled={busy || noTessl}>PUBLISH</button
            >
          {/if}
        </div>
      </div>
    {:else if manifest && registry && registry.state !== 'found' && registry.state !== 'archived'}
      <div class="check-strip" class:pending={registry.state === 'pending'}>
        <span class={registry.state === 'pending' ? 'recon-tag' : 'recon-tag bad'}
          >{registry.state === 'pending'
            ? 'PENDING'
            : registry.state === 'not-found'
              ? 'NOT FOUND'
              : 'CHECK FAILED'}</span
        >
        <span>{registry.message}</span>
      </div>
    {/if}
    {#if manifest && edited}
      <!-- Files newer than the manifest; independent of the registry strips above. -->
      <div class="intel-strip hazard edited-strip">
        <div class="intel-strip-body">
          <span class="intel-strip-label">TESSL</span>
          <Tip text={editedTitle(manifest.version, edited)}>
            <span class="intel-strip-text"
              >Files changed after version {manifest.version} was published.</span
            >
          </Tip>
          <span class="spacer"></span>
          <!-- The folder-ahead strip already offers PUBLISH. -->
          {#if direction !== 1}
            <button
              class="small amber"
              aria-label="Publish"
              onclick={() => openTesslDialog('publish', entry.name)}
              disabled={busy || noTessl}>PUBLISH</button
            >
          {/if}
        </div>
      </div>
    {/if}
    <div class="skill-body">
      <section class="skill-file" aria-label="Skill file">
        <div class="skill-tabs" role="tablist">
          <button
            role="tab"
            class="skill-tab"
            aria-selected={shownTab === 'briefing'}
            onclick={() => pick('briefing')}>Briefing</button
          >
          <button
            role="tab"
            class="skill-tab"
            aria-selected={shownTab === 'review'}
            onclick={() => pick('review')}>Review</button
          >
          {#if hasFix}
            <button
              role="tab"
              class="skill-tab"
              aria-selected={shownTab === 'fix'}
              onclick={() => pick('fix')}>Fix</button
            >
          {/if}
          {#if hasDiff}
            <Tip text={`${behind} new ${plural(behind, 'commit', 'commits')} upstream`}>
              <button
                role="tab"
                class="skill-tab"
                aria-selected={shownTab === 'diff'}
                onclick={() => pick('diff')}
                >Diff<span class="tab-count" aria-hidden="true">{behind}</span></button
              >
            </Tip>
          {/if}
          {#if isGithub}
            <button
              role="tab"
              class="skill-tab"
              aria-selected={shownTab === 'history'}
              onclick={() => pick('history')}>History</button
            >
          {/if}
          <span class="spacer"></span>
          <span class="skill-file-note"
            >{shownTab === 'review'
              ? savedReview?.report?.plugin
                ? `tessl review · ${savedReview.report.plugin}`
                : 'tessl review'
              : shownTab === 'fix'
                ? `before ~/.loadout/fixes/${entry.name}`
                : 'SKILL.md · read-only'}</span
          >
        </div>
        {#if shownTab === 'fix' && savedFix}
          <!-- Outside the scrolling body, so wide file content never moves these controls. -->
          <div class="fix-top">
            <span>Fixed {ago(savedFix.fixedAt, app.now)}</span>
            <div class="fix-switch" role="radiogroup" aria-label="Version">
              {#each ['before', 'after'] as const as side (side)}
                <button
                  role="radio"
                  class="small"
                  class:on={fixSide === side}
                  aria-checked={fixSide === side}
                  onclick={() => (beforeOf = side === 'before' ? fixKey : null)}>{side}</button
                >
              {/each}
            </div>
            <span class="spacer"></span>
            <button onclick={() => keepFix(entry)} disabled={busy}>KEEP FIX</button>
            <button onclick={() => undoFix(entry)} disabled={busy || !savedFix.undoable}
              >UNDO FIX</button
            >
          </div>
          {#if savedFix.unreadable}
            <p class="muted fix-note">
              Loadout cannot read the skill folder or its copy from before the fix, so Undo is off.
              Keep the fix, or restore by hand from ~/.loadout/fixes/{entry.name}/before.
            </p>
          {:else if !savedFix.undoable}
            <p class="muted fix-note">
              The skill changed after the fix, so Undo would erase those edits. Keep the fix, or
              restore by hand from ~/.loadout/fixes/{entry.name}/before.
            </p>
          {/if}
        {/if}
        <div class="skill-file-body" class:diff-body={shownTab === 'diff'}>
          {#if shownTab === 'diff'}
            {#if !shownDiff}
              <p class="note">Loading…</p>
            {:else if shownDiff.failed}
              <p class="bad">{shownDiff.text}</p>
            {:else if files.length === 0}
              <p class="muted">
                No change in this skill's folder; the update changes other files in {repo}.
              </p>
            {:else}
              <p class="diff-summary">
                {behind} new {plural(behind, 'commit', 'commits')} upstream · {files.length}
                {plural(files.length, 'file', 'files')} changed in this skill
              </p>
              {#each files as file, f (f)}
                <section class="diff diff-file" aria-label={file.path}>
                  <div class="diff-file-head">{file.path}</div>
                  {#each file.lines as { line, kind }, i (i)}
                    <span class="diff-line {kind}">{line}</span>
                  {/each}
                </section>
              {/each}
            {/if}
          {:else if !detail}
            <p class="note">Loading…</p>
          {:else if shownTab === 'review'}
            {@const r = savedReview}
            {#if entry.status === 'missing'}
              <p class="muted">{statusText}</p>
            {:else if r === null || r.stale}
              <p class="muted">
                {r === null
                  ? 'No Tessl review yet.'
                  : `The skill changed after the last review (${scoreText(r.score)}, ${ago(r.reviewedAt, app.now)}). Run the review again.`}
              </p>
              <div>
                <button onclick={() => review(entry)} disabled={busy || noTessl}>RUN REVIEW</button>
              </div>
            {:else}
              <div class="frontmatter review-score">
                <b>{scoreText(r.score)}</b> · reviewed {ago(r.reviewedAt, app.now)}{r.report?.plugin
                  ? ` · ${r.report.plugin}`
                  : ''}
              </div>
              {#if !r.report}
                <p class="muted">Loadout cannot read this review's details; see the log.</p>
              {:else}
                <div class="md review">
                  <!-- Keyed by position: a hand-edited file can repeat an id or a name. -->
                  {#each r.report.judges as judge, ji (ji)}
                    <h2>
                      {judge.id === 'description' ? 'Description' : 'Content'}
                      <span class="review-meta"
                        >{judge.percent === null ? '' : `${judge.percent}%`}{judge.weight === null
                          ? ''
                          : ` · weight ${judge.weight}%`}</span
                      >
                    </h2>
                    {#if judge.assessment}<p>{judge.assessment}</p>{/if}
                    {#if judge.suggestions.length > 0}
                      <h3>Suggestions</h3>
                      <ul>
                        {#each judge.suggestions as suggestion, i (i)}<li>{suggestion}</li>{/each}
                      </ul>
                    {/if}
                    {#each judge.dimensions as dim, j (j)}
                      <p>
                        <b>{dim.name.replaceAll('_', ' ')} {dim.score}/5</b> — {dim.reasoning}
                      </p>
                    {/each}
                  {/each}
                  {#if r.report.checks.length > 0}
                    {@const failed = r.report.checks.filter((c) => c.status !== 'passed')}
                    {@const n = r.report.checks.length}
                    <h2>Validation</h2>
                    <p>
                      {failed.length === 0
                        ? `${n} checks passed`
                        : `${n - failed.length} of ${n} checks passed`}
                    </p>
                    {#if failed.length > 0}
                      <ul>
                        {#each failed as c, k (k)}<li>
                            <b>{c.name}</b> ({c.status}): {c.message}
                          </li>{/each}
                      </ul>
                    {/if}
                  {/if}
                </div>
              {/if}
            {/if}
          {:else if shownTab === 'fix'}
            {#if savedFix}
              <ul class="fix-files">
                {#each savedFix.files as file, i (i)}
                  <li>
                    <span class="fix-tag {file.change}">{fixTag[file.change]}</span>{file.path}
                  </li>
                {/each}
              </ul>
              {#each savedFix.files as file, i (i)}
                {@const text = fixSide === 'before' ? file.before : file.after}
                {@const absent =
                  (fixSide === 'before' && file.change === 'added') ||
                  (fixSide === 'after' && file.change === 'removed')}
                <section class="fix-file" aria-label={file.path}>
                  <h3 class="fix-file-name">{file.path}</h3>
                  {#if absent}
                    <p class="muted">Not in this version.</p>
                  {:else if file.binary || text === null}
                    <p class="muted">Binary file, not shown.</p>
                  {:else if file.path === 'SKILL.md'}
                    {@const split = splitFrontmatter(text)}
                    {#if split.fields.length > 0}
                      <div class="frontmatter">
                        {#each split.fields as [key, value], j (j)}
                          <div>
                            <span class="fm-key">{key}:</span> <span class="fm-value">{value}</span>
                          </div>
                        {/each}
                      </div>
                    {/if}
                    <div class="md">
                      <!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown escapes raw HTML -->
                      {@html renderMarkdown(split.body)}
                    </div>
                  {:else if file.path.endsWith('.md')}
                    <div class="md">
                      <!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown escapes raw HTML -->
                      {@html renderMarkdown(text)}
                    </div>
                  {:else}
                    <pre class="fix-text">{text}</pre>
                  {/if}
                </section>
              {/each}
            {/if}
          {:else if shownTab === 'history'}
            <ul class="history">
              {#each detail.history ?? [] as commit (commit.hash)}
                <li>
                  <span class="hash">{commit.hash}</span><span class="date">{commit.date}</span
                  ><span>{commit.subject}</span>
                </li>
              {/each}
            </ul>
            {#if detail.git?.shallow && oldest}
              <p class="muted">Shallow clone: history starts at {oldest}.</p>
            {/if}
          {:else if parts}
            {#if parts.fields.length > 0}
              <div class="frontmatter">
                {#each parts.fields as [key, value], i (i)}
                  <div>
                    <span class="fm-key">{key}:</span> <span class="fm-value">{value}</span>
                  </div>
                {/each}
              </div>
            {/if}
            <div class="md">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown escapes raw HTML -->
              {@html renderMarkdown(parts.body)}
            </div>
          {:else}
            {#if statusText}<p class="muted">{statusText}</p>{/if}
          {/if}
        </div>
      </section>
      <div class="skill-side">
        <div class="side-card cut">
          <div class="side-title">
            <span>DEPLOYED TO</span>
            <span><b>{entry.enabledFor.length}</b> / {agents.length}</span>
          </div>
          {#each agents as agent (agent.id)}
            {@const on = entry.enabledFor.includes(agent.id)}
            <div class="issued-row">
              <span class="issued-id">
                <span class="issued-name">{agent.label}</span>
                <span class="agent-folder">{displayPath(agent.folder, lib.home)}/{entry.name}</span>
              </span>
              <label class="toggle">
                <input
                  type="checkbox"
                  aria-label={`${entry.name} ${agent.label}`}
                  checked={on}
                  disabled={busy || (entry.status !== 'ok' && !on)}
                  onchange={(e) => toggle(entry.name, agent.id, e.currentTarget)}
                />
                <span>{agentCode(agent)}</span>
              </label>
            </div>
          {/each}
        </div>
        {#if card}
          <section class="side-card" aria-label="Tessl">
            <div class="side-title"><span>TESSL</span></div>
            <div class="spec-row">
              <span>PLUGIN</span><Tip text={plugin} overflow><span>{plugin}</span></Tip>
            </div>
            <div class="spec-row">
              <span>{manifest ? 'MANIFEST' : 'INSTALLED'}</span><span>{card.version}</span>
            </div>
            <div class="spec-row registry-row">
              <span>REGISTRY</span>
              <span class="tip registry-check">
                <button
                  class="icon small-icon"
                  aria-label="Check the registry"
                  aria-describedby="tip-registry-check"
                  onclick={() => checkRegistry(entry)}
                  disabled={busy || noTessl}><Icon name="refresh" size={13} /></button
                >
                <span class="tip-text float" id="tip-registry-check" role="tooltip"
                  >Check the registry</span
                >
              </span>
              <span class="registry-value">
                {#if !registry}
                  <span>not checked</span>
                {:else if registry.state === 'found'}
                  <Tip
                    text={`published ${localDate(registry.publishedAt)} · ${registry.version}`}
                    overflow
                    ><span>published {localDate(registry.publishedAt)} · {registry.version}</span
                    ></Tip
                  >
                  {#if registry.archived !== null}
                    <Tip text={registry.archived} end
                      ><span class="recon-tag warn">ARCHIVED</span></Tip
                    >
                  {/if}
                  {#if registry.deprecated !== null}
                    <Tip text={registry.deprecated} end
                      ><span class="recon-tag warn">DEPRECATED</span></Tip
                    >
                  {/if}
                {:else if registry.state === 'archived'}
                  <!-- A whole-plugin archive names no latest version (backlog 35). -->
                  <span>archived</span>
                  <Tip text={registry.archived ?? ''} end
                    ><span class="recon-tag warn">ARCHIVED</span></Tip
                  >
                  {#if registry.deprecated !== null}
                    <Tip text={registry.deprecated} end
                      ><span class="recon-tag warn">DEPRECATED</span></Tip
                    >
                  {/if}
                {:else}
                  <span
                    >{registry.state === 'pending'
                      ? 'pending'
                      : registry.state === 'not-found'
                        ? 'not found'
                        : 'check failed'}</span
                  >
                {/if}
              </span>
            </div>
            {#if card.private !== null}
              <div class="spec-row">
                <span>VISIBLE</span><span
                  >{card.private ? 'private · workspace members' : 'public'}</span
                >
              </div>
            {/if}
            <div class="side-buttons">
              <a
                class="button small"
                href={registryUrl(card)}
                target="_blank"
                rel="noreferrer"
                aria-label="Open in registry"
                ><Icon name="external-link" size={12} />OPEN IN REGISTRY</a
              >
              <Tip
                text="Copy a message with the registry link and the install command, to send to a colleague"
                end
              >
                <button class="small" aria-label="Share" onclick={share}
                  ><Icon name={shared ? 'check' : 'copy'} size={12} />SHARE</button
                >
              </Tip>
            </div>
          </section>
        {/if}
        <div class="side-card">
          <div class="side-title"><span>SPEC</span></div>
          <div class="spec-row"><span>SERIAL</span><span>{serial(index)}</span></div>
          <div class="spec-row"><span>SOURCE</span><span>{kind}</span></div>
          {#if detail?.git}
            <div class="spec-row"><span>BRANCH</span><span>{detail.git.branch}</span></div>
            <div class="spec-row"><span>COMMIT</span><span>{detail.git.commit}</span></div>
          {/if}
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
        {#if claudeAi !== null}
          {@const copy = detail?.syncedCopy}
          <section class="side-card claude-ai" aria-label="claude.ai">
            <div class="side-title"><span>CLAUDE.AI</span></div>
            <div class="spec-row">
              <span>SYNCED AS</span><span>anthropic-skills:{entry.name}</span>
            </div>
            <div class="spec-row">
              <span>COPY</span><span class:amber-text={copy === 'differs'}
                >{copy === 'same' ? 'SAME' : copy === 'differs' ? 'DIFFERS' : '—'}</span
              >
            </div>
            {#if copy === 'differs'}
              <p class="muted">
                Compared with the copy Claude Code last synced. Update the skill on claude.ai.
              </p>
            {/if}
            <p>{CLAUDE_AI_TEXT[claudeAi]}</p>
            {#if claudeAi <= 2 || claudeAi === 5}
              <CopyBlock label="TO TURN THE SYNCED COPY OFF" text={overridesBlock([entry.name])} />
              <p>Add it to ~/.claude/settings.json. Loadout never changes that file.</p>
              <p>For every overlap at once, or to turn the sync off:</p>
              <div class="side-buttons">
                <button class="small" onclick={() => (app.page = { name: 'recon' })}
                  >SEE RECON →</button
                >
              </div>
            {/if}
          </section>
        {/if}
        <span class="spacer"></span>
        {#if entry.status !== 'not-a-link'}
          <Tip
            text="Remove the skill from your loadout and its agent links. Asks first."
            place="above"
          >
            <button
              class="decommission"
              aria-label="Decommission skill"
              onclick={() => remove(entry)}
              disabled={busy}>DECOMMISSION SKILL</button
            >
          </Tip>
        {/if}
      </div>
    </div>
  </div>
{/if}
