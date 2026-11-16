/** What the stack needs of a page; `Page` in state.svelte.ts fits it, with the open pack beside it. */
type Nav = {
  name: string
  skill?: string
  pack?: string | null
  /** A Recon candidate page's row. */
  agentId?: string
  entry?: string
}

/** The back stack keeps this many pages; older ones drop out. */
const MAX_BACK = 50

/** One page per skill, open pack and candidate row: a tab change on the same skill page is not a new page. */
export function samePage(a: Nav, b: Nav): boolean {
  return (
    a.name === b.name &&
    a.skill === b.skill &&
    (a.pack ?? null) === (b.pack ?? null) &&
    a.agentId === b.agentId &&
    a.entry === b.entry
  )
}

/** Records leaving `from` for `to`: `from` goes on the stack unless `to` is the same page. */
export function visit<P extends Nav>(stack: P[], from: P, to: P): void {
  if (samePage(from, to)) return
  stack.push(from)
  if (stack.length > MAX_BACK) stack.shift()
}

/** Takes the most recent page off the stack, skipping pages whose skill, open pack or candidate row is gone; null when none is left. */
export function takeBack<P extends Nav>(
  stack: P[],
  exists: (skill: string) => boolean,
  packExists: (key: string) => boolean,
  candidateExists: (agentId: string, entry: string) => boolean = () => true
): P | null {
  for (let page = stack.pop(); page; page = stack.pop()) {
    if (page.skill !== undefined && !exists(page.skill)) continue
    if (page.pack != null && !packExists(page.pack)) continue
    if (page.entry !== undefined && !candidateExists(page.agentId ?? '', page.entry)) continue
    return page
  }
  return null
}

/**
 * The page one Back press goes to from `shown`: past gone pages, and past pages that equal `shown`,
 * so a press always moves. `flat` (the SKILLS view, which never shows a pack) drops the open pack first.
 */
export function backFrom<P extends Nav>(
  stack: P[],
  shown: P,
  exists: (skill: string) => boolean,
  packExists: (key: string) => boolean,
  candidateExists: (agentId: string, entry: string) => boolean,
  flat: boolean
): P | null {
  for (;;) {
    const spot = takeBack(stack, exists, packExists, candidateExists)
    if (!spot) return null
    const page = flat ? { ...spot, pack: null } : spot
    if (!samePage(page, shown)) return page
  }
}
