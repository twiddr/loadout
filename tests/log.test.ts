import { expect, test } from 'vitest'
import type { LogEvent } from '../src/core/ipc'
import {
  addedText,
  isFailed,
  runs,
  runText,
  stoppedText,
  trimLog
} from '../src/renderer/src/format'

const events: LogEvent[] = [
  { runId: 1, action: 'review', command: 'tessl review run x' },
  { runId: 1, line: 'a' },
  { runId: 1, stream: 'stderr', line: 'b' },
  { runId: 1, exit: 0 },
  { runId: 2, action: 'update', command: 'git pull' },
  { runId: 2, stream: 'meta', line: 'cancelled by user' },
  { runId: 2, exit: null, stopped: 'cancelled' },
  { runId: 3, action: 'remove', stream: 'meta', line: 'Clone at …' }
]

test('runs groups events into runs, newest first', () => {
  const all = runs(events)
  expect(all.map((r) => r.runId)).toEqual([3, 2, 1])
  expect(all[0].command).toBeUndefined()
  expect(all[0].exit).toBeUndefined()
  expect(all[1].exit).toBeNull()
  expect(all[2].lines).toEqual([
    { text: 'a', stream: 'stdout' },
    { text: 'b', stream: 'stderr' }
  ])
})

test('the failed filter keeps runs with a non-zero exit only', () => {
  expect(runs(events).filter(isFailed)).toEqual([])
  const withFailure = runs([...events, { runId: 1, exit: 1 }])
  expect(withFailure.filter(isFailed).map((r) => r.runId)).toEqual([1])
})

test.each([
  ['cancelled', 'cancelled', false],
  ['timed-out', 'timed out', true],
  ['failed', 'failed', true]
] as const)('a run stopped as %s reads "%s"; failed: %s', (stopped, text, failed) => {
  const [run] = runs([
    { runId: 1, action: 'add', command: 'tessl skill lint x' },
    { runId: 1, exit: null, stopped }
  ])
  expect(stoppedText(run)).toBe(text)
  expect(isFailed(run)).toBe(failed)
  expect(runText(run)).toBe(`$ tessl skill lint x\n${text}\n`)
})

test('trimLog drops whole runs older than the cap', () => {
  const log = [
    { runId: 1, command: 'a' },
    { runId: 1, exit: 0 },
    { runId: 2, command: 'b' },
    { runId: 2, exit: 0 },
    { runId: 3, command: 'c' }
  ]
  trimLog(log, 2)
  expect(log).toEqual([
    { runId: 2, command: 'b' },
    { runId: 2, exit: 0 },
    { runId: 3, command: 'c' }
  ])
  trimLog(log, 2)
  expect(log).toHaveLength(3)
})

test('addedText names the lint result', () => {
  expect(addedText('ok')).toBe('Added')
  expect(addedText('problems')).toBe('Added. tessl skill lint reported problems, see the log.')
  expect(addedText('unfinished')).toBe('Added. tessl skill lint did not finish, see the log.')
})
