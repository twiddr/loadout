// outdated-ready.json is hand-made: no installed plugin was outdated when the up-to-date fixture
// was recorded (spec "Not verified"). It moves the recorded item to `outdated` with latest 0.1.1.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkFailed, sourceKey, tesslChecks } from '../src/core/checks'

const fixture = (name: string): Promise<string> =>
  readFile(join(__dirname, 'fixtures', 'tessl', name), 'utf8')

const ledger = { workspace: 'acme', plugin: 'ledger-audit' }

describe('sourceKey', () => {
  it('keys each source type', () => {
    expect(sourceKey({ type: 'github', owner: 'acme', repo: 'tools', subpath: 'skills/x' })).toBe(
      'github:acme/tools'
    )
    expect(
      sourceKey({ type: 'tessl', workspace: 'acme', plugin: 'kit', subpath: 'skills/y' })
    ).toBe('tessl:acme/kit')
    expect(sourceKey({ type: 'local', path: '/h/Code/Skills/z' })).toBeNull()
  })
})

describe('checkFailed', () => {
  it('words the exit code', () => {
    expect(checkFailed(128, 1)).toEqual({
      checkedAt: 1,
      state: 'failed',
      behind: 0,
      upstream: '',
      from: '',
      to: '',
      commits: [],
      message: 'Check failed (exit 128), see the log.'
    })
  })

  it('words a cancelled or not started check', () => {
    expect(checkFailed(null, 1).message).toBe('Check failed, see the log.')
  })
})

describe('tesslChecks', () => {
  it('marks an up-to-date plugin', async () => {
    const checks = tesslChecks(await fixture('outdated-up-to-date.json'), [ledger], 5)
    expect(checks['tessl:acme/ledger-audit']).toMatchObject({
      checkedAt: 5,
      state: 'up-to-date',
      message: null
    })
  })

  it('marks an outdated plugin ready with both versions', async () => {
    const checks = tesslChecks(await fixture('outdated-ready.json'), [ledger], 5)
    expect(checks['tessl:acme/ledger-audit']).toEqual({
      checkedAt: 5,
      state: 'ready',
      behind: 0,
      upstream: '',
      from: '0.1.0',
      to: '0.1.1',
      commits: [],
      message: null
    })
  })

  it('compares names in lower case', async () => {
    const plugin = { workspace: 'Acme', plugin: 'Ledger-Audit' }
    const checks = tesslChecks(await fixture('outdated-ready.json'), [plugin], 5)
    expect(checks['tessl:Acme/Ledger-Audit']).toMatchObject({
      state: 'ready',
      from: '0.1.0',
      to: '0.1.1'
    })
  })

  it('fails a plugin missing from the list', async () => {
    const checks = tesslChecks(
      await fixture('outdated-up-to-date.json'),
      [{ workspace: 'acme', plugin: 'other' }],
      5
    )
    expect(checks['tessl:acme/other']).toMatchObject({
      state: 'failed',
      message: 'acme/other is missing from the tessl outdated list; see the log.'
    })
  })

  it('fails every plugin when the output is not the JSON', () => {
    const checks = tesslChecks('not json', [ledger, { workspace: 'acme', plugin: 'kit' }], 5)
    expect(Object.values(checks)).toHaveLength(2)
    for (const check of Object.values(checks)) {
      expect(check).toEqual(checkFailed(null, 5))
    }
  })
})
