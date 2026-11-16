import { describe, expect, it } from 'vitest'
import { backFrom, samePage, takeBack, visit } from '../src/renderer/src/history'

type Page = {
  name: string
  skill?: string
  tab?: string
  from?: string
  pack?: string | null
  agentId?: string
  entry?: string
}

const skill = (name: string, tab = 'briefing'): Page => ({
  name: 'skill',
  skill: name,
  tab,
  from: 'loadout'
})

describe('history', () => {
  it('treats a tab change on one skill page as the same page', () => {
    expect(samePage(skill('a'), skill('a', 'review'))).toBe(true)
    expect(samePage(skill('a'), skill('b'))).toBe(false)
    expect(samePage({ name: 'recon' }, { name: 'log' })).toBe(false)
  })

  it('stacks each page left, and not a tab change', () => {
    const stack: Page[] = []
    visit(stack, { name: 'loadout' }, skill('a'))
    visit(stack, skill('a'), skill('a', 'review'))
    visit(stack, skill('a', 'review'), { name: 'recon' })
    expect(stack).toEqual([{ name: 'loadout' }, skill('a', 'review')])
  })

  it('treats another open pack as another page', () => {
    const grid: Page = { name: 'loadout', pack: null }
    const open: Page = { name: 'loadout', pack: 'github:acme/tools' }
    expect(samePage(open, { ...open })).toBe(true)
    expect(samePage(grid, open)).toBe(false)
    expect(samePage(grid, { name: 'loadout' })).toBe(true)
    expect(
      samePage({ ...skill('a'), pack: 'github:acme/tools' }, { ...skill('a'), pack: null })
    ).toBe(false)
  })

  it('stacks opening a pack and a member page as steps', () => {
    const stack: Page[] = []
    const grid: Page = { name: 'loadout', pack: null }
    const open: Page = { name: 'loadout', pack: 'github:acme/tools' }
    const member: Page = { ...skill('a'), pack: 'github:acme/tools' }
    visit(stack, grid, open)
    visit(stack, open, member)
    visit(stack, member, { ...member, tab: 'review' })
    expect(stack).toEqual([grid, open])
  })

  it('keeps the last 50 pages', () => {
    const stack: Page[] = []
    for (let i = 0; i < 60; i++) visit(stack, skill(`s${i}`), { name: 'log' })
    expect(stack).toHaveLength(50)
    expect(stack[0]).toEqual(skill('s10'))
  })

  it('goes back past skill pages whose skill is gone', () => {
    const stack: Page[] = [{ name: 'intel' }, skill('kept'), skill('gone')]
    const exists = (name: string): boolean => name === 'kept'
    const packs = (): boolean => true
    expect(takeBack(stack, exists, packs)).toEqual(skill('kept'))
    expect(takeBack(stack, exists, packs)).toEqual({ name: 'intel' })
    expect(takeBack(stack, exists, packs)).toBeNull()
  })

  it('goes back past pages whose open pack is gone', () => {
    const kept: Page = { name: 'loadout', pack: 'github:acme/kept' }
    const gone: Page = { name: 'loadout', pack: 'github:acme/gone' }
    const member: Page = { ...skill('a'), pack: 'github:acme/gone' }
    const stack: Page[] = [{ name: 'loadout', pack: null }, kept, gone, member]
    const exists = (): boolean => true
    const packs = (key: string): boolean => key === 'github:acme/kept'
    expect(takeBack(stack, exists, packs)).toEqual(kept)
    expect(takeBack(stack, exists, packs)).toEqual({ name: 'loadout', pack: null })
    expect(takeBack(stack, exists, packs)).toBeNull()
  })

  it('treats candidate pages for different rows as different pages', () => {
    const cc: Page = { name: 'candidate', agentId: 'claude-code', entry: 'a' }
    const cx: Page = { name: 'candidate', agentId: 'codex', entry: 'a' }
    expect(samePage(cc, cx)).toBe(false)
    expect(samePage(cc, { ...cc })).toBe(true)
  })

  it('skips a candidate page whose row is gone', () => {
    const stack: Page[] = [
      { name: 'recon' },
      { name: 'candidate', agentId: 'claude-code', entry: 'a' }
    ]
    expect(
      takeBack(
        stack,
        () => true,
        () => true,
        () => false
      )
    ).toEqual({ name: 'recon' })
  })

  it('skips a page equal to the shown one, so one press always moves', () => {
    const gone: Page = { name: 'candidate', agentId: 'claude-code', entry: 'a' }
    const stack: Page[] = [{ name: 'loadout' }, { name: 'recon' }, gone]
    const yes = (): boolean => true
    expect(backFrom(stack, { name: 'recon' }, yes, yes, () => false, false)).toEqual({
      name: 'loadout'
    })
  })

  it('drops the open pack in the flat view and skips what then equals the shown page', () => {
    const grid: Page = { name: 'loadout', pack: null }
    const open: Page = { name: 'loadout', pack: 'github:acme/tools' }
    const yes = (): boolean => true
    expect(backFrom([{ name: 'intel' }, open], grid, yes, yes, yes, false)).toEqual(open)
    expect(backFrom([{ name: 'intel' }, open], grid, yes, yes, yes, true)).toEqual({
      name: 'intel',
      pack: null
    })
  })
})
