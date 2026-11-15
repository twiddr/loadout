<script lang="ts">
  import type { State } from '../../core/ipc'
  import { api } from './api'
  import { isFailed, plural, runs, runText, stoppedText, type Run } from './format'
  import Icon from './Icon.svelte'
  import Notice from './Notice.svelte'
  import PageHeader from './PageHeader.svelte'
  import { app } from './state.svelte'

  let { state: status, eyebrow }: { state: State; eyebrow: string | null } = $props()
  // The tool check holds `busy` too, but it is not a command: no strip, no Cancel.
  const running = $derived(status.startup.mustering ? null : status.busy)

  let filter = $state<'all' | 'failed'>('all')
  /** The run whose copy button shows a tick for a moment. */
  let copied = $state<number | null>(null)

  async function copy(run: Run): Promise<void> {
    const result = await api.invoke('copy-text', { text: runText(run) })
    if (!result.ok) {
      app.notice = `Copy failed: ${result.message}`
      return
    }
    copied = run.runId
    setTimeout(() => {
      if (copied === run.runId) copied = null
    }, 1500)
  }

  const all = $derived(runs(app.log))
  const failed = $derived(all.filter(isFailed))
  const shown = $derived(filter === 'failed' ? failed : all)

  function chip(r: Run): { text: string; kind: 'running' | 'ok' | 'bad' | 'cancelled' } | null {
    if (r.command === undefined) return null
    if (r.exit === undefined) return { text: 'RUNNING', kind: 'running' }
    if (r.exit === null) {
      const kind = r.stopped === 'cancelled' ? 'cancelled' : 'bad'
      return { text: stoppedText(r).toUpperCase(), kind }
    }
    return r.exit === 0 ? { text: 'EXIT 0', kind: 'ok' } : { text: `EXIT ${r.exit}`, kind: 'bad' }
  }
</script>

<PageHeader
  title="LOG"
  line={`${all.length} ${plural(all.length, 'RUN', 'RUNS')} THIS SESSION · ${running ? 1 : 0} RUNNING · ${failed.length} FAILED`}
  {eyebrow}
>
  {#snippet actions()}
    <button class="filter-chip" aria-pressed={filter === 'all'} onclick={() => (filter = 'all')}>
      All <span aria-hidden="true">{all.length}</span>
    </button>
    <button
      class="filter-chip"
      aria-pressed={filter === 'failed'}
      onclick={() => (filter = 'failed')}
    >
      <span class="swatch-sq bad"></span>Failed <span aria-hidden="true">{failed.length}</span>
    </button>
    <button onclick={() => (app.log = [])}>Clear</button>
  {/snippet}
</PageHeader>
<Notice />

<div class="view log-view">
  {#if running}
    <div class="run-strip hazard">
      <div class="run-strip-body">
        <Icon name="spinner" size={16} />
        <span class="run-strip-label">RUNNING</span>
        <span class="run-strip-command">{running}</span>
        <button class="small" onclick={() => api.invoke('cancel')}>Cancel</button>
      </div>
    </div>
  {/if}
  {#each shown as run (run.runId)}
    {@const c = chip(run)}
    <article
      class="run-card"
      class:failed={isFailed(run)}
      class:running={run.exit === undefined && run.command !== undefined}
      aria-label={`Run ${run.runId}`}
    >
      <div class="run-head">
        <span class="run-id">RUN {run.runId}</span>
        <span class="run-action">{run.action?.toUpperCase() ?? ''}</span>
        <span class="run-command">
          {#if run.command !== undefined}<span class="run-prompt">$ </span>{run.command}{/if}
        </span>
        {#if c}<span class="run-chip {c.kind}">{c.text}</span>{/if}
        <button
          class="icon small-icon"
          aria-label={`Copy run ${run.runId}`}
          title="Copy the command and its output"
          onclick={() => copy(run)}
          ><Icon name={copied === run.runId ? 'check' : 'copy'} size={13} /></button
        >
      </div>
      {#if run.lines.length > 0}
        <div class="run-lines">
          {#each run.lines as line, i (i)}
            <span class="run-line {line.stream}">{line.text}</span>
          {/each}
        </div>
      {/if}
    </article>
  {:else}
    <p class="no-match">
      {filter === 'failed' ? 'No failed run.' : 'No command has run in this session.'}
    </p>
  {/each}
</div>
