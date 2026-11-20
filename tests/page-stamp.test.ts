import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test } from 'vitest'
import { sourceHash } from '../src/page/stamp.mjs'

const INPUTS = [
  'src/renderer/a.ts',
  'src/core/b.ts',
  'src/page/c.ts',
  'package.json',
  'pnpm-lock.yaml'
]

async function tree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'loadout-stamp-'))
  for (const file of [...INPUTS, 'docs/x.md']) await put(root, file, 'one')
  return root
}

async function put(root: string, file: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, file)), { recursive: true })
  await writeFile(join(root, file), text)
}

test('the hash is a SHA-256 in hex and the same on a second call', async () => {
  const root = await tree()
  expect(sourceHash(root)).toMatch(/^[0-9a-f]{64}$/)
  expect(sourceHash(root)).toBe(sourceHash(root))
})

test.each(INPUTS)('the hash changes when %s changes', async (file) => {
  const root = await tree()
  const before = sourceHash(root)
  await put(root, file, 'two')
  expect(sourceHash(root)).not.toBe(before)
})

test('the hash changes when a file is added to an input folder', async () => {
  const root = await tree()
  const before = sourceHash(root)
  await put(root, 'src/page/deep/new.ts', 'one')
  expect(sourceHash(root)).not.toBe(before)
})

test('the hash changes when a file moves, with the same bytes', async () => {
  const one = await tree()
  const two = await tree()
  await put(one, 'src/page/d.ts', 'same')
  await put(two, 'src/page/e.ts', 'same')
  expect(sourceHash(one)).not.toBe(sourceHash(two))
})

test('the hash ignores a node_modules folder that a tool makes inside an input folder', async () => {
  const root = await tree()
  const before = sourceHash(root)
  // A test runner or an editor that finds src/page/vite.config.ts keeps its cache there.
  await put(root, 'src/page/node_modules/.vite/vitest/cache.json', '{}')
  await put(root, 'src/renderer/src/node_modules/x.js', 'one')
  expect(sourceHash(root)).toBe(before)
})

test('the hash does not change when a file outside the inputs changes', async () => {
  const root = await tree()
  const before = sourceHash(root)
  await put(root, 'docs/x.md', 'two')
  await put(root, 'site/app/build.json', '{}')
  expect(sourceHash(root)).toBe(before)
})
