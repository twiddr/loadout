<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    title,
    line,
    eyebrow,
    actions,
    lineBody
  }: {
    title: string
    line: string
    eyebrow: string | null
    actions?: Snippet
    /** Replaces `line`, for the header line of an open pack. */
    lineBody?: Snippet
  } = $props()
</script>

<header class="drag page-header">
  <!-- Always present, so the title does not move when the Tessl user arrives after the tool check. -->
  <span class="eyebrow">{eyebrow ?? ''}</span>
  <div class="page-title-row">
    <h1 class="title">{title}</h1>
    {#if actions}<div class="page-actions">{@render actions()}</div>{/if}
  </div>
  <span class="page-line" class:in-pack={lineBody !== undefined}
    >{#if lineBody}{@render lineBody()}{:else}{line}{/if}</span
  >
</header>
