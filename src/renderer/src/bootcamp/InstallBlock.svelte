<script lang="ts">
  import { installChoice } from '../bootcamp'
  import type { InstallTool } from '../format'
  import Icon from '../Icon.svelte'
  import CommandBox from './CommandBox.svelte'
  import { checkAgain, openTerminal } from './actions'

  let {
    tool,
    label,
    homebrew,
    busy
  }: { tool: InstallTool; label: string; homebrew: boolean; busy: boolean } = $props()

  const choice = $derived(installChoice(tool, homebrew))
</script>

<div class="bc-install">
  <span class="bc-install-label">{label}</span>
  {#if choice.brew}
    <span class="bc-alt">WITH HOMEBREW</span>
    <CommandBox lines={choice.brew} />
    <span class="bc-alt">WITHOUT HOMEBREW</span>
  {/if}
  <CommandBox lines={choice.direct} />
  {#if tool === 'git'}
    <p class="bc-hint">
      macOS opens an installer window for Apple's command line developer tools; follow it to the
      end.
    </p>
  {/if}
  <p class="bc-hint">
    Paste the command in Terminal and press Return. When it has finished, press CHECK AGAIN.
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
