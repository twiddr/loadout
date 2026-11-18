import { describe, expect, it } from 'vitest'
import { blockChanges, wordChanges, type Part } from '../src/core/changes'

const afterText = (parts: Part[]): string =>
  parts
    .filter((p) => p.kind !== 'del')
    .map((p) => p.text)
    .join('')

describe('wordChanges', () => {
  it('marks added words and puts removed words where they stood', () => {
    const parts = wordChanges('say so and say why.', 'say so, and say why. Skip praise.')
    expect(parts).toEqual([
      { kind: 'same', text: 'say ' },
      { kind: 'del', text: 'so' },
      { kind: 'add', text: 'so,' },
      { kind: 'same', text: ' and say why. ' },
      { kind: 'add', text: 'Skip praise.' }
    ])
  })

  it('gives the after text back exactly from the kept and added parts', () => {
    const after = '  one\ttwo\n\nthree  four '
    expect(afterText(wordChanges('one two five', after))).toBe(after)
  })

  it('joins a short kept word between two larger changes into one change', () => {
    const parts = wordChanges('aa bb cc the dd ee ff', 'gg hh ii the jj kk ll')
    expect(parts.filter((p) => p.kind === 'same')).toEqual([])
    expect(parts).toEqual([
      { kind: 'del', text: 'aa bb cc the dd ee ff' },
      { kind: 'add', text: 'gg hh ii the jj kk ll' }
    ])
  })

  it('has no marks when nothing changed', () => {
    expect(wordChanges('a b', 'a b')).toEqual([{ kind: 'same', text: 'a b' }])
  })
})

describe('blockChanges', () => {
  const p = (text: string): { tag: string; text: string } => ({ tag: 'P', text })

  it('pairs a reworded block and keeps equal blocks', () => {
    const changes = blockChanges(
      [p('kept'), p('one two three four'), p('end')],
      [p('kept'), p('one two three five'), p('end')]
    )
    expect(changes.map((c) => c.kind)).toEqual(['same', 'changed', 'same'])
  })

  it('removes and adds whole blocks that are not alike', () => {
    const changes = blockChanges(
      [p('kept'), p('a long paragraph about something'), p('end')],
      [p('kept'), p('see the reference file'), p('end')]
    )
    expect(changes).toEqual([
      { kind: 'same', before: 0, after: 0 },
      { kind: 'add', after: 1 },
      { kind: 'del', before: 1 },
      { kind: 'same', before: 2, after: 2 }
    ])
  })

  it('does not pair blocks of a different kind', () => {
    const changes = blockChanges([{ tag: 'LI', text: 'a b c' }], [p('a b c')])
    expect(changes.map((c) => c.kind)).toEqual(['add', 'del'])
  })
})
