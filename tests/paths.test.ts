import { expect, test } from 'vitest'
import { displayPath, expandHome, pathsFrom } from '../src/core/paths'

test('pathsFrom builds the thirteen paths from the home folder', () => {
  expect(pathsFrom('/tmp/h')).toEqual({
    home: '/tmp/h',
    loadout: '/tmp/h/.loadout',
    config: '/tmp/h/.loadout/config.json',
    library: '/tmp/h/.loadout/skills',
    repos: '/tmp/h/.loadout/repos',
    reviews: '/tmp/h/.loadout/reviews',
    fixes: '/tmp/h/.loadout/fixes',
    backups: '/tmp/h/.loadout/backups',
    tesslPlugins: '/tmp/h/.tessl/plugins',
    agentsSkills: '/tmp/h/.agents/skills',
    claudeJson: '/tmp/h/.claude.json',
    claudeSettings: '/tmp/h/.claude/settings.json',
    synced: '/tmp/h/.claude/skills/synced'
  })
})

test('expandHome expands ~ and leaves other paths alone', () => {
  expect(expandHome('~/.claude/skills', '/tmp/h')).toBe('/tmp/h/.claude/skills')
  expect(expandHome('~', '/tmp/h')).toBe('/tmp/h')
  expect(expandHome('/abs/dir', '/tmp/h')).toBe('/abs/dir')
})

test('displayPath shortens paths under home', () => {
  expect(displayPath('/tmp/h/Code/Skills/x', '/tmp/h')).toBe('~/Code/Skills/x')
  expect(displayPath('/other/x', '/tmp/h')).toBe('/other/x')
})
