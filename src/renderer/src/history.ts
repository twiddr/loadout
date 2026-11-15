/** What the stack needs of a page; `Page` in state.svelte.ts fits it, with the open pack beside it. */
type Nav = { name: string; skill?: string; pack?: string | null }

/** The back stack keeps this many pages; older ones drop out. */
const MAX_BACK = 50

/** One page per skill and open pack: a tab change on the same skill page is not a new page. */
export function samePage(a: Nav, b: Nav): boolean {
  return a.name === b.name && a.skill === b.skill && (a.pack ?? null) === (b.pack ?? null)
}

/** Records leaving `from` for `to`: `from` goes on the stack unless `to` is the same page. */
export function visit<P extends Nav>(stack: P[], from: P, to: P): void {
  if (samePage(from, to)) return
  stack.push(from)
  if (stack.length > MAX_BACK) stack.shift()
}

/** Takes the most recent page off the stack, skipping pages whose skill or open pack is gone; null when none is left. */
export function takeBack<P extends Nav>(
  stack: P[],
  exists: (skill: string) => boolean,
  packExists: (key: string) => boolean
): P | null {
  for (let page = stack.pop(); page; page = stack.pop()) {
    if (page.skill !== undefined && !exists(page.skill)) continue
    if (page.pack != null && !packExists(page.pack)) continue
    return page
  }
  return null
}
