import { describe, expect, it } from 'vitest'
import { CARDS, LAYERS, VIEWS, layerOn, worldTransform } from '../src/renderer/src/briefing'

describe('briefing', () => {
  it('has five cards with every text filled and the approved titles', () => {
    expect(CARDS.map((c) => c.title)).toEqual(['ONE KIT', 'DEPLOY', 'RECON', 'INTEL', 'INSPECTION'])
    for (const c of CARDS) for (const v of Object.values(c)) expect(v.length).toBeGreaterThan(0)
    expect(CARDS[1].body).toContain('platoon')
    expect(JSON.stringify(CARDS)).not.toMatch(/squad/i)
  })

  it('has the five approved views', () => {
    expect(VIEWS).toEqual([
      { x: 222, y: 76, w: 560 },
      { x: 308, y: 0, w: 685 },
      { x: 513, y: 257, w: 480 },
      { x: 0, y: 0, w: 690 },
      { x: 0, y: 176, w: 641 }
    ])
  })

  it('scales the world so the view width shows w units', () => {
    expect(worldTransform({ x: 0, y: 176, w: 641 }, 641)).toBe('scale(1) translate(0px, -176px)')
    expect(worldTransform({ x: 222, y: 76, w: 560 }, 280)).toBe(
      'scale(0.5) translate(-222px, -76px)'
    )
  })

  it.each([
    ['supply', [false, true, true, false, true]],
    ['trucks', [false, true, false, false, false]],
    ['recon', [false, false, true, false, false]],
    ['intel', [false, false, false, true, true]],
    ['publish', [false, false, false, false, true]],
    ['heli', [false, false, false, false, true]]
  ] as const)('shows the %s layer on the right cards', (name, expected) => {
    expect([1, 2, 3, 4, 5].map((step) => layerOn(LAYERS[name], step))).toEqual(expected)
  })
})
