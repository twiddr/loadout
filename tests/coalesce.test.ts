import { expect, test, vi } from 'vitest'
import { coalesce, latestOnly } from '../src/main/coalesce'

function gate(): { fn: () => Promise<void>; calls: () => number; release: () => void } {
  let calls = 0
  let open: (() => void) | null = null
  return {
    fn: () => {
      calls++
      return new Promise<void>((resolve) => (open = resolve))
    },
    calls: () => calls,
    release: () => open?.()
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

test('triggers during a run queue exactly one more run', async () => {
  const g = gate()
  const trigger = coalesce(g.fn)
  for (let i = 0; i < 5; i++) trigger()
  expect(g.calls()).toBe(1)
  g.release()
  await settle()
  expect(g.calls()).toBe(2)
  g.release()
  await settle()
  expect(g.calls()).toBe(2)
})

test('a trigger after the runs end starts a new run', async () => {
  const g = gate()
  const trigger = coalesce(g.fn)
  trigger()
  g.release()
  await settle()
  trigger()
  expect(g.calls()).toBe(2)
})

test('a failed run does not block the next trigger', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  let calls = 0
  const trigger = coalesce(async () => {
    calls++
    throw new Error('read failed')
  })
  trigger()
  await settle()
  trigger()
  await settle()
  expect(calls).toBe(2)
  expect(error).toHaveBeenCalledTimes(2)
  error.mockRestore()
})

test('latestOnly drops a result that started before one already sent', async () => {
  const sent: string[] = []
  const done: Record<string, (v: string) => void> = {}
  const push = latestOnly(
    (id: string) => new Promise<string>((resolve) => (done[id] = resolve)),
    (v: string) => sent.push(v)
  )
  const a = push('a')
  const b = push('b')
  done.b('b')
  await b
  done.a('a')
  await a
  expect(sent).toEqual(['b'])
})
