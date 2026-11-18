import { lutimes, mkdir, mkdtemp, readdir, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { pathsFrom, type Paths } from '../src/core/paths'
import {
  compareCopies,
  currentReviews,
  deleteReview,
  editedFiles,
  fileTimes,
  fingerprint,
  readReview,
  readSavedReview,
  reviewFromStdout,
  saveReview,
  skillTexts,
  type SavedReview,
  type SkillFile
} from '../src/main/reviews'

let home: string
let paths: Paths

async function skill(name: string): Promise<string> {
  const folder = join(home, 'Code', 'Skills', name)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'SKILL.md'), `---\nname: ${name}\n---\n`)
  return folder
}

async function saved(folder: string, score: unknown = 65): Promise<SavedReview> {
  return {
    reviewedAt: 1_000,
    fingerprint: (await fingerprint(folder)) ?? '',
    tessl: { review: { reviewScore: score } }
  }
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'loadout-reviews-'))
  paths = pathsFrom(home)
})

describe('fingerprint', () => {
  test('is stable for the same folder', async () => {
    const folder = await skill('a')
    expect(await fingerprint(folder)).toMatch(/^[0-9a-f]{64}$/)
    expect(await fingerprint(folder)).toBe(await fingerprint(folder))
  })

  test('changes when a byte of SKILL.md changes', async () => {
    const folder = await skill('a')
    const before = await fingerprint(folder)
    await writeFile(join(folder, 'SKILL.md'), '---\nname: b\n---\n')
    expect(await fingerprint(folder)).not.toBe(before)
  })

  test('changes when a file behind a symlink changes', async () => {
    const folder = await skill('a')
    await writeFile(join(home, 'shared.md'), 'one')
    await symlink(join(home, 'shared.md'), join(folder, 'shared.md'))
    const before = await fingerprint(folder)
    await writeFile(join(home, 'shared.md'), 'two')
    expect(await fingerprint(folder)).not.toBe(before)
  })

  test('changes when a file is added below the folder', async () => {
    const folder = await skill('a')
    const before = await fingerprint(folder)
    await mkdir(join(folder, 'references'))
    await writeFile(join(folder, 'references', 'x.md'), 'x')
    expect(await fingerprint(folder)).not.toBe(before)
  })

  test('ignores .git', async () => {
    const folder = await skill('a')
    const before = await fingerprint(folder)
    await mkdir(join(folder, '.git'))
    await writeFile(join(folder, '.git', 'FETCH_HEAD'), 'abc')
    expect(await fingerprint(folder)).toBe(before)
  })

  test.each([
    ['.DS_Store'],
    ['scripts/__pycache__/x.cpython-312.pyc'],
    ['node_modules/pkg/index.js'],
    ['references/.DS_Store']
  ])('ignores %s', async (rel) => {
    const folder = await skill('a')
    const before = await fingerprint(folder)
    const path = join(folder, rel)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, 'x')
    expect(await fingerprint(folder)).toBe(before)
  })

  test('is null for a missing folder', async () => {
    expect(await fingerprint(join(home, 'nope'))).toBeNull()
  })
})

describe('store', () => {
  test('saveReview then readSavedReview round-trips; a second save replaces it', async () => {
    const folder = await skill('a')
    const first = await saved(folder, 65)
    await saveReview(paths, 'a', first)
    expect(await readSavedReview(paths, 'a')).toEqual(first)
    const second = { ...first, reviewedAt: 2_000, tessl: { review: { reviewScore: 80 } } }
    await saveReview(paths, 'a', second)
    expect(await readSavedReview(paths, 'a')).toEqual(second)
  })

  test.each(['not json', '{"reviewedAt":"x"}'])('readSavedReview is null for %s', async (text) => {
    await mkdir(paths.reviews, { recursive: true })
    await writeFile(join(paths.reviews, 'a.json'), text)
    expect(await readSavedReview(paths, 'a')).toBeNull()
  })

  test('readSavedReview is null when no file exists', async () => {
    expect(await readSavedReview(paths, 'a')).toBeNull()
  })

  test('saveReview leaves no temporary file', async () => {
    const folder = await skill('a')
    await saveReview(paths, 'a', await saved(folder))
    expect(await readdir(paths.reviews)).toEqual(['a.json'])
  })

  test('readReview uses a fingerprint the caller passes; null is stale', async () => {
    const folder = await skill('a')
    await saveReview(paths, 'a', await saved(folder))
    const entry = { name: 'a', target: folder }
    expect((await readReview(paths, entry, await fingerprint(folder)))?.stale).toBe(false)
    expect((await readReview(paths, entry, 'other'))?.stale).toBe(true)
    expect((await readReview(paths, entry, null))?.stale).toBe(true)
  })

  test('readReview is current after saving and stale after a change', async () => {
    const folder = await skill('a')
    await saveReview(paths, 'a', await saved(folder))
    expect((await readReview(paths, { name: 'a', target: folder }))?.stale).toBe(false)
    await writeFile(join(folder, 'SKILL.md'), 'changed')
    expect((await readReview(paths, { name: 'a', target: folder }))?.stale).toBe(true)
  })

  test('currentReviews lists only readable, current reviews', async () => {
    const a = await skill('a')
    const b = await skill('b')
    const c = await skill('c')
    await saveReview(paths, 'a', await saved(a, 65))
    await saveReview(paths, 'b', await saved(b))
    await writeFile(join(b, 'SKILL.md'), 'changed')
    await writeFile(join(paths.reviews, 'c.json'), 'not json')
    const entries = [
      { name: 'a', target: a },
      { name: 'b', target: b },
      { name: 'c', target: c }
    ]
    expect(await currentReviews(paths, entries)).toEqual({ a: { score: 65, reviewedAt: 1_000 } })
  })

  test('currentReviews gives a null score when the score is not a number', async () => {
    const a = await skill('a')
    await saveReview(paths, 'a', await saved(a, '65'))
    expect(await currentReviews(paths, [{ name: 'a', target: a }])).toEqual({
      a: { score: null, reviewedAt: 1_000 }
    })
  })

  test('currentReviews skips a skill whose folder is missing', async () => {
    const a = await skill('a')
    await saveReview(paths, 'a', await saved(a))
    expect(await currentReviews(paths, [{ name: 'a', target: join(home, 'gone') }])).toEqual({})
  })

  test('deleteReview removes the file; a second call does not throw', async () => {
    const a = await skill('a')
    await saveReview(paths, 'a', await saved(a))
    await deleteReview(paths, 'a')
    expect(await readdir(paths.reviews)).toEqual([])
    await expect(deleteReview(paths, 'a')).resolves.toBeUndefined()
  })
})

describe('reviewFromStdout', () => {
  test('builds a SavedReview from a JSON object', () => {
    expect(reviewFromStdout('{"review":{"reviewScore":70}}', 'abc', 5)).toEqual({
      reviewedAt: 5,
      fingerprint: 'abc',
      tessl: { review: { reviewScore: 70 } }
    })
  })
  test('uses an empty fingerprint when the folder could not be read', () => {
    expect(reviewFromStdout('{}', null, 5)?.fingerprint).toBe('')
  })
  test.each(['not json', '[1]', '42', ''])('is null for %j, so the old file stays', (stdout) => {
    expect(reviewFromStdout(stdout, 'abc', 5)).toBeNull()
  })
})

describe('compareCopies', () => {
  test('compareCopies: same, differs, unreadable', async () => {
    const a = join(home, 'a')
    const b = join(home, 'b')
    for (const folder of [a, b]) {
      await mkdir(join(folder, 'scripts'), { recursive: true })
      await writeFile(join(folder, 'SKILL.md'), '---\nname: x\n---\n')
      await writeFile(join(folder, 'scripts/run.py'), 'print(1)\n')
    }
    expect(await compareCopies(a, b)).toBe('same')
    await mkdir(join(a, 'references/evals/deep'), { recursive: true })
    await writeFile(join(a, 'references/evals/deep/x.md'), 'x')
    expect(await compareCopies(a, b)).toBe('same')
    await mkdir(join(a, 'evals'))
    await writeFile(join(a, 'evals/e.json'), '{}')
    await mkdir(join(a, '.tessl-plugin'))
    await writeFile(join(a, '.tessl-plugin/plugin.json'), '{}')
    await mkdir(join(b, 'scripts/__pycache__'))
    await writeFile(join(b, 'scripts/__pycache__/x.pyc'), 'x')
    expect(await compareCopies(a, b)).toBe('same')
    await writeFile(join(b, 'scripts/run.py'), 'changed')
    expect(await compareCopies(a, b)).toBe('differs')
    expect(await compareCopies(a, join(b, 'gone'))).toBe('unreadable')
  })
})

describe('fileTimes', () => {
  test('fileTimes: counted files with their times; the manifest, evals and tool folders left out', async () => {
    const folder = await skill('timed')
    for (const dir of ['.tessl-plugin', 'evals/one', 'node_modules/x', '.git', 'references/deep'])
      await mkdir(join(folder, dir), { recursive: true })
    for (const file of [
      '.tessl-plugin/plugin.json',
      'evals/one/scenario.md',
      'node_modules/x/index.js',
      '.git/HEAD',
      '.DS_Store',
      'references/deep/a.md'
    ])
      await writeFile(join(folder, file), 'x')
    await utimes(join(folder, 'references/deep/a.md'), 100, 100)
    const times = await fileTimes(folder)
    expect(times.map((t) => t.rel).sort()).toEqual(['SKILL.md', 'references/deep/a.md'])
    expect(times.find((t) => t.rel === 'references/deep/a.md')?.mtimeMs).toBe(100_000)
  })

  test('fileTimes: a symlink by its target time, a dangling one by its own', async () => {
    const folder = await skill('linked')
    const target = join(home, 'target.md')
    await writeFile(target, 'x')
    await utimes(target, 200, 200)
    await symlink(target, join(folder, 'link.md'))
    await symlink(join(home, 'gone.md'), join(folder, 'dangling.md'))
    await lutimes(join(folder, 'dangling.md'), 300, 300)
    const times = await fileTimes(folder)
    expect(times.find((t) => t.rel === 'link.md')?.mtimeMs).toBe(200_000)
    expect(times.find((t) => t.rel === 'dangling.md')?.mtimeMs).toBe(300_000)
  })

  test('fileTimes: an unreadable folder throws', async () => {
    await expect(fileTimes(join(home, 'missing'))).rejects.toThrow()
  })

  test('fileTimes: a symlink to a folder counts by its own time, never the folder time', async () => {
    const folder = await skill('dirlink')
    const target = join(home, 'shared')
    await mkdir(target)
    await utimes(target, 500, 500)
    await symlink(target, join(folder, 'shared'))
    await lutimes(join(folder, 'shared'), 400, 400)
    expect((await fileTimes(folder)).find((t) => t.rel === 'shared')?.mtimeMs).toBe(400_000)
  })
})

describe('editedFiles', () => {
  test('editedFiles: the files more than 2 s newer than the manifest, newest first', async () => {
    const folder = await skill('edited')
    await mkdir(join(folder, '.tessl-plugin'))
    await writeFile(join(folder, '.tessl-plugin', 'plugin.json'), '{}')
    await writeFile(join(folder, 'notes.md'), 'x')
    await utimes(join(folder, '.tessl-plugin', 'plugin.json'), 1_000, 1_000)
    await utimes(join(folder, 'SKILL.md'), 1_060, 1_060)
    await utimes(join(folder, 'notes.md'), 1_002, 1_002)
    expect(await editedFiles(folder)).toEqual(['SKILL.md'])
    await utimes(join(folder, 'notes.md'), 1_090, 1_090)
    expect(await editedFiles(folder)).toEqual(['notes.md', 'SKILL.md'])
  })

  test('editedFiles: nothing without a manifest or a readable folder', async () => {
    expect(await editedFiles(await skill('plain'))).toEqual([])
    expect(await editedFiles(join(home, 'missing'))).toEqual([])
  })
})

describe('skillTexts', () => {
  const file = (rel: string, text: string): SkillFile => ({
    rel,
    link: false,
    data: Buffer.from(text),
    resolved: null
  })

  test('gives the text of a text file', () => {
    expect(skillTexts([file('SKILL.md', 'hi')])).toEqual([
      { path: 'SKILL.md', text: 'hi', binary: false }
    ])
  })

  test('marks a file with a zero byte as binary, with no text', () => {
    expect(
      skillTexts([{ rel: 'a.png', link: false, data: Buffer.from([1, 0, 2]), resolved: null }])
    ).toEqual([{ path: 'a.png', text: null, binary: true }])
  })

  test('gives a symlink the text of its target', () => {
    expect(
      skillTexts([
        { rel: 'l.md', link: true, data: Buffer.from('link:x'), resolved: Buffer.from('target') }
      ])
    ).toEqual([{ path: 'l.md', text: 'target', binary: false }])
  })

  test('gives a dangling symlink no text and no binary mark', () => {
    expect(
      skillTexts([{ rel: 'l.md', link: true, data: Buffer.from('link:x'), resolved: null }])
    ).toEqual([{ path: 'l.md', text: null, binary: false }])
  })
})
