import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  agentFolder,
  DEFAULT_CONFIG,
  parseConfig,
  readConfig,
  serializeConfig,
  writeConfig
} from '../src/core/config'
import { pathsFrom } from '../src/core/paths'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'loadout-config-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

test('readConfig on an empty home returns the default config', async () => {
  const config = await readConfig(pathsFrom(home))
  expect(config).toEqual(DEFAULT_CONFIG)
  expect(config.agents[0].id).toBe('claude-code')
  expect(config.agents[0].folder).toBe('~/.claude/skills')
  expect(config.agents[0].alsoReadBy).toEqual(['OpenCode'])
  expect(config.agents[1].id).toBe('codex')
  expect(config.agents.map((a) => a.enabled)).toEqual([false, false])
  expect(config.tesslWorkspace).toBe('')
})

test('writeConfig then readConfig round-trips', async () => {
  const paths = pathsFrom(home)
  const config = structuredClone(DEFAULT_CONFIG)
  config.agents[1].enabled = true
  config.tesslWorkspace = 'acme'
  config.tesslWorkspaces = ['acme', 'factory-workspace']
  await writeConfig(paths, config)
  expect(await readConfig(paths)).toEqual(config)
})

test('writeConfig creates the loadout folder', async () => {
  const paths = pathsFrom(home)
  await writeConfig(paths, DEFAULT_CONFIG)
  expect(await readConfig(paths)).toEqual(DEFAULT_CONFIG)
})

test('writeConfig leaves no temporary file next to config.json', async () => {
  const paths = pathsFrom(home)
  await writeConfig(paths, DEFAULT_CONFIG)
  await writeConfig(paths, { ...DEFAULT_CONFIG, appearance: 'dark' })
  expect(await readdir(paths.loadout)).toEqual(['config.json'])
  expect((await readConfig(paths)).appearance).toBe('dark')
})

test('parseConfig fills a missing field with its default', () => {
  const config = parseConfig('{"agents": []}', '/p')
  expect(config.agents).toEqual([])
  expect(config.tesslWorkspace).toBe('')
  expect(parseConfig('{}', '/p').agents).toEqual(DEFAULT_CONFIG.agents)
})

test('parseConfig keeps a known appearance and defaults an unknown one to dark', () => {
  expect(parseConfig('{"appearance": "system"}', '/p').appearance).toBe('system')
  expect(parseConfig('{"appearance": "light"}', '/p').appearance).toBe('light')
  expect(parseConfig('{"appearance": "sepia"}', '/p').appearance).toBe('dark')
  expect(parseConfig('{}', '/p').appearance).toBe('dark')
})

test('parseConfig rejects bad JSON with the path in the message', () => {
  expect(() => parseConfig('{', '/p/config.json')).toThrow(
    /^Config at \/p\/config\.json is not valid JSON/
  )
})

test('agentFolder expands ~ and keeps an absolute folder', () => {
  const paths = pathsFrom('/tmp/h')
  expect(agentFolder(DEFAULT_CONFIG.agents[0], paths)).toBe('/tmp/h/.claude/skills')
  expect(agentFolder({ ...DEFAULT_CONFIG.agents[0], folder: '/abs/skills' }, paths)).toBe(
    '/abs/skills'
  )
})

test('parseConfig keeps the workspace list and puts the default in it', () => {
  expect(parseConfig('{"tesslWorkspace": "acme"}', '/p').tesslWorkspaces).toEqual(['acme'])
  expect(
    parseConfig('{"tesslWorkspace": "acme", "tesslWorkspaces": ["beta", 3, ""]}', '/p')
      .tesslWorkspaces
  ).toEqual(['acme', 'beta'])
  expect(
    parseConfig('{"tesslWorkspace": "beta", "tesslWorkspaces": ["acme", "beta"]}', '/p')
      .tesslWorkspaces
  ).toEqual(['acme', 'beta'])
  expect(parseConfig('{}', '/p').tesslWorkspaces).toEqual([])
})

test('parseConfig rejects an agent entry that lacks a field, naming the path and the entry', () => {
  const good = JSON.stringify(DEFAULT_CONFIG.agents[0])
  expect(() => parseConfig('{"agents": [{}]}', '/p/config.json')).toThrow(
    /^Config at \/p\/config\.json: agents\[0\] needs a string "id"\./
  )
  expect(() => parseConfig(`{"agents": [${good}, null]}`, '/p/config.json')).toThrow(
    /^Config at \/p\/config\.json: agents\[1\] is not an object\./
  )
  const noFolder = { ...DEFAULT_CONFIG.agents[0], folder: 7 }
  expect(() => parseConfig(JSON.stringify({ agents: [noFolder] }), '/p')).toThrow(
    /agents\[0\] needs a string "folder"/
  )
  const badList = { ...DEFAULT_CONFIG.agents[0], alsoReadBy: [1] }
  expect(() => parseConfig(JSON.stringify({ agents: [badList] }), '/p')).toThrow(
    /agents\[0\] needs a list of strings "alsoReadBy"/
  )
  const badFlag = { ...DEFAULT_CONFIG.agents[0], enabled: 'yes' }
  expect(() => parseConfig(JSON.stringify({ agents: [badFlag] }), '/p')).toThrow(
    /agents\[0\] needs true or false "enabled"/
  )
  expect(parseConfig(JSON.stringify({ agents: DEFAULT_CONFIG.agents }), '/p').agents).toEqual(
    DEFAULT_CONFIG.agents
  )
})

test('loadoutView defaults to skills, accepts packs, and ignores a wrong value', () => {
  const p = pathsFrom(home).config
  expect(parseConfig('{}', p).loadoutView).toBe('skills')
  expect(parseConfig('{"loadoutView":"packs"}', p).loadoutView).toBe('packs')
  expect(parseConfig('{"loadoutView":"grid"}', p).loadoutView).toBe('skills')
  expect(serializeConfig(DEFAULT_CONFIG)).toContain('"loadoutView": "skills"')
})
