/** The Briefing: five cards that explain the ideas behind Loadout, each with one spread of the field manual. */
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
