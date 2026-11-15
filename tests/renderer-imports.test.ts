import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const ROOT = join(__dirname, '..')

/** `pnpm dev` does not drop unused imports, so one Node import in a core file blanks the window. */
test('core files the renderer imports load no Node or Electron module', async () => {
  const renderer = join(ROOT, 'src', 'renderer', 'src')
  const used = new Set<string>()
  for (const name of await readdir(renderer, { recursive: true })) {
    if (!/\.(svelte|ts)$/.test(name)) continue
    const text = await readFile(join(renderer, name), 'utf8')
    for (const m of text.matchAll(/^\s*import (?!type ).* from '(?:\.\.\/)+core\/([a-z]+)'/gm)) {
      used.add(m[1])
    }
  }
  const offenders: string[] = []
  for (const name of used) {
    const text = await readFile(join(ROOT, 'src', 'core', `${name}.ts`), 'utf8')
    if (/^import (?!type ).* from '(node:|electron)/m.test(text)) offenders.push(name)
  }
  expect(offenders.sort()).toEqual([])
})
