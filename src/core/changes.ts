// What a fix added and removed, for the marks on the FIX tab's AFTER view. Words, not lines: the
// AFTER view shows the whole file, with added words marked and removed words put back struck out.

export type Part = { kind: 'same' | 'add' | 'del'; text: string }

type Op = 'same' | 'add' | 'del'

// More cells than this and the edit counts as one removal and one addition.
const MAX_CELLS = 4_000_000

/** The shortest edit from a to b as one op per item: kept, added (from b) or removed (from a). */
function diff(a: readonly string[], b: readonly string[]): Op[] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const n = endA - start
  const m = endB - start
  const middle: Op[] = []
  if (n * m > MAX_CELLS) {
    middle.push(...Array<Op>(n).fill('del'), ...Array<Op>(m).fill('add'))
  } else {
    // lcs[i * (m + 1) + j]: the longest common run of a[start + i..] and b[start + j..].
    const lcs = new Uint32Array((n + 1) * (m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * (m + 1) + j] =
          a[start + i] === b[start + j]
            ? lcs[(i + 1) * (m + 1) + j + 1] + 1
            : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        middle.push('same')
        i++
        j++
      } else if (j < m && (i === n || lcs[i * (m + 1) + j + 1] >= lcs[(i + 1) * (m + 1) + j])) {
        middle.push('add')
        j++
      } else {
        middle.push('del')
        i++
      }
    }
  }
  return [...Array<Op>(start).fill('same'), ...middle, ...Array<Op>(a.length - endA).fill('same')]
}

type Run = { same: true; count: number } | { same: false; del: number; add: number }

/** Ops as runs; a short kept run between two larger changes joins them, so a rewritten
 * sentence reads as one removal and one addition, not as fragments around "the" and "and". */
function runs(ops: Op[]): Run[] {
  const out: Run[] = []
  for (const op of ops) {
    const last = out.at(-1)
    if (op === 'same') {
      if (last?.same) last.count++
      else out.push({ same: true, count: 1 })
    } else {
      if (last && !last.same) last[op]++
      else out.push({ same: false, del: op === 'del' ? 1 : 0, add: op === 'add' ? 1 : 0 })
    }
  }
  for (let k = 1; k < out.length - 1; k++) {
    const [prev, run, next] = [out[k - 1], out[k], out[k + 1]]
    if (!run.same || prev.same || next.same) continue
    if (
      run.count > 2 ||
      run.count >= Math.max(prev.del, prev.add) ||
      run.count >= Math.max(next.del, next.add)
    )
      continue
    out.splice(k - 1, 3, {
      same: false,
      del: prev.del + run.count + next.del,
      add: prev.add + run.count + next.add
    })
    k = Math.max(0, k - 3)
  }
  return out
}

/** The after text in kept and added parts, with removed words as del parts where they stood.
 * The same and add parts joined give the after text exactly; del parts hold words only. */
export function wordChanges(before: string, after: string): Part[] {
  const oldWords = before.match(/\S+/g) ?? []
  const tokens = after.match(/\s+|\S+/g) ?? []
  const newWords = tokens.filter((t) => /\S/.test(t))
  const out: Part[] = []
  const push = (kind: Part['kind'], text: string): void => {
    const last = out.at(-1)
    if (last?.kind === kind && kind !== 'del') last.text += text
    else out.push({ kind, text })
  }
  let t = 0 // next after token
  let a = 0 // next before word
  // Copies the whitespace before the next after word; inside an addition it is part of it.
  const space = (kind: Part['kind']): void => {
    while (t < tokens.length && !/\S/.test(tokens[t])) push(kind, tokens[t++])
  }
  space('same')
  for (const run of runs(diff(oldWords, newWords))) {
    if (run.same) {
      for (let k = 0; k < run.count; k++) {
        push('same', tokens[t++])
        a++
        space('same')
      }
      continue
    }
    if (run.del > 0) {
      push('del', oldWords.slice(a, a + run.del).join(' '))
      a += run.del
    }
    for (let k = 0; k < run.add; k++) {
      push('add', tokens[t++])
      space(k < run.add - 1 ? 'add' : 'same')
    }
  }
  return out
}

/** How much of two texts is the same, from 0 to 1, by words. */
export function likeness(parts: Part[]): number {
  let same = 0
  let total = 0
  for (const part of parts) {
    const words = part.text.match(/\S+/g)?.length ?? 0
    if (part.kind === 'same') same += 2 * words
    total += part.kind === 'same' ? 2 * words : words
  }
  return total === 0 ? 1 : same / total
}

export type Block = { tag: string; text: string }

export type BlockChange =
  | { kind: 'same'; before: number; after: number }
  | { kind: 'changed'; before: number; after: number; parts: Part[] }
  | { kind: 'add'; after: number }
  | { kind: 'del'; before: number }

// Below this likeness a changed block shows as one removed block and one added block.
const PAIR = 0.5

/** Lines up the blocks (paragraphs, headings, list items) of two versions. Equal blocks are kept;
 * between them, a removed and an added block of the same kind that are alike enough pair up as a
 * changed block with word marks, and the rest are removed or added whole. */
export function blockChanges(before: Block[], after: Block[]): BlockChange[] {
  const key = (b: Block): string => `${b.tag}\n${b.text}`
  const ops = diff(before.map(key), after.map(key))
  const out: BlockChange[] = []
  let i = 0
  let j = 0
  let dels: number[] = []
  let adds: number[] = []
  const flush = (): void => {
    let from = 0
    for (const add of adds) {
      let paired = false
      for (let k = from; k < dels.length; k++) {
        if (before[dels[k]].tag !== after[add].tag) continue
        const parts = wordChanges(before[dels[k]].text, after[add].text)
        if (likeness(parts) < PAIR) continue
        for (const del of dels.slice(from, k)) out.push({ kind: 'del', before: del })
        out.push({ kind: 'changed', before: dels[k], after: add, parts })
        from = k + 1
        paired = true
        break
      }
      if (!paired) out.push({ kind: 'add', after: add })
    }
    for (const del of dels.slice(from)) out.push({ kind: 'del', before: del })
    dels = []
    adds = []
  }
  for (const op of ops) {
    if (op === 'same') {
      flush()
      out.push({ kind: 'same', before: i++, after: j++ })
    } else if (op === 'del') dels.push(i++)
    else adds.push(j++)
  }
  flush()
  return out
}
