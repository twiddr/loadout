<script lang="ts">
  import { CARDS, LAYERS, VIEWS, layerOn, worldTransform } from './briefing'
  import droneUrl from './briefing/drone.webp'
  import frameUrl from './briefing/frame.webp'
  import heliUrl from './briefing/heli.webp'
  import mapUrl from './briefing/map.webp'
  import truckUrl from './briefing/truck.webp'
  import { briefing } from './state.svelte'

  let dialog = $state<HTMLDialogElement>()
  let step = $state(1)
  const card = $derived(CARDS[step - 1])
  const last = $derived(step === CARDS.length)
  /** The width of the tablet's screen in pixels; the world is drawn once it is measured. */
  let viewWidth = $state(0)
  const on = $derived({
    supply: layerOn(LAYERS.supply, step),
    trucks: layerOn(LAYERS.trucks, step),
    recon: layerOn(LAYERS.recon, step),
    intel: layerOn(LAYERS.intel, step),
    publish: layerOn(LAYERS.publish, step),
    heli: layerOn(LAYERS.heli, step)
  })

  // The request can be set before this component mounts (the first state), so an effect opens it.
  $effect(() => {
    if (!briefing.open || !dialog || dialog.open) return
    dialog.showModal()
    // Not the first chevron, which would show a focus ring at launch; the keys work on the window.
    dialog.focus()
  })

  // The power-up starts a moment after the map and the frame are loaded, so the user sees all of it:
  // at launch the window can show later than this component mounts.
  let loaded = $state(0)
  let boot = $state(false)
  $effect(() => {
    if (loaded < 2) return
    const timer = setTimeout(() => (boot = true), 500)
    return () => clearTimeout(timer)
  })

  /** Reset on close, not on open: a `toggle` after `showModal()` can arrive late. */
  function onclose(): void {
    briefing.open = false
    step = 1
    loaded = 0
    boot = false
    closing = false
  }

  // On the window: a click on Next or Back can remove or disable the focused button, and the
  // focus then leaves the dialog.
  function onkeydown(e: KeyboardEvent): void {
    if (!dialog?.open || closing) return
    if (e.key === 'ArrowRight' && !last) step += 1
    else if (e.key === 'ArrowLeft' && step > 1) step -= 1
  }
  /** The fade of the card, the dim and the blur; the same as the transitions under `.closing` in app.css. */
  const LEAVE_MS = 680
  let closing = $state(false)

  /** Fades the card and the blur out, then closes, so the page behind comes into focus smoothly. */
  function leave(): void {
    if (closing) return
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
          <div class="brief-pad">
            <div class="brief-view" class:boot bind:clientWidth={viewWidth}>
              {#if viewWidth > 0}
                <div
                  class="brief-world"
                  style:transform={worldTransform(VIEWS[step - 1], viewWidth)}
                >
                  <img class="brief-mapimg" src={mapUrl} alt="" onload={() => (loaded += 1)} />
                  <svg class="brief-ov" viewBox="0 0 993 497" aria-hidden="true">
                    <defs>
                      <marker
                        id="brief-ah"
                        markerUnits="userSpaceOnUse"
                        markerWidth="20"
                        markerHeight="20"
                        refX="7"
                        refY="10"
                        orient="auto"><path class="brief-ahp" d="M0 0 L20 10 L0 20 Z" /></marker
                      >
                    </defs>
                    <g data-layer="supply" class:on={on.supply}>
                      <path
                        class="brief-arrow"
                        marker-end="url(#brief-ah)"
                        d="M665 148 C720 140 790 110 836 86"
                      />
                      <path
                        class="brief-arrow"
                        marker-end="url(#brief-ah)"
                        d="M672 226 C730 222 800 200 844 185"
                      />
                      <path
                        class="brief-arrow"
                        marker-end="url(#brief-ah)"
                        d="M675 291 C740 305 800 298 842 282"
                      />
                    </g>
                    <g data-layer="recon" class:on={on.recon}>
                      <path
                        class="brief-bracket"
                        d="M785 402 V388 H799 M851 388 H865 V402 M865 436 V450 H851 M799 450 H785 V436"
                      />
                      <path
                        class="brief-arrow dot"
                        marker-end="url(#brief-ah)"
                        d="M772 436 C700 444 610 424 556 372"
                      />
                    </g>
                    <g data-layer="intel" class:on={on.intel}>
                      <circle class="brief-ring" cx="94" cy="68" r="56" />
                      <circle class="brief-ring d1" cx="94" cy="68" r="56" />
                      <circle class="brief-ring d2" cx="94" cy="68" r="56" />
                      <path
                        class="brief-arrow"
                        marker-end="url(#brief-ah)"
                        d="M140 92 C205 110 265 148 316 172"
                      />
                    </g>
                    <g data-layer="publish" class:on={on.publish}>
                      <path
                        class="brief-arrow"
                        marker-end="url(#brief-ah)"
                        d="M325 246 C270 250 205 262 152 272"
                      />
                      <rect class="brief-pulse" x="368" y="376" width="158" height="86" rx="10" />
                    </g>
                  </svg>
                  <div class="brief-lay" data-layer="trucks" class:on={on.trucks}>
                    <div class="brief-spr brief-truck t1">
                      <i class="brief-dust"></i><i class="brief-dust b"></i><img
                        src={truckUrl}
                        alt=""
                      />
                    </div>
                    <div class="brief-spr brief-truck t2">
                      <i class="brief-dust"></i><i class="brief-dust b"></i><img
                        src={truckUrl}
                        alt=""
                      />
                    </div>
                  </div>
                  <div class="brief-spr brief-drone" data-layer="recon" class:on={on.recon}>
                    <i class="brief-cone"></i><img src={droneUrl} alt="" />
                  </div>
                  <span
                    class="brief-plate"
                    data-layer="recon"
                    class:on={on.recon}
                    style="left:660px;top:404px">RECRUIT</span
                  >
                  <span
                    class="brief-plate"
                    data-layer="intel"
                    class:on={on.intel}
                    style="left:240px;top:112px">UPDATE</span
                  >
                  <div class="brief-lay" data-layer="heli" class:on={on.heli}>
                    <div class="brief-spr brief-heli">
                      <img src={heliUrl} alt="" /><i class="brief-rotor"></i><i
                        class="brief-rotor tail"
                      ></i>
                    </div>
                  </div>
                  <span
                    class="brief-plate"
                    data-layer="publish"
                    class:on={on.publish}
                    style="left:236px;top:290px">PUBLISH</span
                  >
                </div>
              {/if}
              <div class="brief-scan"></div>
              <div class="brief-sweep"></div>
              <svg class="brief-noise" aria-hidden="true">
                <filter id="brief-nz" x="0" y="0" width="100%" height="100%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3">
                    <animate
                      attributeName="seed"
                      values="1;7;3;9;5;2;8;4;6"
                      dur="0.45s"
                      calcMode="discrete"
                      repeatCount="indefinite"
                    />
                  </feTurbulence>
                  <feColorMatrix
                    type="matrix"
                    values="0 0 0 0 0.30  0 0 0 0 0.33  0 0 0 0 0.27  1.6 1.6 1.6 0 -2.1"
                  />
                </filter>
                <rect width="100%" height="100%" filter="url(#brief-nz)" />
              </svg>
            </div>
            <img
              class="brief-frame"
              src={frameUrl}
              width="1280"
              height="720"
              alt=""
              onload={() => (loaded += 1)}
            />
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
              onclick={() => (step = i + 1)}
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
          <button type="button" disabled={step === 1} onclick={() => (step -= 1)}>Back</button>
          {#if last}
            <button type="button" class="primary" onclick={finish}
              >{briefing.auto ? 'Report to Boot Camp' : 'Dismissed'}</button
            >
          {:else}
            <button type="button" class="primary" onclick={() => (step += 1)}>Next</button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</dialog>
