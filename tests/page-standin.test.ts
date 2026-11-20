import { expect, test } from 'vitest'
import type { LoadoutApi, State } from '../src/core/ipc'
import raw from '../src/page/sample.json'
import { createStandIn, REFUSAL, type Sample } from '../src/page/standin'

const sample = raw as unknown as Sample

function standIn(now: number = sample.takenAt): LoadoutApi {
  return createStandIn(structuredClone(sample), now)
}

async function stateOf(api: LoadoutApi): Promise<State> {
  const result = await api.invoke('get-state')
  if (!result.ok) throw new Error(result.message)
  return result.state
}

const enabledFor = (state: State, skill: string): string[] =>
  state.entries.find((e) => e.name === skill)?.enabledFor ?? ['missing']

/** A channel name outside the table, as a renderer newer than the stand-in would send. */
const invokeAny = (api: LoadoutApi, channel: string, payload?: unknown): Promise<unknown> =>
  (api.invoke as (channel: string, payload?: unknown) => Promise<unknown>)(channel, payload)

test('get-state gives the sample', async () => {
  const state = await stateOf(standIn())
  expect(state.entries).toHaveLength(15)
  expect(state.home).toBe('/Users/you')
})

test('a toggle changes the entry, raises seq and reaches a state listener', async () => {
  const api = standIn()
  const before = await stateOf(api)
  const pushed: State[] = []
  api.on('state', (state) => pushed.push(state))
  expect(enabledFor(before, 'incident-report')).toEqual([])

  const result = await api.invoke('toggle', {
    skill: 'incident-report',
    agentId: 'claude-code',
    on: true
  })

  expect(result).toEqual({ ok: true })
  expect(pushed).toHaveLength(1)
  expect(pushed[0].seq).toBeGreaterThan(before.seq)
  expect(enabledFor(pushed[0], 'incident-report')).toEqual(['claude-code'])
  expect(enabledFor(await stateOf(api), 'incident-report')).toEqual(['claude-code'])
})

test('the same toggle twice adds the agent once, and off removes it', async () => {
  const api = standIn()
  const on = { skill: 'incident-report', agentId: 'claude-code', on: true }
  await api.invoke('toggle', on)
  await api.invoke('toggle', on)
  expect(enabledFor(await stateOf(api), 'incident-report')).toEqual(['claude-code'])

  await api.invoke('toggle', { ...on, on: false })
  expect(enabledFor(await stateOf(api), 'incident-report')).toEqual([])
})

test('a toggle for an unknown skill or agent is refused with the app text', async () => {
  const api = standIn()
  expect(await api.invoke('toggle', { skill: 'nope', agentId: 'claude-code', on: true })).toEqual({
    ok: false,
    message: '"nope" is not in your loadout.'
  })
  expect(await api.invoke('toggle', { skill: 'tdd', agentId: 'nope', on: true })).toEqual({
    ok: false,
    message: 'Unknown agent "nope".'
  })
})

test('a pack toggle changes every skill of the pack', async () => {
  const api = standIn()
  const result = await api.invoke('toggle-pack', {
    pack: 'github:acme/tools',
    agentId: 'codex',
    on: true
  })

  expect(result).toEqual({
    ok: true,
    changed: ['incident-report', 'security-review'],
    already: ['deploy-checklist'],
    refused: []
  })
  const state = await stateOf(api)
  for (const skill of ['deploy-checklist', 'incident-report', 'security-review']) {
    expect(enabledFor(state, skill)).toContain('codex')
  }
})

test('a pack toggle for an unknown pack is refused', async () => {
  const result = await standIn().invoke('toggle-pack', { pack: 'nope', agentId: 'codex', on: true })
  expect(result.ok).toBe(false)
})

test('set-loadout-view changes the view in the pushed state', async () => {
  const api = standIn()
  const pushed: State[] = []
  api.on('state', (state) => pushed.push(state))
  expect(await api.invoke('set-loadout-view', { view: 'packs' })).toEqual({ ok: true })
  expect(pushed.at(-1)?.loadoutView).toBe('packs')
})

test('the reads answer from the sample', async () => {
  const api = standIn()
  const detail = await api.invoke('skill-detail', { skill: 'brainstorming' })
  expect(detail.ok && detail.detail.skillMd).toContain('# brainstorming')

  const candidate = await api.invoke('candidate-detail', {
    agentId: 'claude-code',
    entry: 'scratch-notes'
  })
  expect(candidate.ok).toBe(true)

  const workspaces = await api.invoke('list-workspaces')
  expect(workspaces.ok && workspaces.workspaces.map((w) => w.name)).toContain('acme')
})

test('a read for something the sample does not hold is refused', async () => {
  const api = standIn()
  expect(await api.invoke('skill-detail', { skill: 'nope' })).toEqual({
    ok: false,
    message: REFUSAL
  })
  expect(await api.invoke('candidate-detail', { agentId: 'codex', entry: 'nope' })).toEqual({
    ok: false,
    message: REFUSAL
  })
})

test('an action that needs the app, and an unknown channel, both resolve with the sentence', async () => {
  const api = standIn()
  expect(REFUSAL).toBe('Sample skills only. Install Loadout to do this.')
  expect(await api.invoke('review', { skill: 'tdd' })).toEqual({ ok: false, message: REFUSAL })
  expect(await invokeAny(api, 'no-such-channel')).toEqual({ ok: false, message: REFUSAL })
  expect(await invokeAny(api, 'toString')).toEqual({ ok: false, message: REFUSAL })
})

test('the sample times move with the clock', async () => {
  const later = await stateOf(standIn(sample.takenAt + 3_600_000))
  expect(later.reviews.brainstorming.reviewedAt).toBe(
    sample.state.reviews.brainstorming.reviewedAt + 3_600_000
  )
  const detail = await standIn(sample.takenAt + 3_600_000).invoke('skill-detail', {
    skill: 'brainstorming'
  })
  const before = sample.details.brainstorming
  expect(detail.ok && before.ok && detail.detail.review?.reviewedAt).toBe(
    before.ok && (before.detail.review?.reviewedAt ?? 0) + 3_600_000
  )
})

test('an answer is a copy: a caller cannot change the stand-in through it', async () => {
  const api = standIn()
  const state = await stateOf(api)
  state.entries.length = 0
  expect((await stateOf(api)).entries).toHaveLength(15)
})

test('on returns an unsubscribe function, and only state is ever sent', async () => {
  const api = standIn()
  const pushed: State[] = []
  let logged = 0
  const off = api.on('state', (state) => pushed.push(state))
  expect(typeof api.on('log', () => logged++)).toBe('function')
  off()
  await api.invoke('toggle', { skill: 'tdd', agentId: 'codex', on: false })
  expect(pushed).toHaveLength(0)
  expect(logged).toBe(0)
})

test('the sample names no temporary path', () => {
  const text = JSON.stringify(raw)
  for (const leftover of ['/var/folders', '/private/', 'fakebin', 'loadout-e2e-']) {
    expect(text).not.toContain(leftover)
  }
})
