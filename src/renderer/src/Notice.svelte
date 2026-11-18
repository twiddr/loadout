<script lang="ts">
  import Icon from './Icon.svelte'
  import { app } from './state.svelte'
  import Tip from './Tip.svelte'

  let { extra = '' }: { extra?: string } = $props()
</script>

<!-- The page's refusal or failure message; the X clears it. -->
{#if app.notice}
  <p class="notice dismissable {extra}" role="alert">
    <span class="notice-text">{app.notice}</span>
    <Tip text="Dismiss" end>
      <button
        class="icon small-icon notice-close"
        aria-label="Dismiss"
        onclick={() => (app.notice = null)}><Icon name="x" size={13} /></button
      >
    </Tip>
  </p>
{/if}
