import { Marked } from 'marked'

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
