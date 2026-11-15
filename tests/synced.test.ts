import { expect, test } from 'vitest'
import type { Agent } from '../src/core/config'
import {
  SYNC_OFF_LINE,
  bucketName,
  claudeEnabled,
  overridesBlock,
  parseClaudeSettings,
  syncedLoad,
  type Synced
} from '../src/core/synced'

const ORG = '00000000-0000-4000-8000-000000000001'
const ACC = '00000000-0000-4000-8000-000000000002'

test('bucketName joins the two oauthAccount ids', () => {
  const text = JSON.stringify({
    numStartups: 1,
    oauthAccount: { organizationUuid: ORG, accountUuid: ACC }
  })
  expect(bucketName(text)).toBe(`${ORG}_${ACC}`)
})

test.each([
  ['not JSON', '{'],
  ['an array', '[]'],
  ['no oauthAccount', '{}'],
  ['logged out', '{"oauthAccount":null}'],
  ['one id missing', JSON.stringify({ oauthAccount: { organizationUuid: ORG } })],
  [
    'an id that is a number',
    JSON.stringify({ oauthAccount: { organizationUuid: 1, accountUuid: ACC } })
  ],
  [
    'an id with a slash',
    JSON.stringify({ oauthAccount: { organizationUuid: '../x', accountUuid: ACC } })
  ],
  ['an empty id', JSON.stringify({ oauthAccount: { organizationUuid: '', accountUuid: ACC } })]
])('bucketName is null for %s', (_, text) => expect(bucketName(text)).toBeNull())

test('parseClaudeSettings: only false turns the sync off, only "off" turns a skill off', () => {
  expect(parseClaudeSettings('{"syncClaudeAiSkills":false}')).toEqual({ syncOff: true, off: [] })
  expect(parseClaudeSettings('{"syncClaudeAiSkills":"false"}').syncOff).toBe(false)
  expect(parseClaudeSettings('{"syncClaudeAiSkills":true}').syncOff).toBe(false)
  expect(
    parseClaudeSettings(
      JSON.stringify({
        skillOverrides: {
          'anthropic-skills:zeta': 'off',
          'anthropic-skills:alpha': 'off',
          'anthropic-skills:beta': 'name-only',
          'anthropic-skills:gamma': 'user-invocable-only',
          'anthropic-skills:delta': 'on',
          'anthropic-skills:eps': false,
          other: 'off'
        }
      })
    )
  ).toEqual({ syncOff: false, off: ['alpha', 'zeta'] })
})

test.each([
  ['an empty file', ''],
  ['not JSON', '{'],
  ['an array', '[]'],
  ['null', 'null'],
  ['skillOverrides as a string', '{"skillOverrides":"off"}'],
  ['comments', '{ // note\n"syncClaudeAiSkills": false }'],
  ['a trailing comma', '{"syncClaudeAiSkills": false,}'],
  ['a byte-order mark', '﻿{"syncClaudeAiSkills": false}']
])('parseClaudeSettings reads %s as no setting', (_, text) =>
  expect(parseClaudeSettings(text)).toEqual({ syncOff: false, off: [] })
)

const base: Synced = { agentId: 'claude-code', skills: ['alpha', 'beta'], syncOff: false, off: [] }

test('syncedLoad', () => {
  expect(syncedLoad(null, 'alpha')).toBe('none')
  expect(syncedLoad(base, 'gamma')).toBe('none')
  expect(syncedLoad(base, 'alpha')).toBe('loaded')
  expect(syncedLoad({ ...base, off: ['alpha'] }, 'alpha')).toBe('not-loaded')
  expect(syncedLoad({ ...base, off: ['alpha'] }, 'beta')).toBe('loaded')
  expect(syncedLoad({ ...base, syncOff: true }, 'beta')).toBe('not-loaded')
})

test('claudeEnabled: the agent named by synced.agentId is enabled', () => {
  const agent = { id: 'claude-code', enabled: true } as Agent
  expect(claudeEnabled(base, [agent])).toBe(true)
  expect(claudeEnabled(base, [{ ...agent, enabled: false }])).toBe(false)
  expect(claudeEnabled(base, [])).toBe(false)
  expect(claudeEnabled(null, [agent])).toBe(false)
})

test('overridesBlock is the copy block, byte for byte', () => {
  expect(overridesBlock(['sparring-partner'])).toBe(
    '"skillOverrides": {\n  "anthropic-skills:sparring-partner": "off"\n}'
  )
  expect(overridesBlock(['a', 'b', 'c'])).toBe(
    '"skillOverrides": {\n  "anthropic-skills:a": "off",\n  "anthropic-skills:b": "off",\n  "anthropic-skills:c": "off"\n}'
  )
  expect(overridesBlock(['q"x'])).toContain('"anthropic-skills:q\\"x": "off"')
  expect(SYNC_OFF_LINE).toBe('"syncClaudeAiSkills": false')
})
