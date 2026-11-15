<script lang="ts">
  /* Rank chevrons: one logo band per agent a skill is issued to. */
  let { count, size = 14 }: { count: number; size?: number } = $props()
  const height = $derived(34 + 21 * (count - 1))
</script>

{#if count > 0}
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
{/if}
