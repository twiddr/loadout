import { chmod, lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { pathsFrom, type Paths } from '../src/core/paths'
import { currentFixes, deleteFix, finishFix, readFix, saveBefore, undoFix } from '../src/main/fixes'
import { currentReviews, fingerprint, reviewFromStdout, saveReview } from '../src/main/reviews'

let home: string
let paths: Paths
let folder: string
let entry: { name: string; target: string }
let before: string

const NOT_UNDOABLE =
  'The skill changed after the fix, so Undo would erase those edits. Keep the fix, or restore by hand from ~/.loadout/fixes/a/before.'

async function put(rel: string, text: string | Buffer): Promise<void> {
  await mkdir(join(folder, rel, '..'), { recursive: true })
  await writeFile(join(folder, rel), text)
}

const read = (rel: string): Promise<string> => readFile(join(folder, rel), 'utf8')

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'loadout-fixes-'))
  paths = pathsFrom(home)
  folder = join(home, 'Code', 'Skills', 'a')
  entry = { name: 'a', target: folder }
  before = join(paths.fixes, 'a', 'before')
  await put('SKILL.md', '---\nname: a\n---\nold\n')
  await put('references/a.md', 'ref a\n')
  await put('.git/HEAD', 'ref: main\n')
  await put('node_modules/x/i.js', 'x\n')
})

/** The fix the fake makes: SKILL.md changed, a file in a new folder added, a file removed, a binary added. */
async function fakeFix(): Promise<void> {
  await saveBefore(paths, 'a', folder)
  await put('SKILL.md', '---\nname: a\n---\nnew\n')
  await put('references/new/b.md', 'ref b\n')
  await put('logo.bin', Buffer.from([1, 0, 2]))
  const { rm } = await import('node:fs/promises')
  await rm(join(folder, 'references', 'a.md'))
}

describe('saveBefore', () => {
  test('copies the skill without the skipped names', async () => {
    await saveBefore(paths, 'a', folder)
    expect(await readFile(join(before, 'SKILL.md'), 'utf8')).toBe('---\nname: a\n---\nold\n')
    expect(await readFile(join(before, 'references', 'a.md'), 'utf8')).toBe('ref a\n')
    expect(existsSync(join(before, '.git'))).toBe(false)
    expect(existsSync(join(before, 'node_modules'))).toBe(false)
  })

  // A copied link points at the same file as the original, so it is no copy to undo from.
  test('refuses a skill with a file or folder symlink and keeps the earlier copy', async () => {
    await saveBefore(paths, 'a', folder)
    await writeFile(join(home, 'shared.md'), 'ORIGINAL ONLY COPY\n')
    await symlink(join(home, 'shared.md'), join(folder, 'shared.md'))
    await mkdir(join(home, 'shared-dir'))
    await symlink(join(home, 'shared-dir'), join(folder, 'references', 'linked'))
    await expect(saveBefore(paths, 'a', folder)).rejects.toThrow(
      'Fix cannot save a copy of "a" to undo from, because it holds symlinks: references/linked, shared.md. Replace each link with a regular file or folder, then run Fix again.'
    )
    expect(await readFile(join(before, 'SKILL.md'), 'utf8')).toBe('---\nname: a\n---\nold\n')
    expect(existsSync(join(before, 'shared.md'))).toBe(false)
    expect(await readFile(join(home, 'shared.md'), 'utf8')).toBe('ORIGINAL ONLY COPY\n')
  })

  test('keeps an empty folder', async () => {
    await mkdir(join(folder, 'assets', 'empty'), { recursive: true })
    await saveBefore(paths, 'a', folder)
    expect((await lstat(join(before, 'assets', 'empty'))).isDirectory()).toBe(true)
  })

  test('a second saveBefore replaces the copy', async () => {
    await saveBefore(paths, 'a', folder)
    await put('references/extra.md', 'extra\n')
    await put('SKILL.md', 'changed\n')
    await saveBefore(paths, 'a', folder)
    expect(await readFile(join(before, 'SKILL.md'), 'utf8')).toBe('changed\n')
    expect(existsSync(join(before, 'references', 'extra.md'))).toBe(true)
  })
})

describe('finishFix', () => {
  test('an unchanged folder leaves no saved fix', async () => {
    await saveBefore(paths, 'a', folder)
    expect(await finishFix(paths, 'a', folder, 5)).toBe(0)
    expect(existsSync(join(paths.fixes, 'a'))).toBe(false)
    expect(await readFix(paths, entry)).toBeNull()
  })

  test('a change only under node_modules is no change', async () => {
    await saveBefore(paths, 'a', folder)
    await put('node_modules/x/i.js', 'y\n')
    expect(await finishFix(paths, 'a', folder, 5)).toBe(0)
  })

  test('a read error records the fix as not undoable, then throws', async () => {
    await saveBefore(paths, 'a', folder)
    await chmod(join(folder, 'SKILL.md'), 0o000)
    try {
      await expect(finishFix(paths, 'a', folder, 5)).rejects.toThrow()
      expect(await readFix(paths, entry)).toEqual({
        fixedAt: 5,
        undoable: false,
        unreadable: true,
        files: []
      })
    } finally {
      await chmod(join(folder, 'SKILL.md'), 0o644)
    }
  })

  test('a changed folder is recorded and undoable, and the count of changed files returned', async () => {
    await fakeFix()
    expect(await finishFix(paths, 'a', folder, 5)).toBe(4)
    const fix = await readFix(paths, entry)
    expect(fix).toMatchObject({ fixedAt: 5, undoable: true })
  })
})

describe('readFix', () => {
  test('lists the changed files, SKILL.md first, with both texts', async () => {
    await fakeFix()
    await finishFix(paths, 'a', folder, 5)
    expect((await readFix(paths, entry))?.files).toEqual([
      {
        path: 'SKILL.md',
        change: 'changed',
        before: '---\nname: a\n---\nold\n',
        after: '---\nname: a\n---\nnew\n',
        binary: false
      },
      { path: 'logo.bin', change: 'added', before: null, after: null, binary: true },
      { path: 'references/a.md', change: 'removed', before: 'ref a\n', after: null, binary: false },
      {
        path: 'references/new/b.md',
        change: 'added',
        before: null,
        after: 'ref b\n',
        binary: false
      }
    ])
  })

  test('is unreadable, not changed, when the folder cannot be read', async () => {
    await fakeFix()
    await finishFix(paths, 'a', folder, 5)
    expect(await readFix(paths, { name: 'a', target: join(home, 'gone') })).toMatchObject({
      undoable: false,
      unreadable: true
    })
  })

  test('is not undoable after an edit made through a symlink the fix added', async () => {
    await writeFile(join(home, 'shared.md'), 'shared\n')
    await fakeFix()
    await symlink(join(home, 'shared.md'), join(folder, 'shared.md'))
    await finishFix(paths, 'a', folder, 5)
    await writeFile(join(home, 'shared.md'), 'my edit\n')
    expect((await readFix(paths, entry))?.undoable).toBe(false)
  })

  test('is not undoable after a later edit', async () => {
    await fakeFix()
    await finishFix(paths, 'a', folder, 5)
    await put('SKILL.md', 'my edit\n')
    expect((await readFix(paths, entry))?.undoable).toBe(false)
  })
})

describe('undoFix', () => {
  test('puts the old version back and leaves the skipped names alone', async () => {
    await fakeFix()
    await finishFix(paths, 'a', folder, 5)
    expect(await undoFix(paths, entry)).toEqual({ ok: true })
    expect(await read('SKILL.md')).toBe('---\nname: a\n---\nold\n')
    expect(await read('references/a.md')).toBe('ref a\n')
    expect(existsSync(join(folder, 'references', 'new'))).toBe(false)
    expect(existsSync(join(folder, 'logo.bin'))).toBe(false)
    expect(existsSync(join(folder, 'references'))).toBe(true)
    expect(await read('.git/HEAD')).toBe('ref: main\n')
    expect(await read('node_modules/x/i.js')).toBe('x\n')
    expect(existsSync(join(paths.fixes, 'a'))).toBe(false)
  })

  test('refuses after a later edit and changes nothing', async () => {
    await fakeFix()
    await finishFix(paths, 'a', folder, 5)
    await put('SKILL.md', 'my edit\n')
    expect(await undoFix(paths, entry)).toEqual({ ok: false, message: NOT_UNDOABLE })
    expect(await read('SKILL.md')).toBe('my edit\n')
    expect(existsSync(join(before, 'SKILL.md'))).toBe(true)
  })

  test('keeps an empty folder from before the fix that the fix added a file to', async () => {
    await mkdir(join(folder, 'assets'))
    await saveBefore(paths, 'a', folder)
    await put('assets/new.png', 'png')
    await finishFix(paths, 'a', folder, 5)
    expect(await undoFix(paths, entry)).toEqual({ ok: true })
    expect(existsSync(join(folder, 'assets', 'new.png'))).toBe(false)
    expect((await lstat(join(folder, 'assets'))).isDirectory()).toBe(true)
  })

  test('undoes a rename that only changes letter case, without losing the file', async () => {
    await put('Notes.md', 'old notes\n')
    await saveBefore(paths, 'a', folder)
    const { rename } = await import('node:fs/promises')
    await rename(join(folder, 'Notes.md'), join(folder, 'notes.md'))
    await finishFix(paths, 'a', folder, 5)
    expect(await undoFix(paths, entry)).toEqual({ ok: true })
    const { readdir } = await import('node:fs/promises')
    expect((await readdir(folder)).filter((n) => n.toLowerCase() === 'notes.md')).toEqual([
      'Notes.md'
    ])
    expect(await read('Notes.md')).toBe('old notes\n')
  })

  test('undoes a folder rename that only changes letter case', async () => {
    await put('Refs/a.md', 'ref in Refs\n')
    await saveBefore(paths, 'a', folder)
    const { rename } = await import('node:fs/promises')
    await rename(join(folder, 'Refs'), join(folder, 'refs'))
    await finishFix(paths, 'a', folder, 5)
    expect(await undoFix(paths, entry)).toEqual({ ok: true })
    expect(await read('Refs/a.md')).toBe('ref in Refs\n')
  })

  test('undoes a fix that replaced a file with a folder', async () => {
    await put('guide', 'a guide file\n')
    await saveBefore(paths, 'a', folder)
    const { rm } = await import('node:fs/promises')
    await rm(join(folder, 'guide'))
    await put('guide/x.md', 'x\n')
    await finishFix(paths, 'a', folder, 5)
    expect(await undoFix(paths, entry)).toEqual({ ok: true })
    expect(await read('guide')).toBe('a guide file\n')
  })

  test('undoes a fix that replaced a folder with a file', async () => {
    await saveBefore(paths, 'a', folder)
    const { rm } = await import('node:fs/promises')
    await rm(join(folder, 'references'), { recursive: true })
    await put('references', 'now a file\n')
    await finishFix(paths, 'a', folder, 5)
    expect(await undoFix(paths, entry)).toEqual({ ok: true })
    expect(await read('references/a.md')).toBe('ref a\n')
  })

  test('refuses when there is no saved fix', async () => {
    expect((await undoFix(paths, entry)).ok).toBe(false)
  })
})

describe('currentFixes and deleteFix', () => {
  test('one row per readable fix; a corrupt fix.json gives none', async () => {
    await fakeFix()
    await finishFix(paths, 'a', folder, 5)
    await mkdir(join(paths.fixes, 'b'), { recursive: true })
    await writeFile(join(paths.fixes, 'b', 'fix.json'), 'not json')
    const entries = [entry, { name: 'b', target: join(home, 'b') }]
    expect(await currentFixes(paths, entries)).toEqual({ a: { fixedAt: 5, undoable: true } })
  })

  test.each(['', '.', '..', '../..', 'a/b'])('deleteFix refuses the name %j', async (name) => {
    await mkdir(paths.fixes, { recursive: true })
    await writeFile(join(paths.loadout, 'keep.txt'), 'keep')
    await expect(deleteFix(paths, name)).rejects.toThrow('Not a skill name')
    expect(existsSync(join(paths.loadout, 'keep.txt'))).toBe(true)
  })

  test('deleteFix removes the saved fix; a second call does not throw', async () => {
    await fakeFix()
    await finishFix(paths, 'a', folder, 5)
    await deleteFix(paths, 'a')
    expect(existsSync(join(paths.fixes, 'a'))).toBe(false)
    await expect(deleteFix(paths, 'a')).resolves.toBeUndefined()
  })
})

describe('saved review across a fix', () => {
  /** A review as the `review` handler saves it: fingerprint taken before the run. */
  async function reviewNow(score: number, at: number): Promise<void> {
    const before = await fingerprint(folder)
    const saved = reviewFromStdout(JSON.stringify({ review: { reviewScore: score } }), before, at)
    if (saved) await saveReview(paths, 'a', saved)
  }

  test('stale after the fix; current again after Undo', async () => {
    await reviewNow(60, 1)
    await fakeFix()
    await finishFix(paths, 'a', folder, 2)
    expect(await currentReviews(paths, [entry])).toEqual({})
    expect((await undoFix(paths, entry)).ok).toBe(true)
    expect(await currentReviews(paths, [entry])).toEqual({ a: { score: 60, reviewedAt: 1 } })
  })

  test('after Keep, the review that follows describes the kept folder', async () => {
    await reviewNow(60, 1)
    await fakeFix()
    await finishFix(paths, 'a', folder, 2)
    await deleteFix(paths, 'a')
    await reviewNow(98, 3)
    expect(await currentReviews(paths, [entry])).toEqual({ a: { score: 98, reviewedAt: 3 } })
    expect(await read('SKILL.md')).toBe('---\nname: a\n---\nnew\n')
  })
})
