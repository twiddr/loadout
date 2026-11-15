import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeHome } from './support/fake-home'

const ROOT = join(__dirname, '..')
const MEMBERS = ['probe-gh', 'probe-gh2', 'probe-gh3']

/** Adds a library skill `name` whose folder is `<root>/<dir>`, with a SKILL.md. */
function addSkill(home: string, root: string, dir: string, name: string): void {
  const folder = join(home, root, dir)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: A probe.\n---\n`)
  symlinkSync(folder, join(home, '.loadout', 'skills', name))
}

/** The fake home with `acme/tools` as a 3-skill pack. */
function packHome(): { home: string; env: Record<string, string> } {
  const made = fakeHome()
  addSkill(made.home, '.loadout/repos', 'acme/tools/skills/probe-gh2', 'probe-gh2')
  addSkill(made.home, '.loadout/repos', 'acme/tools/skills/probe-gh3', 'probe-gh3')
  return made
}

async function launch(home: string, env: Record<string, string>): Promise<ElectronApplication> {
  return _electron.launch({
    args: [`--user-data-dir=${join(home, 'electron-data')}`, join(ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, ...env } as Record<string, string>
  })
}

/** Launches the app on `home`, waits for READY, runs `body` and closes the app. */
async function withApp(
  home: string,
  env: Record<string, string>,
  body: (page: Page) => Promise<void>
): Promise<void> {
  const app = await launch(home, env)
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.rail-status', { hasText: /^READY$/ })).toBeVisible({
      timeout: 10000
    })
    await body(page)
  } finally {
    await app.close()
  }
}

const viewButton = (page: Page, name: 'SKILLS' | 'PACKS'): ReturnType<Page['getByRole']> =>
  page.locator('.view-switch').getByRole('button', { name, exact: true })

const packCard = (page: Page): ReturnType<Page['locator']> =>
  page.locator('article.pack-card', { hasText: 'acme/tools' })

const claudeBox = (page: Page): ReturnType<Page['getByRole']> =>
  packCard(page).getByRole('checkbox', { name: /^acme\/tools Claude Code:/ })

const link = (home: string, name: string): string => join(home, '.claude', 'skills', name)

async function toPacks(page: Page): Promise<void> {
  await viewButton(page, 'PACKS').click()
  await expect(viewButton(page, 'PACKS')).toHaveAttribute('aria-pressed', 'true')
  await expect(packCard(page)).toBeVisible()
}

/** The mouse back button, sent through Chromium's input pipeline as a native press and release. */
async function pressBack(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  for (const type of ['mousePressed', 'mouseReleased'] as const) {
    await cdp.send('Input.dispatchMouseEvent', {
      type,
      x: 600,
      y: 400,
      button: 'back',
      clickCount: 1
    })
  }
  await cdp.detach()
}

async function openPack(page: Page): Promise<void> {
  await page.mouse.move(0, 0)
  await packCard(page).getByRole('button', { name: 'acme/tools', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Back to packs' })).toBeVisible()
}

/** Removes one skill through its own menu and the Remove dialog. */
async function removeSkill(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click()
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.getByRole('article', { name, exact: true })).toHaveCount(0)
}

test('packs: the view switch is stored and comes back on the next launch', async () => {
  const { home, env } = packHome()
  try {
    await withApp(home, env, async (page) => {
      await expect(viewButton(page, 'SKILLS')).toHaveAttribute('aria-pressed', 'true')
      await expect(viewButton(page, 'PACKS')).toHaveAttribute('aria-pressed', 'false')
      await toPacks(page)
      await expect
        .poll(() => readFileSync(join(home, '.loadout', 'config.json'), 'utf8'))
        .toContain('"loadoutView": "packs"')
    })
    await withApp(home, env, async (page) => {
      await expect(viewButton(page, 'PACKS')).toHaveAttribute('aria-pressed', 'true')
      await expect(viewButton(page, 'SKILLS')).toHaveAttribute('aria-pressed', 'false')
      await expect(packCard(page)).toBeVisible()
    })
    expect(readFileSync(join(home, '.loadout', 'config.json'), 'utf8')).toContain(
      '"loadoutView": "packs"'
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('packs: a partly deployed pack card and a click that deploys the rest', async () => {
  const { home, env } = packHome()
  symlinkSync(join(home, '.loadout/skills/probe-gh'), link(home, 'probe-gh'))
  try {
    await withApp(home, env, async (page) => {
      await toPacks(page)
      const card = packCard(page)
      await expect(card.locator('.card-serial')).toHaveText('PACK · 3 SKILLS')
      await expect(card.locator('.card-top-end')).toHaveText('1 DEPLOYED')
      await expect(card).not.toHaveClass(/\bstowed\b/)
      const box = card.locator('label.toggle')
      await expect(box).toHaveClass(/\bpartial\b/)
      await expect(claudeBox(page)).toHaveJSProperty('indeterminate', true)
      await box.hover()
      await expect(box.getByRole('tooltip')).toHaveText('Claude Code: 1 of 3 deployed')
      await page.mouse.move(0, 0)
      await expect(claudeBox(page)).toHaveAttribute(
        'aria-label',
        'acme/tools Claude Code: 1 of 3 deployed'
      )

      await claudeBox(page).click()
      await expect(claudeBox(page)).toBeChecked()
      await expect(card.locator('.card-top-end')).toHaveText('3 DEPLOYED')
      await expect(box).not.toHaveClass(/\bpartial\b/)
      await expect(claudeBox(page)).toHaveJSProperty('indeterminate', false)
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('packs: one box click deploys every member, a second stows them', async () => {
  const { home, env } = packHome()
  try {
    await withApp(home, env, async (page) => {
      await toPacks(page)
      const card = packCard(page)
      const box = card.locator('label.toggle')
      await expect(card).toHaveClass(/\bstowed\b/)
      await expect(claudeBox(page)).not.toBeChecked()
      await expect(box).not.toHaveClass(/\bpartial\b/)

      // The box changes on the click itself; the card counts change only with main's state push,
      // so the no-notice check runs after main replied.
      await claudeBox(page).click()
      await expect(claudeBox(page)).toBeChecked()
      await expect(card.locator('.card-top-end')).toHaveText('3 DEPLOYED')
      await expect(page.getByRole('alert')).toHaveCount(0)
      for (const name of MEMBERS) expect(existsSync(link(home, name))).toBe(true)

      await claudeBox(page).click()
      await expect(claudeBox(page)).not.toBeChecked()
      await expect(card.locator('.card-top-end')).toHaveText('STOWED')
      await expect(page.getByRole('alert')).toHaveCount(0)
      for (const name of MEMBERS) expect(existsSync(link(home, name))).toBe(false)
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('packs: an opened pack lists its members, and Back to packs returns to the grid', async () => {
  const { home, env } = packHome()
  try {
    await withApp(home, env, async (page) => {
      await toPacks(page)
      await openPack(page)
      const cards = page.locator('.card-grid article')
      await expect(cards).toHaveCount(3)
      for (const name of MEMBERS) {
        await expect(page.getByRole('article', { name, exact: true })).toBeVisible()
      }
      const line = page.locator('.page-line')
      await expect(line.locator('.pack-name')).toHaveText('acme/tools')
      await expect(line).toContainText('3 SKILLS')

      const member = page.getByRole('checkbox', { name: 'probe-gh2 Claude Code', exact: true })
      await member.check()
      await expect(member).toBeChecked()
      await expect.poll(() => existsSync(link(home, 'probe-gh2'))).toBe(true)
      await expect(line).toContainText('1 DEPLOYED')

      await page.getByRole('button', { name: 'Back to packs' }).click()
      await expect(page.getByRole('button', { name: 'Back to packs' })).toHaveCount(0)
      await expect(packCard(page)).toBeVisible()
      await expect(packCard(page).locator('.card-top-end')).toHaveText('1 DEPLOYED')
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('packs: a search or a filter shows skill cards, not pack cards', async () => {
  const { home, env } = packHome()
  try {
    await withApp(home, env, async (page) => {
      await toPacks(page)
      const search = page.getByRole('textbox', { name: 'Search your loadout' })
      await search.fill('probe-gh2')
      await expect(page.getByRole('article', { name: 'probe-gh2', exact: true })).toBeVisible()
      await expect(page.locator('article.pack-card')).toHaveCount(0)

      await search.fill('')
      await expect(packCard(page)).toBeVisible()
      await page
        .locator('.filter-row')
        .getByRole('button', { name: /^Stowed/ })
        .click()
      for (const name of MEMBERS) {
        await expect(page.getByRole('article', { name, exact: true })).toBeVisible()
      }
      await expect(page.locator('article.pack-card')).toHaveCount(0)
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('packs: the pack menu holds its four items in order', async () => {
  const { home, env } = packHome()
  try {
    await withApp(home, env, async (page) => {
      await toPacks(page)
      await page.getByRole('button', { name: 'Actions for acme/tools', exact: true }).click()
      await expect(page.locator('.menu-pop:popover-open button')).toHaveText([
        'Check source',
        'Update acme/tools (3 skills)',
        'Reveal in Finder',
        'Remove'
      ])
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('packs: Remove on a pack removes every member and deletes the unused clone', async () => {
  const { home, env } = packHome()
  try {
    await withApp(home, env, async (page) => {
      await toPacks(page)
      await claudeBox(page).click()
      await expect(packCard(page).locator('.card-top-end')).toHaveText('3 DEPLOYED')

      await page.getByRole('button', { name: 'Actions for acme/tools', exact: true }).click()
      await page.getByRole('button', { name: 'Remove', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.locator('p')).toHaveText(
        'Remove acme/tools? 3 skills leave your loadout, and their 3 agent links are removed. The clone at ~/.loadout/repos/acme/tools is deleted, unless it holds local changes.'
      )
      await dialog.getByRole('button', { name: 'Remove', exact: true }).click()

      await expect(page.locator('article.pack-card')).toHaveCount(0)
      await expect(page.getByRole('article', { name: /^probe-gh/ })).toHaveCount(0)
      await expect(page.getByRole('article', { name: 'probe', exact: true })).toBeVisible()
      await expect.poll(() => existsSync(join(home, '.loadout', 'repos', 'acme'))).toBe(false)
      await expect(page.getByRole('alert')).toHaveCount(0)
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('packs: Back to Loadout from a member returns to the open pack', async () => {
  const { home, env } = packHome()
  try {
    await withApp(home, env, async (page) => {
      await toPacks(page)
      await openPack(page)
      await page
        .getByRole('article', { name: 'probe-gh2', exact: true })
        .getByRole('button', { name: 'probe-gh2', exact: true })
        .click()
      await expect(page.getByRole('button', { name: 'Back to Loadout' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Back to packs' })).toHaveCount(0)
      await page.getByRole('button', { name: 'Back to Loadout' }).click()
      await expect(page.getByRole('button', { name: 'Back to packs' })).toBeVisible()
      await expect(page.locator('.card-grid article')).toHaveCount(3)
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('packs: the mouse back button steps out of a member and out of the open pack', async () => {
  const { home, env } = packHome()
  try {
    await withApp(home, env, async (page) => {
      await toPacks(page)
      await openPack(page)
      await page
        .getByRole('article', { name: 'probe-gh2', exact: true })
        .getByRole('button', { name: 'probe-gh2', exact: true })
        .click()
      await expect(page.getByRole('button', { name: 'Back to Loadout' })).toBeVisible()
      await pressBack(page)
      await expect(page.getByRole('button', { name: 'Back to packs' })).toBeVisible()
      await expect(page.locator('.page-line .pack-name')).toHaveText('acme/tools')
      await pressBack(page)
      await expect(packCard(page)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Back to packs' })).toHaveCount(0)
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('packs: an open pack stays open down to one member and closes at none', async () => {
  const { home, env } = packHome()
  try {
    await withApp(home, env, async (page) => {
      await toPacks(page)
      await openPack(page)
      await removeSkill(page, 'probe-gh2')
      await removeSkill(page, 'probe-gh3')
      await expect(page.getByRole('button', { name: 'Back to packs' })).toBeVisible()
      await expect(page.locator('.card-grid article')).toHaveCount(1)
      await expect(page.locator('.page-line')).toContainText(/·\s*1 SKILL\s*·/)

      await removeSkill(page, 'probe-gh')
      await expect(page.getByRole('button', { name: 'Back to packs' })).toHaveCount(0)
      await expect(page.getByRole('article', { name: 'probe', exact: true })).toBeVisible()
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('packs: a pack card shows STOWED, a MISSING chip and ↑ INTEL after a check', async () => {
  const { home, env } = packHome()
  rmSync(join(home, '.loadout/repos/acme/tools/skills/probe-gh3'), { recursive: true })
  try {
    await withApp(home, env, async (page) => {
      await toPacks(page)
      const card = packCard(page)
      await expect(card.locator('.card-top-end')).toHaveText('STOWED')
      await expect(card.locator('.card-chip')).toHaveText('1 MISSING')
      await expect(card.getByRole('button', { name: 'Intel for acme/tools' })).toHaveCount(0)

      await page.getByRole('link', { name: 'Intel' }).click()
      await page.getByRole('status').getByRole('button', { name: 'Check all' }).click()
      await expect(
        page.getByRole('article', { name: 'acme/tools' }).getByText('2 BEHIND')
      ).toBeVisible()
      await page.getByRole('link', { name: 'Loadout' }).click()
      await card.getByRole('button', { name: 'Intel for acme/tools' }).click()
      await expect(page.getByRole('link', { name: 'Intel' })).toHaveAttribute(
        'aria-current',
        'page'
      )
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('packs: SKILLS closes an open pack, and Back there skips the pack step', async () => {
  const { home, env } = packHome()
  try {
    await withApp(home, env, async (page) => {
      await toPacks(page)
      await openPack(page)
      await page.getByRole('link', { name: 'Intel' }).click()
      await page.getByRole('link', { name: 'Loadout' }).click()
      await expect(page.getByRole('button', { name: 'Back to packs' })).toBeVisible()

      await viewButton(page, 'SKILLS').click()
      await expect(page.getByRole('button', { name: 'Back to packs' })).toHaveCount(0)
      await expect(page.getByRole('article', { name: 'probe-gh2', exact: true })).toBeVisible()

      // The last step is the open pack, the same flat page in SKILLS; Back skips it to Intel.
      await pressBack(page)
      await expect(page.getByRole('link', { name: 'Intel' })).toHaveAttribute(
        'aria-current',
        'page'
      )
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('packs: Remove keeps a clone with local changes and says so', async () => {
  const { home, env } = fakeHome()
  addSkill(home, '.loadout/repos', 'acme/dirty-kit/skills/probe-d1', 'probe-d1')
  addSkill(home, '.loadout/repos', 'acme/dirty-kit/skills/probe-d2', 'probe-d2')
  try {
    await withApp(home, env, async (page) => {
      await viewButton(page, 'PACKS').click()
      await page.getByRole('button', { name: 'Actions for acme/dirty-kit', exact: true }).click()
      await page.getByRole('button', { name: 'Remove', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click()
      await expect(page.getByRole('alert')).toHaveText(
        'The clone at ~/.loadout/repos/acme/dirty-kit stays: it holds files that git does not have as committed, such as SKILL.md. Delete it by hand if you do not need it.'
      )
      await expect(page.getByRole('article', { name: /^probe-d/ })).toHaveCount(0)
      expect(existsSync(join(home, '.loadout', 'repos', 'acme', 'dirty-kit'))).toBe(true)
      // The other clone in the owner folder is not touched.
      expect(existsSync(join(home, '.loadout', 'repos', 'acme', 'tools'))).toBe(true)
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('packs: the single Remove of the last skill of a clone deletes the clone', async () => {
  const { home, env } = fakeHome()
  try {
    await withApp(home, env, async (page) => {
      await page.getByRole('button', { name: 'Actions for probe-gh', exact: true }).click()
      await page.getByRole('button', { name: 'Remove', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.locator('p')).toContainText(
        'It is the last skill from acme/tools, so the clone at ~/.loadout/repos/acme/tools is deleted, unless it holds local changes.'
      )
      await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
      await expect(page.getByRole('article', { name: 'probe-gh', exact: true })).toHaveCount(0)
      await expect
        .poll(() => existsSync(join(home, '.loadout', 'repos', 'acme', 'tools')))
        .toBe(false)
      await expect(page.getByRole('alert')).toHaveCount(0)
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
