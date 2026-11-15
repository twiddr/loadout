<script lang="ts">
  import { api } from './api'
  import Icon from './Icon.svelte'
  import { app } from './state.svelte'

  let { label, text }: { label: string; text: string } = $props()

  let copied = $state(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  async function copy(): Promise<void> {
    const result = await api.invoke('copy-text', { text })
    if (!result.ok) {
      app.notice = `Copy failed: ${result.message}`
      return
    }
    copied = true
    clearTimeout(timer)
    timer = setTimeout(() => (copied = false), 1500)
  }
</script>

<div class="copy-head">
  <span class="copy-label">{label}</span>
  <button type="button" class="small" aria-label={`Copy: ${label}`} onclick={copy}
    ><Icon name={copied ? 'check' : 'copy'} size={12} />COPY</button
  >
</div>
<pre class="copy-block">{text}</pre>
