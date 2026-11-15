import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/renderer/src/markdown'

describe('renderMarkdown', () => {
  it('renders headings and lists', () => {
    const html = renderMarkdown('# T\n\n- a\n')
    expect(html).toContain('<h1')
    expect(html).toContain('<li>a</li>')
  })

  it('escapes raw HTML', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
  })

  it('escapes block HTML', () => {
    const html = renderMarkdown('<div onclick="x()">\nhi\n</div>\n')
    expect(html).not.toContain('<div')
  })

  it('escapes HTML after an inline code tag', () => {
    expect(renderMarkdown('x <code><img/src=x/onerror=alert(1)></code>')).not.toContain('<img')
  })

  it('escapes HTML inside a kbd tag', () => {
    expect(renderMarkdown('x <kbd>a <svg/onload=alert(1)> b</kbd>')).not.toContain('<svg')
  })

  it('keeps plain text, ampersands and escapes correct', () => {
    const html = renderMarkdown('a & b \\*x\\*\n\n## H\n\n1. one\n')
    expect(html).toContain('a &amp; b *x*')
    expect(html).toContain('<h2')
    expect(html).toContain('<li>one</li>')
  })

  it('renders a fenced block', () => {
    expect(renderMarkdown('```sh\necho hi\n```\n')).toContain('<pre><code')
  })
})
