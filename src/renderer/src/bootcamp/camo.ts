/**
 * Three-colour desert camouflage for the rank badge: sand ground with tan and brown patches.
 * Each chevron gets its own tile from its own seed. The tiles are seeded, so they are the same on every launch.
 */

export const CAMO_GROUND = '#d4c09a'
/** Tile size in the badge's viewBox units. */
export const CAMO_TILE = 40

const LAYERS = [
  { fill: '#b39566', count: 5, radius: 7, stretch: 2 },
  { fill: '#8d7353', count: 4, radius: 4.5, stretch: 2.2 }
]

export type CamoTile = { id: string; layers: { fill: string; d: string }[] }

function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const r1 = (n: number): number => Math.round(n * 10) / 10

/** A smooth irregular patch, drawn again at the tile's eight neighbours so the tile repeats without seams. */
function patch(rand: () => number, cx: number, cy: number, r: number, stretch: number): string {
  const k = 7
  const rot = rand() * Math.PI
  const pts: [number, number][] = []
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2
    const rr = r * (0.6 + rand() * 0.6)
    const x = Math.cos(a) * rr * stretch
    const y = Math.sin(a) * rr
    pts.push([x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)])
  }
  const mid = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2
  ]
  let d = ''
  for (const ox of [-CAMO_TILE, 0, CAMO_TILE]) {
    for (const oy of [-CAMO_TILE, 0, CAMO_TILE]) {
      const p = pts.map(([x, y]): [number, number] => [cx + x + ox, cy + y + oy])
      const m0 = mid(p[k - 1], p[0])
      d += `M${r1(m0[0])} ${r1(m0[1])}`
      for (let i = 0; i < k; i++) {
        const m = mid(p[i], p[(i + 1) % k])
        d += `Q${r1(p[i][0])} ${r1(p[i][1])} ${r1(m[0])} ${r1(m[1])}`
      }
      d += 'Z'
    }
  }
  return d
}

/** One tile per chevron: bottom (AGENTS), middle (GIT), top (TESSL). */
export const CAMO_TILES: CamoTile[] = [0, 1, 2].map((k) => {
  const rand = random(303 + k * 29)
  return {
    id: `bc-camo-${k}`,
    layers: LAYERS.map((layer) => {
      let d = ''
      for (let i = 0; i < layer.count; i++) {
        const cx = rand() * CAMO_TILE
        const cy = rand() * CAMO_TILE
        d += patch(rand, cx, cy, layer.radius * (0.7 + rand() * 0.6), layer.stretch)
      }
      return { fill: layer.fill, d }
    })
  }
})
