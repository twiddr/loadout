import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CARDS } from '../src/renderer/src/briefing'
import { ease, leafEdges } from '../src/renderer/src/pageturn'

describe('briefing', () => {
  it('has five cards with every text filled and the approved titles', () => {
    expect(CARDS.map((c) => c.title)).toEqual(['ONE KIT', 'DEPLOY', 'RECON', 'INTEL', 'INSPECTION'])
    for (const c of CARDS) for (const v of Object.values(c)) expect(v.length).toBeGreaterThan(0)
    expect(CARDS[1].body).toContain('platoon')
    expect(JSON.stringify(CARDS)).not.toMatch(/squad/i)
  })

  // The page turn draws in the coordinates of a 1280 x 720 spread.
  it.each(['one-kit', 'deploy', 'recon', 'intel', 'inspection'])(
    'ships the %s spread as a 1280 x 720 WebP',
    (name) => {
      const bytes = readFileSync(join(__dirname, '../src/renderer/src/briefing', `${name}.webp`))
      expect(bytes.toString('latin1', 0, 4)).toBe('RIFF')
      expect(bytes.toString('latin1', 8, 16)).toBe('WEBPVP8 ')
      expect([bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff]).toEqual([
        1280, 720
      ])
    }
  )
})

describe('page turn', () => {
  const freeEdge = (direction: 1 | -1, progress: number): number =>
    leafEdges(direction, progress).at(-1)?.x ?? Number.NaN

  it('turns the right leaf leftward on Next and the left leaf rightward on Back', () => {
    // The spine is at 638 and a page is 518 wide.
    expect(freeEdge(1, 0)).toBeCloseTo(1156)
    expect(freeEdge(1, 1)).toBeCloseTo(120)
    expect(freeEdge(-1, 0)).toBeCloseTo(120)
    expect(freeEdge(-1, 1)).toBeCloseTo(1156)
  })

  it('keeps the bound edge on the spine and lifts the paper in the middle of the turn', () => {
    const edges = leafEdges(1, 0.5)
    expect(edges[0]).toEqual({ x: 638, y: 40, h: 628 })
    expect(edges.at(-1)?.h ?? 0).toBeGreaterThan(628)
    for (const e of leafEdges(1, 0)) expect(e.h).toBeCloseTo(628)
  })

  it('starts and ends the turn slowly', () => {
    expect(ease(0)).toBe(0)
    expect(ease(0.5)).toBe(0.5)
    expect(ease(1)).toBe(1)
    expect(ease(0.1)).toBeLessThan(0.1)
  })
})
