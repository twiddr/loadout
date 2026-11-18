<script lang="ts">
  import type { Snippet } from 'svelte'

  /*
   * A hover and focus tip around one element, in the `.tip` style. The tip is a popover in the top
   * layer, anchored to the element: a `.cut` card's clip-path or a scrolling column cannot cut it,
   * and it flips when it meets the window edge. The `.tip` hover and focus rules show it, as for
   * every tip; the popover only lifts it. A pointer that jumps into a drag region sends no
   * pointerleave, so the popover can stay open there, hidden. The text is drawn from `data-tip`,
   * so it never joins the text of the element around it (an alert, a status line, a card), and
   * `aria-hidden` keeps it out of a container's accessible name; `aria-describedby` still reads
   * its `aria-label`.
   */
  let {
    text,
    place = 'below',
    end = false,
    overflow = false,
    children
  }: {
    /** The tip; an empty text draws the element alone. */
    text: string
    /** `side` opens to the right of the element. */
    place?: 'below' | 'above' | 'side'
    /** Aligns the tip with the element's right edge. */
    end?: boolean
    /** For text cut with an ellipsis: the tip shows the full text, and only while it is cut. */
    overflow?: boolean
    children: Snippet
  } = $props()

  const id = $props.id()
  let tip = $state<HTMLElement>()

  // The tip describes the control, also when a label wraps it (the agent toggles).
  function describe(node: HTMLElement): void {
    const el = node.firstElementChild
    const control = el?.matches('button, input, a') ? el : el?.querySelector('button, input, a')
    ;(control ?? el)?.setAttribute('aria-describedby', id)
  }

  function show(e: Event): void {
    const el = (e.currentTarget as HTMLElement).firstElementChild
    if (overflow && (el === null || el.scrollWidth <= el.clientWidth)) return
    // Shown again, so it lands above a dialog opened since.
    hide()
    tip?.showPopover()
  }

  function hide(): void {
    if (tip?.matches(':popover-open')) tip.hidePopover()
  }
</script>

{#if text}
  <!-- The handlers only open and close the tip; the element inside is the control. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span
    class="tip anchored {place}"
    class:end
    class:fill={overflow}
    onpointerenter={show}
    onpointerleave={hide}
    onfocusin={(e) => {
      if ((e.target as HTMLElement).matches(':focus-visible')) show(e)
    }}
    onfocusout={hide}
    {@attach describe}
    >{@render children()}<span
      bind:this={tip}
      popover="manual"
      class="tip-text float"
      {id}
      role="tooltip"
      aria-hidden="true"
      aria-label={text}
      data-tip={text}
    ></span></span
  >
{:else}
  {@render children()}
{/if}
