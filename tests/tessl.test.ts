import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bumpVersion,
  fixArgs,
  installArgs,
  outdatedArgs,
  changedSince,
  compareVersions,
  editedTitle,
  parseManifest,
  parsePluginInfo,
  pendingAfterPublish,
  parsePluginRef,
  parseReviewReport,
  parseReviewScore,
  parseWhoami,
  parseRegistryPlugins,
  parseWorkspaces,
  pluginInfoArgs,
  publishArgs,
  registryUrl,
  reviewArgs,
  searchArgs,
  type RegistryStatus,
  readVersionLookup,
  shareMessage,
  unpublishArgs,
  unpublishFailure,
  unpublishLeftMessage,
  unpublishRepeatMessage,
  unpublishStoppedInFlightMessage,
  unpublishStoppedMessage,
  notOnRegistryMessage,
  walkVersions
} from '../src/core/tessl'

const fixture = (name: string): Promise<string> =>
  readFile(join(__dirname, 'fixtures', 'tessl', name), 'utf8')

describe('parsePluginRef', () => {
  it.each([
    ['acme/ledger-audit', 'acme', 'ledger-audit'],
    ['  acme/ledger-audit  ', 'acme', 'ledger-audit'],
    ['tessl/tessl-verify', 'tessl', 'tessl-verify'],
    ['Acme/Ledger-Audit', 'acme', 'ledger-audit'],
    ['  TESSL/tessl-verify  ', 'tessl', 'tessl-verify']
  ])('parses %j', (input, workspace, plugin) => {
    expect(parsePluginRef(input)).toEqual({ workspace, plugin })
  })

  it.each([
    '',
    'acme',
    'acme/ledger-audit@0.1.0',
    'a/b/c',
    'https://tessl.io/registry/acme/ledger-audit',
    './x',
    'acme/..',
    'ac me/x'
  ])('rejects %j', (input) => {
    expect(parsePluginRef(input)).toBeNull()
  })
})

describe('parseWhoami', () => {
  it('reads the username from the recorded output', async () => {
    expect(parseWhoami(await fixture('whoami-logged-in.json'))).toBe('acme-dev')
    expect(parseWhoami(await fixture('whoami-logged-out.json'))).toBeNull()
  })

  it.each([
    ['{"authenticated":true,"user":{"name":"N","email":"e"}}', 'N'],
    ['{"authenticated":true,"user":{"email":"e","id":"i"}}', 'e'],
    ['{"authenticated":true,"user":{"id":"i"}}', 'i'],
    ['{"authenticated":true}', 'logged in'],
    ['{"authenticated":false,"user":{"name":"N"}}', null],
    ['not json', null]
  ])('%s', (text, expected) => {
    expect(parseWhoami(text)).toBe(expected)
  })
})

describe('parseReviewScore', () => {
  it('reads the score from the recorded output', async () => {
    expect(parseReviewScore(await fixture('review-run.json'))).toBe(65)
  })

  it.each(['not json', '{}', '{"review":{}}', '{"review":{"reviewScore":"65"}}', ''])(
    'gives null for %j',
    (stdout) => {
      expect(parseReviewScore(stdout)).toBeNull()
    }
  )
})

describe('parseReviewReport', () => {
  it('reads the recorded review', async () => {
    const r = parseReviewReport(JSON.parse(await fixture('review-run.json')))!
    expect(r.plugin).toBe('tessl/default-skill-review@0.2.0')
    expect(r.score).toBe(65)
    expect(r.judges.map((j) => j.id)).toEqual(['description', 'content'])
    const content = r.judges[1]
    expect(content.percent).toBe(49)
    expect(content.weight).toBe(40)
    expect(content.assessment).toMatch(/^The SKILL.md body is a concise/)
    expect(content.suggestions).toHaveLength(3)
    expect(content.dimensions).toHaveLength(4)
    expect(content.dimensions[0]).toMatchObject({ name: 'conciseness', score: 4 })
    expect(content.dimensions[0].reasoning).toMatch(/^The body is lean/)
    expect(r.checks).toHaveLength(16)
    expect(r.checks.every((c) => c.status === 'passed')).toBe(true)
  })

  it('keeps what it can from a partial shape; null with no judge and no check', () => {
    expect(parseReviewReport({ review: { reviewScore: 90 } })).toBeNull()
    const r = parseReviewReport({
      judges: { content: { evaluation: { scores: { x: { score: 'bad' } } } } }
    })!
    expect(r.judges).toHaveLength(1)
    expect(r.judges[0]).toMatchObject({
      id: 'content',
      percent: null,
      weight: null,
      assessment: null,
      suggestions: [],
      dimensions: []
    })
  })

  it.each([null, 'text', 42, []])('gives null for %j', (input) => {
    expect(parseReviewReport(input)).toBeNull()
  })
})

describe('builders', () => {
  it('builds the argument lists', () => {
    const ref = { workspace: 'acme', plugin: 'ledger-audit' }
    expect(installArgs(ref)).toEqual([
      'install',
      '--global',
      '--agent',
      'tessl-agent',
      '--yes',
      'acme/ledger-audit'
    ])
    expect(reviewArgs('/h/x', 'acme')).toEqual([
      'review',
      'run',
      '/h/x',
      '--workspace',
      'acme',
      '--json'
    ])
    expect(fixArgs('/h/x', 'acme')).toEqual([
      'review',
      'fix',
      '/h/x',
      '--workspace',
      'acme',
      '--yes',
      '--max-iterations',
      '1',
      '--json'
    ])
    expect(publishArgs('/h/Code/Skills/x', 'acme', 'minor')).toEqual([
      'skill',
      'publish',
      '/h/Code/Skills/x',
      '--workspace',
      'acme',
      '--bump',
      'minor'
    ])
    expect(outdatedArgs()).toEqual(['outdated', '--global', '--json'])
  })
})

describe('parseWorkspaces', () => {
  it('gives the name of each workspace', () => {
    const text = JSON.stringify({
      workspaces: [
        { id: '1', name: 'acme', allowedActions: ['view', 'plugin.publish'] },
        { id: '2', name: 'readers', allowedActions: ['view'] },
        { id: '3', allowedActions: [] }
      ]
    })
    expect(parseWorkspaces(text)).toEqual([
      { id: '1', name: 'acme' },
      { id: '2', name: 'readers' }
    ])
  })

  it('is null for output that is not the workspace list', () => {
    expect(parseWorkspaces('Not logged in')).toBeNull()
    expect(parseWorkspaces('{"error": "x"}')).toBeNull()
  })
})

describe('parseRegistryPlugins', () => {
  it('reads the tile rows of a workspace search, sorted by plugin', async () => {
    const found = parseRegistryPlugins(await fixture('search-workspace.json'))
    expect(found?.map((p) => `${p.workspace}/${p.plugin}@${p.version}`)).toEqual([
      'acme/changelog-writer@0.2.1',
      'acme/ledger-audit@0.1.1',
      'acme/pirate-speak@0.1.0'
    ])
    expect(found?.[2]).toEqual({
      workspace: 'acme',
      plugin: 'pirate-speak',
      version: '0.1.0',
      hasSkills: true
    })
    const text = JSON.stringify({
      results: [
        { type: 'tile-skill', name: 'x', source: 'acme/zed' },
        { type: 'tile', workspaceName: 'acme', tileName: 'zed', content: { hasSkills: true } },
        {
          type: 'tile',
          workspaceName: 'acme',
          tileName: 'alpha',
          description: 'A.',
          latestVersion: '1.0.0',
          content: { hasSkills: false }
        }
      ]
    })
    expect(parseRegistryPlugins(text)).toEqual([
      { workspace: 'acme', plugin: 'alpha', version: '1.0.0', hasSkills: false },
      { workspace: 'acme', plugin: 'zed', version: null, hasSkills: true }
    ])
  })

  it('is null for output that is not a search result', () => {
    expect(
      parseRegistryPlugins('✘ Could not resolve search scope: Invalid workspace scope')
    ).toBeNull()
    expect(parseRegistryPlugins('{"error": "x"}')).toBeNull()
  })

  it('searchArgs scopes the search to the workspace id and queries its name', () => {
    expect(searchArgs({ id: '01a1', name: 'acme' })).toEqual([
      'search',
      '--json',
      '--workspace',
      '01a1',
      'acme'
    ])
  })
})

const MANIFEST = JSON.stringify({
  name: 'acme/ledger-audit',
  description: 'Use when checking a supplier ledger.',
  private: true,
  skills: ['.'],
  version: '0.1.1'
})

describe('parseManifest', () => {
  it('reads the name, version and private of a Tessl manifest', () => {
    expect(parseManifest(MANIFEST)).toEqual({
      workspace: 'acme',
      plugin: 'ledger-audit',
      version: '0.1.1',
      private: true
    })
  })
  it('lower-cases the name and keeps a missing private as null', () => {
    expect(parseManifest('{"name":"Acme/Ledger","version":"1.0.0"}')).toEqual({
      workspace: 'acme',
      plugin: 'ledger',
      version: '1.0.0',
      private: null
    })
  })
  it.each([
    ['{"name":"acme/ledger"}'],
    ['{"name":"acme/ledger","version":""}'],
    ['{"name":"ledger","version":"0.1.0"}'],
    ['{"name":"a/b/c","version":"0.1.0"}'],
    ['not json']
  ])('gives null for %s', (text) => expect(parseManifest(text)).toBeNull())
})

describe('registryUrl', () => {
  it('builds the registry page address', () => {
    expect(registryUrl({ workspace: 'acme', plugin: 'ledger-audit' })).toBe(
      'https://tessl.io/registry/acme/ledger-audit'
    )
  })
})

describe('shareMessage', () => {
  const manifest = { workspace: 'acme', plugin: 'ledger-audit', version: '0.1.1' }
  it('writes the private message of the spec byte for byte', () => {
    expect(shareMessage('ledger-audit', { ...manifest, private: true })).toBe(
      'ledger-audit is on the Tessl Registry:\n' +
        'https://tessl.io/registry/acme/ledger-audit\n\n' +
        'In Loadout: Recruit skill → Registry → acme/ledger-audit\n' +
        'Without Loadout: tessl install acme/ledger-audit\n\n' +
        'It is private: you need a Tessl account in the acme workspace.\n'
    )
  })
  it.each([[false], [null]])('leaves out the private line when private is %s', (value) => {
    expect(shareMessage('ledger-audit', { ...manifest, private: value })).toBe(
      'ledger-audit is on the Tessl Registry:\n' +
        'https://tessl.io/registry/acme/ledger-audit\n\n' +
        'In Loadout: Recruit skill → Registry → acme/ledger-audit\n' +
        'Without Loadout: tessl install acme/ledger-audit\n'
    )
  })
})

const ref = { workspace: 'acme', plugin: 'ledger-audit' }
const AT = 1_700_000_000_000

describe('parsePluginInfo', () => {
  it('reads the latest version and its publish time', async () => {
    expect(parsePluginInfo(ref, 0, await fixture('plugin-info.json'), '', AT)).toEqual({
      checkedAt: AT,
      state: 'found',
      version: '0.1.1',
      publishedAt: '2026-03-04T15:42:07.630Z',
      archived: null,
      deprecated: null,
      message: null
    })
  })
  it('gives the archived and deprecated tooltips', async () => {
    const info = JSON.parse(await fixture('plugin-info.json'))
    info.tile.archived = true
    info.tile.archivedReason = 'Replaced by ledger-v2.'
    info.tile.deprecated = true
    const status = parsePluginInfo(ref, 0, JSON.stringify(info), '', AT)
    expect(status.archived).toBe('Archived on the registry: Replaced by ledger-v2.')
    expect(status.deprecated).toBe('Deprecated on the registry; no reason given.')
  })
  it('says archived for an archived plugin with no latest version', async () => {
    const probe = { workspace: 'acme', plugin: 'retired-helper' }
    expect(parsePluginInfo(probe, 0, await fixture('plugin-info-archived.json'), '', AT)).toEqual({
      checkedAt: AT,
      state: 'archived',
      version: '',
      publishedAt: '',
      archived: 'Archived on the registry: Replaced by a newer helper',
      deprecated: null,
      message: null
    })
  })
  it('keeps the found state for an archived plugin with a latest version', async () => {
    const info = JSON.parse(await fixture('plugin-info.json'))
    info.tile.archived = true
    info.tile.archivedReason = 'Old.'
    expect(parsePluginInfo(ref, 0, JSON.stringify(info), '', AT)).toEqual({
      checkedAt: AT,
      state: 'found',
      version: '0.1.1',
      publishedAt: '2026-03-04T15:42:07.630Z',
      archived: 'Archived on the registry: Old.',
      deprecated: null,
      message: null
    })
  })
  it('says pending while the registry has no version yet', async () => {
    const docs = { workspace: 'acme', plugin: 'changelog-writer' }
    expect(parsePluginInfo(docs, 0, await fixture('plugin-info-pending.json'), '', AT)).toEqual({
      checkedAt: AT,
      state: 'pending',
      version: '',
      publishedAt: '',
      archived: null,
      deprecated: null,
      message: 'Tessl is checking the new version; it shows on the registry in a few minutes.'
    })
  })
  it('says not found for a plugin the account cannot see', async () => {
    expect(
      parsePluginInfo(ref, 1, '', await fixture('plugin-info-not-found.txt'), AT)
    ).toMatchObject({
      state: 'not-found',
      message:
        'acme/ledger-audit is not on the registry, or your Tessl account has no access to it.'
    })
  })
  it('shows Tessl’s sentence when logged out, skipping the Terms line', async () => {
    expect(
      parsePluginInfo(ref, 1, '', await fixture('plugin-info-logged-out.txt'), AT).message
    ).toBe(
      'Could not check acme/ledger-audit on the registry: Please authenticate with Tessl to continue. Run `tessl login` to sign up or log in.'
    )
  })
  it('shows Tessl’s sentence when offline', () => {
    const err = '✘ Network request failed. Please check your internet connection and try again.\n'
    expect(parsePluginInfo(ref, 1, '', err, AT)).toMatchObject({
      state: 'failed',
      message:
        'Could not check acme/ledger-audit on the registry: Network request failed. Please check your internet connection and try again.'
    })
  })
  it.each([
    [1, '', 'boom', 'Could not check acme/ledger-audit on the registry (exit 1); see the log.'],
    [null, '', '', 'Could not check acme/ledger-audit on the registry; see the log.'],
    [0, 'not json', '', 'Could not read the registry answer for acme/ledger-audit; see the log.'],
    [
      0,
      '{"tile":{},"version":{"createdAt":"x"}}',
      '',
      'Could not read the registry answer for acme/ledger-audit; see the log.'
    ]
  ])('fails with code %s', (code, stdout, stderr, message) => {
    expect(parsePluginInfo(ref, code, stdout, stderr, AT)).toMatchObject({
      state: 'failed',
      message,
      version: ''
    })
  })
})

describe('parsePluginInfo without an exit code', () => {
  it('ignores stderr when the run did not exit', async () => {
    const stderrs = [await fixture('plugin-info-not-found.txt'), '✘ Network request failed.\n']
    for (const stderr of stderrs) {
      expect(parsePluginInfo(ref, null, '', stderr, AT)).toMatchObject({
        state: 'failed',
        message: 'Could not check acme/ledger-audit on the registry; see the log.'
      })
    }
  })
})

describe('pendingAfterPublish', () => {
  const found = (version: string): RegistryStatus => ({
    checkedAt: AT,
    state: 'found',
    version,
    publishedAt: '2026-03-04T15:42:07.630Z',
    archived: null,
    deprecated: null,
    message: null
  })
  it('turns an older registry version into the pending state', () => {
    expect(pendingAfterPublish(found('0.1.0'), '0.1.1')).toEqual({
      checkedAt: AT,
      state: 'pending',
      version: '',
      publishedAt: '',
      archived: null,
      deprecated: null,
      message: 'Tessl is checking the new version; it shows on the registry in a few minutes.'
    })
  })
  it.each(['0.1.1', '0.2.0'])('leaves registry version %s as it is', (version) => {
    const status = found(version)
    expect(pendingAfterPublish(status, '0.1.1')).toBe(status)
  })
  it('leaves a status that is not found as it is', () => {
    const status = { ...found(''), state: 'failed' as const, message: 'x' }
    expect(pendingAfterPublish(status, '0.1.1')).toBe(status)
  })
})

describe('compareVersions', () => {
  it.each([
    ['0.1.1', '0.1.1', 0],
    ['0.1.1', '0.1.0', 1],
    ['0.1.0', '0.1.1', -1],
    ['0.2.0', '0.1.9', 1],
    ['1.0.0', '0.9.9', 1],
    ['0.1.10', '0.1.9', 1],
    ['0.1.0', '0.1.0-beta', null]
  ])('%s vs %s', (a, b, want) => expect(compareVersions(a, b)).toBe(want))
})

it('pluginInfoArgs', () => {
  expect(pluginInfoArgs(ref)).toEqual(['plugin', 'info', 'acme/ledger-audit', '--json'])
})

describe('unpublish', () => {
  const ref = { workspace: 'acme', plugin: 'probe' }

  it('builds the arguments', () => {
    expect(pluginInfoArgs(ref, '0.1.1')).toEqual(['plugin', 'info', 'acme/probe@0.1.1', '--json'])
    expect(pluginInfoArgs(ref)).toEqual(['plugin', 'info', 'acme/probe', '--json'])
    expect(unpublishArgs(ref, '0.1.1')).toEqual([
      'plugin',
      'unpublish',
      '--plugin',
      'acme/probe@0.1.1'
    ])
  })

  it('walkVersions', () => {
    expect(walkVersions('0.1.2')).toEqual(['0.1.2', '0.1.1', '0.1.0'])
    expect(walkVersions('1.0.0')).toEqual(['1.0.0'])
    expect(walkVersions('next')).toEqual([])
  })

  it('readVersionLookup', async () => {
    const noVersion = await fixture('plugin-info-no-version.txt')
    const notFound = await fixture('plugin-info-not-found.txt')
    const loggedOut = await fixture('plugin-info-logged-out.txt')
    expect(readVersionLookup(ref, '0.1.1', 0, '')).toEqual({ state: 'exists' })
    expect(readVersionLookup(ref, '0.1.1', 1, noVersion)).toEqual({ state: 'absent' })
    expect(readVersionLookup(ref, '0.1.1', 1, notFound)).toEqual({ state: 'gone' })
    expect(readVersionLookup(ref, '0.1.1', 1, loggedOut)).toEqual({
      state: 'failed',
      message:
        'Could not check acme/probe@0.1.1 on the registry: Please authenticate with Tessl to continue. Run `tessl login` to sign up or log in.'
    })
    expect(readVersionLookup(ref, '0.1.1', 2, 'boom')).toEqual({
      state: 'failed',
      message: 'Could not check acme/probe@0.1.1 on the registry (exit 2); see the log.'
    })
    expect(readVersionLookup(ref, '0.1.1', null, '')).toEqual({
      state: 'failed',
      message: 'Could not check acme/probe@0.1.1 on the registry; see the log.'
    })
  })

  it('messages', async () => {
    const nf = await fixture('unpublish-not-found.txt')
    expect(unpublishFailure(ref, '0.1.1', 1, nf)).toBe(
      'Unpublish of acme/probe@0.1.1 failed: Not Found (status 404)'
    )
    expect(unpublishFailure(ref, '0.1.1', 3, '')).toBe(
      'Unpublish of acme/probe@0.1.1 failed (exit 3); see the log.'
    )
    expect(unpublishFailure(ref, '0.1.1', null, '')).toBe(
      'Unpublish of acme/probe@0.1.1 failed; see the log.'
    )
    expect(unpublishLeftMessage(ref, ['0.1.2'])).toBe(
      'Unpublished 0.1.2, but acme/probe still has versions that Loadout cannot find. Finish with the Tessl CLI; see the log.'
    )
    expect(unpublishLeftMessage(ref, [])).toBe(
      'Unpublished nothing, but acme/probe still has versions that Loadout cannot find. Finish with the Tessl CLI; see the log.'
    )
    expect(unpublishStoppedMessage(['0.1.2', '0.1.1'])).toBe(
      'Unpublish stopped. Removed: 0.1.2, 0.1.1.'
    )
    expect(unpublishStoppedMessage([])).toBe('Unpublish stopped. Removed: nothing.')
    expect(unpublishStoppedInFlightMessage(ref, '0.1.1', ['0.1.2'])).toBe(
      'Unpublish stopped. Removed: 0.1.2. acme/probe@0.1.1 was stopped while it ran and can be gone too; press refresh on the TESSL card to check.'
    )
    expect(unpublishStoppedInFlightMessage(ref, '0.1.1', [])).toContain('Removed: nothing. ')
    expect(notOnRegistryMessage(ref)).toBe(
      'acme/probe is not on the registry, or your Tessl account has no access to it.'
    )
    expect(unpublishRepeatMessage(ref, '0.1.1')).toBe(
      'Tessl still lists acme/probe@0.1.1 after the unpublish; see the log.'
    )
  })
})

describe('changedSince', () => {
  const at = (rel: string, mtimeMs: number): { rel: string; mtimeMs: number } => ({ rel, mtimeMs })

  it('counts a file only when it is more than the tolerance newer than the manifest', () => {
    expect(
      changedSince(10_000, [at('a.md', 12_000), at('b.md', 12_001), at('c.md', 9_000)])
    ).toEqual(['b.md'])
  })

  it('lists the newest first, ties by path', () => {
    expect(
      changedSince(0, [at('b.md', 5_000), at('z.md', 9_000), at('a.md', 5_000), at('c.md', 1_000)])
    ).toEqual(['z.md', 'a.md', 'b.md'])
  })

  it('gives nothing for no files or only older files', () => {
    expect(changedSince(10_000, [])).toEqual([])
    expect(changedSince(10_000, [at('a.md', 1)])).toEqual([])
  })

  it('takes another tolerance', () => {
    expect(changedSince(0, [at('a.md', 1)], 0)).toEqual(['a.md'])
  })
})

describe('editedTitle', () => {
  const paths = (n: number): string[] => Array.from({ length: n }, (_, i) => `f${i + 1}.md`)

  it('names every path up to 20', () => {
    expect(editedTitle('0.2.1', ['SKILL.md'])).toBe('Changed since publish of 0.2.1:\nSKILL.md')
    expect(editedTitle('0.2.1', paths(20)).split('\n')).toHaveLength(21)
  })

  it('counts the rest after 20', () => {
    const lines = editedTitle('0.1.0', paths(22)).split('\n')
    expect(lines).toHaveLength(22)
    expect(lines[20]).toBe('f20.md')
    expect(lines[21]).toBe('… and 2 more')
  })
})

describe('bumpVersion', () => {
  it('raises one part and zeroes the parts after it', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0')
  })

  it('gives null for a version of another shape', () => {
    expect(bumpVersion('1.2', 'patch')).toBeNull()
    expect(bumpVersion('1.2.3-beta.1', 'minor')).toBeNull()
  })
})
