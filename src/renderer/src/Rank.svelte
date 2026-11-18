<script lang="ts">
  import Tip from './Tip.svelte'

  /* Rank chevrons: one logo band per agent a skill is issued to. */
  let { count, size = 14, end = false }: { count: number; size?: number; end?: boolean } = $props()
  const height = $derived(34 + 21 * (count - 1))
</script>

{#if count > 0}
  <Tip text={count === 1 ? 'Deployed to 1 agent' : `Deployed to ${count} agents`} {end}>
    <svg
      viewBox="14 12 72 {height}"
      width={size}
      height={size * (height / 72)}
      role="img"
      aria-label={count === 1 ? 'Issued to 1 agent' : `Issued to ${count} agents`}
    >
      {#each { length: count }, i (i)}
        <path
          d="M16 32 L50 14 L84 32 L84 44 L50 26 L16 44 Z"
          transform="translate(0 {21 * i})"
          fill="var(--ink)"
        />
      {/each}
    </svg>
  </Tip>
{/if}
