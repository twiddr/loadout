<script lang="ts">
  import { CARDS } from './briefing'
  import deployUrl from './briefing/deploy.webp'
  import inspectionUrl from './briefing/inspection.webp'
  import intelUrl from './briefing/intel.webp'
  import oneKitUrl from './briefing/one-kit.webp'
  import reconUrl from './briefing/recon.webp'
  import { TURN_MS, drawTurn, ease } from './pageturn'
  import { briefing } from './state.svelte'

  /** The field-manual spread of each card; `SPREADS[step - 1]`. */
  const SPREADS = [oneKitUrl, deployUrl, reconUrl, intelUrl, inspectionUrl]

  let dialog = $state<HTMLDialogElement>()
  let step = $state(1)
  const card = $derived(CARDS[step - 1])
  const last = $derived(step === CARDS.length)

  // The request can be set before this component mounts (the first state), so an effect opens it.
  $effect(() => {
    if (!briefing.open || !dialog || dialog.open) return
    dialog.showModal()
    // Not the first chevron, which would show a focus ring at launch; the keys work on the window.
    dialog.focus()
  })

  /** The spread images, in card order; all five load at open, so a turn can start from any card. */
  const spreads: HTMLImageElement[] = []
  /** The spreads that are decoded; a turn draws only from these. */
  const decoded = new WeakSet<HTMLImageElement>()
  let leaf = $state<HTMLCanvasElement>()
  let turning = $state(false)
  let frame = 0

  function decode(e: Event): void {
    const img = e.currentTarget as HTMLImageElement
    img.decode().then(
      () => decoded.add(img),
      () => {}
    )
  }

  function endTurn(): void {
    cancelAnimationFrame(frame)
    turning = false
  }

  /** One turn from card `from` to card `to`; a newer turn replaces it. The spread under it is `to` already. */
  function turn(from: number, to: number): void {
    endTurn()
    const source = spreads[from - 1]
    const target = spreads[to - 1]
    const ctx = leaf?.getContext('2d')
    if (!ctx || !decoded.has(source) || !decoded.has(target)) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const direction = to > from ? 1 : -1
    const started = performance.now()
    turning = true
    const paint = (now: number): void => {
      const t = Math.min(1, (now - started) / TURN_MS)
      if (t === 1) {
        endTurn()
        return
      }
      drawTurn(ctx, source, target, direction, ease(t))
      frame = requestAnimationFrame(paint)
    }
    paint(started)
  }

  /** Shows card `to` at once, with its text and controls, and turns the page toward it. */
  function go(to: number): void {
    if (to < 1 || to > CARDS.length || to === step) return
    const from = step
    step = to
    turn(from, to)
  }

  /** Reset on close, not on open: a `toggle` after `showModal()` can arrive late. */
  function onclose(): void {
    endTurn()
    briefing.open = false
    step = 1
    closing = false
  }

  // On the window: a click on Next or Back can remove or disable the focused button, and the
  // focus then leaves the dialog.
  function onkeydown(e: KeyboardEvent): void {
    if (!dialog?.open || closing) return
    if (e.key === 'ArrowRight') go(step + 1)
    else if (e.key === 'ArrowLeft') go(step - 1)
  }
  /** The fade of the card, the dim and the blur; the same as the transitions under `.closing` in app.css. */
  const LEAVE_MS = 680
  let closing = $state(false)

  /** Fades the card and the blur out, then closes, so the page behind comes into focus smoothly. */
  function leave(): void {
    if (closing) return
    endTurn()
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      dialog?.close()
      return
    }
    closing = true
    setTimeout(() => dialog?.close(), LEAVE_MS)
  }

  /** Esc: the native close would skip the fade. */
  function oncancel(e: Event): void {
    e.preventDefault()
    leave()
  }

  /** The last button takes the place of Next, so the second click of a double-click must not close. */
  function finish(e: MouseEvent): void {
    if (e.detail > 1) return
    leave()
  }
</script>

<svelte:window {onkeydown} />

<dialog
  class="cover briefing"
  aria-label="Briefing"
  tabindex="-1"
  data-step={step}
  class:closing
  bind:this={dialog}
  {onclose}
  {oncancel}
>
  {#if briefing.open}
    <!-- A modal dialog stops the page's drag regions, so the dialog carries its own. -->
    <div class="dialog-drag"></div>
    <div class="brief-card">
      <div class="brief-stage">
        <div class="brief-copy">
          <span class="eyebrow">Briefing · {card.eyebrow}</span>
          <h2 class="title">{card.title}</h2>
          <p class="brief-lead">{card.lead}</p>
          <p class="brief-body">{card.body}</p>
          <div class="brief-where"><span>Where</span><span>{card.where}</span></div>
        </div>
        <div class="brief-map">
          <div class="brief-art">
            {#each SPREADS as src, i (src)}
              <img
                {src}
                width="1280"
                height="720"
                alt=""
                hidden={i + 1 !== step}
                bind:this={spreads[i]}
                onload={decode}
              />
            {/each}
            <canvas
              class="brief-leaf"
              width="1280"
              height="720"
              aria-hidden="true"
              hidden={!turning}
              bind:this={leaf}
            ></canvas>
          </div>
        </div>
      </div>
      <div class="brief-foot">
        <div class="brief-pips" role="group" aria-label="Card">
          {#each CARDS as c, i (c.title)}
            <button
              type="button"
              class:done={i + 1 < step}
              class:cur={i + 1 === step}
              aria-label={`Card ${i + 1}: ${c.title}`}
              aria-current={i + 1 === step ? 'step' : undefined}
              onclick={() => go(i + 1)}
            >
              <svg viewBox="14 12 72 34" aria-hidden="true"
                ><path d="M16 32 L50 14 L84 32 L84 44 L50 26 L16 44 Z" /></svg
              >
            </button>
          {/each}
        </div>
        <span class="brief-count">{step} OF {CARDS.length}</span>
        <div class="brief-btns">
          <button type="button" class="brief-skip" onclick={leave}>Skip briefing</button>
          <button type="button" disabled={step === 1} onclick={() => go(step - 1)}>Back</button>
          {#if last}
            <button type="button" class="primary" onclick={finish}
              >{briefing.auto ? 'Report to Boot Camp' : 'Dismissed'}</button
            >
          {:else}
            <button type="button" class="primary" onclick={() => go(step + 1)}>Next</button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</dialog>
