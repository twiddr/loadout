/** The Briefing: five cards that explain the ideas behind Loadout, each with one view of the map. */
export interface BriefingCard {
  eyebrow: string
  title: string
  lead: string
  body: string
  where: string
}

export const CARDS: readonly BriefingCard[] = [
  {
    eyebrow: 'The kit',
    title: 'ONE KIT',
    lead: 'Every skill in one place.',
    body: 'A skill is a folder of instructions that an AI agent can load. Loadout holds all of yours: the skills you write and the skills you download.',
    where: 'LOADOUT tab'
  },
  {
    eyebrow: 'Deploy',
    title: 'DEPLOY',
    lead: 'Choose which agent carries which skill.',
    body: 'Your agents are your platoon. Flip a toggle and Loadout puts one link to the skill in that agent’s folder. Flip it back and the link is gone. The skill itself never moves.',
    where: 'Toggles on each skill'
  },
  {
    eyebrow: 'Recon',
    title: 'RECON',
    lead: 'Find skills already in battle.',
    body: 'Your agents can already hold skills that Loadout does not manage. RECON lists them. RECRUIT moves them into your kit.',
    where: 'RECON tab'
  },
  {
    eyebrow: 'Intel',
    title: 'INTEL',
    lead: 'Hear when a source changes.',
    body: 'Downloaded skills come from GitHub or the Tessl registry. INTEL shows which sources have a new version. You decide when to update.',
    where: 'INTEL tab'
  },
  {
    eyebrow: 'Inspection',
    title: 'INSPECTION',
    lead: 'Check a skill before you share it.',
    body: 'Tessl reviews a skill and gives it a score. It can fix what it finds, and it publishes the skill to the registry for your colleagues.',
    where: 'A skill’s own page'
  }
]

/** A part of the map in world units; the world is 993 x 497 and the view is twice as wide as high. */
export interface View {
  x: number
  y: number
  w: number
}

/** The part of the map each card shows; `VIEWS[step - 1]`. */
export const VIEWS: readonly View[] = [
  { x: 222, y: 76, w: 560 },
  { x: 308, y: 0, w: 685 },
  { x: 513, y: 257, w: 480 },
  { x: 0, y: 0, w: 690 },
  { x: 0, y: 176, w: 641 }
]

/** The CSS transform that puts `view` in a screen `viewWidth` pixels wide. */
export function worldTransform(view: View, viewWidth: number): string {
  // `-0` would print as "0" anyway, but the sum keeps the intent plain.
  return `scale(${viewWidth / view.w}) translate(${0 - view.x}px, ${0 - view.y}px)`
}

/** `from`: the first card that shows it. `only`: on that card alone. `off`: one later card that hides it. */
export interface Layer {
  from: number
  only?: boolean
  off?: number
}

export const LAYERS = {
  /** The three arrows from the base to the camps; on card 4 a stub would show at the screen edge. */
  supply: { from: 2, off: 4 },
  trucks: { from: 2, only: true },
  /** The brackets, the dotted arrow, the RECRUIT plate and the drone. */
  recon: { from: 3, only: true },
  /** The signal rings, the arrow and the UPDATE plate. */
  intel: { from: 4 },
  /** The PUBLISH arrow and plate, and the outline around the score. */
  publish: { from: 5 },
  heli: { from: 5, only: true }
} satisfies Record<string, Layer>

/** Whether `layer` shows on card `step` (1 to 5). */
export function layerOn(layer: Layer, step: number): boolean {
  if (layer.off === step) return false
  return layer.only ? step === layer.from : step >= layer.from
}
