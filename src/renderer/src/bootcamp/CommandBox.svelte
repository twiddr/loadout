<script lang="ts">
  import { api } from '../api'
  import Icon from '../Icon.svelte'
  import { app } from '../state.svelte'

  let { lines, autofocus = false }: { lines: string[]; autofocus?: boolean } = $props()

  let copied = $state(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  async function copy(): Promise<void> {
    const result = await api.invoke('copy-text', { text: lines.join('\n') })
    if (!result.ok) {
      app.notice = `Copy failed: ${result.message}`
      return
    }
    copied = true
    clearTimeout(timer)
    timer = setTimeout(() => (copied = false), 1500)
  }
</script>

<div class="bc-cmd">
  <pre>{#each lines as line, i (i)}<span class="l">{line}</span>{/each}</pre>
  <!-- svelte-ignore a11y_autofocus -->
  <button
    type="button"
    class="small bc-copy"
    aria-label="Copy the command"
    {autofocus}
    onclick={copy}
    ><Icon name={copied ? 'check' : 'copy'} size={12} />{copied ? 'COPIED' : 'COPY'}</button
  >
</div>
