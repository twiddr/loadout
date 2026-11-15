<script lang="ts">
  /*
   * Loadout mark: three stacked chevron bands, bottom band in the brand accent.
   * Bands follow `currentColor`, so the mark takes the surrounding text colour
   * (graphite on light surfaces, sand on dark). Geometry matches design/loadout-mark.svg.
   */
  let { size = 20, mono = false }: { size?: number; mono?: boolean } = $props()
</script>

<span class="logo" style="--size: {size}px">
  <svg viewBox="14 12 72 76" width={size} height={size * (76 / 72)} role="img" aria-label="Loadout">
    <path d="M16 32 L50 14 L84 32 L84 44 L50 26 L16 44 Z" fill="currentColor" />
    <path d="M16 53 L50 35 L84 53 L84 65 L50 47 L16 65 Z" fill="currentColor" />
    <path
      d="M16 74 L50 56 L84 74 L84 86 L50 68 L16 86 Z"
      fill={mono ? 'currentColor' : 'var(--brand-accent)'}
    />
  </svg>
</span>

<style>
  .logo {
    display: inline-flex;
    align-items: center;
    gap: calc(var(--size) * 0.38);
    color: var(--brand-ink);
    line-height: 1;
  }
  svg {
    display: block;
    flex-shrink: 0;
  }
</style>
