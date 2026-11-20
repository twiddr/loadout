/**
 * The page turn of the Briefing's field manual, drawn on a canvas over the spread. The cover and the
 * spine stay in the picture underneath; only the two facing pages take part. The numbers are those of
 * `drawTurn` in design/briefing-field-manual/index.html, in the coordinates of the 1280 x 720 spreads.
 */
export const TURN_MS = 420
const SPINE = 638
const TOP = 40
const HEIGHT = 628
const WIDTH = 518
const STRIPS = 96

/** One edge of a strip of the leaf: its left or right side `x`, its top `y` and its height `h`. */
export interface LeafEdge {
  x: number
  y: number
  h: number
}

/** The smooth start and stop of the turn; `t` from 0 to 1. */
export function ease(t: number): number {
  return t * t * (3 - 2 * t)
}

/**
 * The edges of the leaf's strips, from the spine to the free edge, at `progress` (0 to 1).
 * `direction` 1 turns the right leaf leftward (Next); -1 turns the left leaf rightward (Back). The outer
 * paper bends ahead of the binding and lifts toward the viewer.
 */
export function leafEdges(direction: 1 | -1, progress: number): LeafEdge[] {
  const angle = Math.PI * progress
  const bend = Math.sin(angle)
  const step = WIDTH / STRIPS
  const edges: LeafEdge[] = [{ x: SPINE, y: TOP, h: HEIGHT }]
  let across = 0
  let lift = 0
  for (let i = 0; i < STRIPS; i++) {
    const distance = (i + 0.5) / STRIPS
    const tilt = angle + bend * (distance - 0.45) * 1.15
    across += step * Math.cos(tilt)
    lift += step * Math.sin(tilt)
    const scale = 1 + lift / 3400
    edges.push({
      x: SPINE + direction * across * scale,
      y: TOP - ((scale - 1) * HEIGHT) / 2,
      h: HEIGHT * scale
    })
  }
  return edges
}

/**
 * Draws the turn at `progress` from the spread `source` to the spread `target`: the page that the
 * leaf will cover stays as the source until the leaf lands, the leaf shows the outgoing page on its
 * front and the incoming page on its reverse, and a soft shadow follows its free edge.
 */
export function drawTurn(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  target: CanvasImageSource,
  direction: 1 | -1,
  progress: number
): void {
  const bend = Math.sin(Math.PI * progress)
  const restingLeft = direction === 1 ? SPINE - WIDTH : SPINE
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.drawImage(source, restingLeft, TOP, WIDTH, HEIGHT, restingLeft, TOP, WIDTH, HEIGHT)

  const edges = leafEdges(direction, progress)
  const step = WIDTH / STRIPS
  const edge = edges[STRIPS].x
  const reach = 75 * bend + 1
  const shadow = ctx.createLinearGradient(edge - reach, 0, edge + reach, 0)
  shadow.addColorStop(0, 'transparent')
  shadow.addColorStop(0.5, `rgba(46, 31, 12, ${0.29 * bend})`)
  shadow.addColorStop(1, 'transparent')
  ctx.fillStyle = shadow
  ctx.fillRect(edge - reach, TOP, reach * 2, HEIGHT)

  for (let i = 0; i < STRIPS; i++) {
    const a = edges[i]
    const b = edges[i + 1]
    const front = (b.x - a.x) * direction > 0
    const face = front ? source : target
    const side = front ? direction : -direction
    const sx = side > 0 ? SPINE + i * step : SPINE - (i + 1) * step
    const x = Math.min(a.x, b.x)
    const w = Math.abs(b.x - a.x) + 0.45
    ctx.drawImage(face, sx, TOP, step, HEIGHT, x, a.y, w, a.h)
    const shade = bend * (front ? 0.09 : 0.16) * (1 - i / STRIPS)
    ctx.fillStyle = `rgba(56, 36, 14, ${shade})`
    ctx.fillRect(x, a.y, w, a.h)
  }
}
