import { Marked } from 'marked'
import { blockChanges, type Part } from '../../core/changes'

const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Raw HTML in a SKILL.md shows as text (ADR 20261108-markdown-with-marked). marked also passes text
// after an inline <code>, <kbd>, <pre> or <script> tag through as raw, so `text` escapes that too.
const marked = new Marked({
  renderer: {
    html: ({ text }) => esc(text),
    text: (token) => ('escaped' in token && token.escaped ? esc(token.text) : false)
  }
})

export function renderMarkdown(body: string): string {
  return marked.parse(body, { async: false })
}

// Blocks whose own text is compared: a list item's own text leaves out a nested list.
const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,pre,td,th,dt,dd'

type Found = { el: Element; texts: Text[]; text: string }

function blocksOf(root: Element): Found[] {
  const found: Found[] = []
  for (const el of root.querySelectorAll(BLOCKS)) {
    const texts: Text[] = []
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest(BLOCKS) === el) texts.push(node as Text)
    }
    const text = texts.map((t) => t.data).join('')
    if (/\S/.test(text)) found.push({ el, texts, text })
  }
  return found
}

function wrap(doc: Document, tag: 'ins' | 'del', text: string): Element {
  const el = doc.createElement(tag)
  el.textContent = text
  return el
}

/** Marks added words with <ins> and puts removed words back as <del>, inside one block. */
function markBlock(doc: Document, block: Found, parts: Part[]): void {
  const adds: [number, number][] = []
  const dels: { at: number; text: string }[] = []
  let at = 0
  for (const part of parts) {
    if (part.kind === 'del') dels.push({ at, text: part.text })
    else {
      if (part.kind === 'add') adds.push([at, at + part.text.length])
      at += part.text.length
    }
  }
  const end = at
  let start = 0
  block.texts.forEach((node, index) => {
    const stop = start + node.data.length
    const last = index === block.texts.length - 1
    const here = dels.filter((d) => (d.at >= start && d.at < stop) || (last && d.at === stop))
    const cuts = new Set([start, stop, ...here.map((d) => d.at)])
    for (const [s, e] of adds) {
      if (s < stop && e > start) cuts.add(Math.max(s, start)).add(Math.min(e, stop))
    }
    const points = [...cuts].sort((x, y) => x - y)
    const out = doc.createDocumentFragment()
    points.forEach((x, k) => {
      for (const d of here.filter((d) => d.at === x)) {
        if (x === end) out.append(' ', wrap(doc, 'del', d.text))
        else out.append(wrap(doc, 'del', d.text), ' ')
      }
      const y = points[k + 1]
      if (y === undefined) return
      const text = node.data.slice(x - start, y - start)
      out.append(adds.some(([s, e]) => x >= s && y <= e) ? wrap(doc, 'ins', text) : text)
    })
    node.replaceWith(out)
    start = stop
  })
}

function wrapTexts(doc: Document, root: Node, tag: 'ins' | 'del'): void {
  const texts: Text[] = []
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text)
  for (const node of texts) if (/\S/.test(node.data)) node.replaceWith(wrap(doc, tag, node.data))
}

/** The element and its ancestors below root, innermost first. */
function chain(el: Element, root: Element): Element[] {
  const out: Element[] = []
  for (let e: Element | null = el; e && e !== root; e = e.parentElement) out.push(e)
  return out
}

/** The after version rendered whole, with what the fix added in <ins> and what it removed put
 * back in <del>: words inside a changed block, and whole blocks that are gone. */
export function renderMarkdownChanges(before: string, after: string): string {
  const parser = new DOMParser()
  const old = parser.parseFromString(renderMarkdown(before), 'text/html')
  const doc = parser.parseFromString(renderMarkdown(after), 'text/html')
  const oldBlocks = blocksOf(old.body)
  const newBlocks = blocksOf(doc.body)
  const changes = blockChanges(
    oldBlocks.map((b) => ({ tag: b.el.tagName, text: b.text })),
    newBlocks.map((b) => ({ tag: b.el.tagName, text: b.text }))
  )
  const removed = new Set(
    changes.flatMap((c) => (c.kind === 'del' ? [oldBlocks[c.before].el] : []))
  )
  // A removed block goes in whole with the largest container whose blocks are all removed.
  const unitOf = (el: Element): Element => {
    let unit = el
    for (let up = el.parentElement; up && up !== old.body; up = up.parentElement) {
      if (!oldBlocks.every((b) => !up.contains(b.el) || removed.has(b.el))) break
      unit = up
    }
    return unit
  }
  const units: { unit: Element; prev: Element | null; next: Element | null }[] = []
  const seen = new Set<Element>()
  const anchors = changes.flatMap((c) =>
    c.kind === 'same' || c.kind === 'changed' ? [newBlocks[c.after].el] : []
  )
  let kept = 0
  for (const c of changes) {
    if (c.kind === 'same' || c.kind === 'changed') kept++
    if (c.kind === 'changed') markBlock(doc, newBlocks[c.after], c.parts)
    if (c.kind === 'add') {
      for (const t of newBlocks[c.after].texts)
        if (/\S/.test(t.data)) t.replaceWith(wrap(doc, 'ins', t.data))
    }
    if (c.kind !== 'del') continue
    const unit = unitOf(oldBlocks[c.before].el)
    if (seen.has(unit)) continue
    seen.add(unit)
    units.push({ unit, prev: anchors[kept - 1] ?? null, next: anchors[kept] ?? null })
  }
  const lastPlaced = new Map<Element, Element>()
  for (const { unit, prev, next } of units) {
    const copy = unit.cloneNode(true) as Element
    wrapTexts(doc, copy, 'del')
    const path = chain(unit, old.body)
    const depth = path.length - 1
    // The anchor's ancestor at the unit's depth, when it sits in the same kind of container.
    const peer = (anchor: Element | null): Element | null => {
      if (!anchor) return null
      const up = chain(anchor, doc.body)
      const target = up[up.length - 1 - depth]
      const same = (a: Element | null, b: Element | null): boolean =>
        a === doc.body ? b === old.body : a?.tagName === b?.tagName
      return target && same(target.parentElement, unit.parentElement) ? target : null
    }
    const after = peer(prev)
    const before = after ? null : peer(next)
    if (after) {
      ;(lastPlaced.get(after) ?? after).after(copy)
      lastPlaced.set(after, copy)
    } else if (before) {
      before.before(copy)
    } else {
      // No peer: carry the unit's containers along (a list item keeps its list).
      let top = copy
      for (const up of path.slice(1)) {
        const shell = up.cloneNode(false) as Element
        shell.append(top)
        top = shell
      }
      const root = prev ? (chain(prev, doc.body).at(-1) ?? null) : null
      if (root) {
        ;(lastPlaced.get(root) ?? root).after(top)
        lastPlaced.set(root, top)
      } else doc.body.prepend(top)
    }
  }
  return doc.body.innerHTML
}
