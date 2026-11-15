import { join } from 'node:path'
import { expect, test } from 'vitest'
import { boxClickOn, derivePacks, packBox } from '../src/core/packs'
import type { LibraryEntry, Source } from '../src/core/library'
import { pathsFrom } from '../src/core/paths'

const paths = pathsFrom('/home/u')

function entry(name: string, source: Source): LibraryEntry {
  return { name, source, status: 'ok', target: `/x/${name}` }
}
const gh = (name: string, owner: string, repo: string): LibraryEntry =>
  entry(name, { type: 'github', owner, repo, subpath: name })
const local = (name: string): LibraryEntry => entry(name, { type: 'local', path: '/x' })

test('derivePacks groups a Link with two or more skills and skips singles and local', () => {
  const packs = derivePacks(
    [
      gh('a', 'acme', 'tools'),
      gh('c', 'acme', 'solo'),
      local('l1'),
      gh('b', 'acme', 'tools'),
      local('l2')
    ],
    paths
  )
  expect(packs).toEqual([
    {
      key: 'github:acme/tools',
      type: 'github',
      name: 'acme/tools',
      skills: ['a', 'b'],
      folder: join(paths.repos, 'acme', 'tools')
    }
  ])
})

test('derivePacks groups a Registry plugin', () => {
  const t = (name: string): LibraryEntry =>
    entry(name, { type: 'tessl', workspace: 'acme', plugin: 'kit', subpath: name })
  expect(derivePacks([t('x'), t('y')], paths)).toEqual([
    {
      key: 'tessl:acme/kit',
      type: 'tessl',
      name: 'acme/kit',
      skills: ['x', 'y'],
      folder: join(paths.tesslPlugins, 'acme', 'kit')
    }
  ])
})

test('derivePacks returns nothing for local skills', () => {
  expect(derivePacks([local('a'), local('b'), local('c')], paths)).toEqual([])
})

const m = (status: string, on: boolean): { status: string; enabledFor: string[] } => ({
  status,
  enabledFor: on ? ['codex'] : []
})

test('packBox looks none, some and all', () => {
  expect(packBox([m('ok', false), m('ok', false)], 'codex').look).toBe('none')
  expect(packBox([m('ok', true), m('ok', false), m('ok', false)], 'codex')).toMatchObject({
    look: 'some',
    deployed: 1,
    total: 3
  })
  expect(packBox([m('ok', true), m('ok', true)], 'codex').look).toBe('all')
})

test('packBox counts only ok members as deployable', () => {
  expect(packBox([m('ok', true), m('ok', true), m('missing', false)], 'codex')).toEqual({
    look: 'all',
    deployed: 2,
    total: 3,
    deployable: 2
  })
  expect(packBox([m('missing', false), m('missing', false)], 'codex')).toMatchObject({
    look: 'none',
    deployable: 0
  })
})

test('boxClickOn turns on unless all are on', () => {
  expect(boxClickOn('none')).toBe(true)
  expect(boxClickOn('some')).toBe(true)
  expect(boxClickOn('all')).toBe(false)
})

test('packBox counts only ok members towards all', () => {
  expect(packBox([m('ok', false), m('missing', true)], 'codex')).toMatchObject({
    look: 'some',
    deployed: 1,
    deployable: 1
  })
  expect(packBox([m('missing', true), m('missing', false)], 'codex')).toMatchObject({
    look: 'all',
    deployed: 1,
    deployable: 0
  })
  expect(packBox([m('not-a-link', false), m('ok', true)], 'codex')).toMatchObject({
    look: 'all',
    deployable: 1
  })
})

test('derivePacks sorts packs by key', () => {
  const packs = derivePacks(
    [gh('a', 'zed', 'z'), gh('b', 'zed', 'z'), gh('c', 'acme', 'a'), gh('d', 'acme', 'a')],
    paths
  )
  expect(packs.map((p) => p.key)).toEqual(['github:acme/a', 'github:zed/z'])
})
