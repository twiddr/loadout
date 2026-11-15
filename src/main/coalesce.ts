/**
 * A trigger for `fn` that runs it at most once at a time: a trigger while it runs queues exactly
 * one more run, and further triggers add nothing. A failed run is logged and dropped.
 */
export function coalesce(fn: () => Promise<void>): () => void {
  let running = false
  let again = false
  const start = (): void => {
    running = true
    fn()
      .catch((error: unknown) => console.error(error))
      .finally(() => {
        running = false
        if (again) {
          again = false
          start()
        }
      })
  }
  return () => {
    if (running) again = true
    else start()
  }
}

/**
 * Wraps build-then-send so a result never lands after a newer one: a build that started before
 * the last sent result is dropped.
 */
export function latestOnly<A extends unknown[], T>(
  build: (...args: A) => Promise<T>,
  send: (value: T) => void
): (...args: A) => Promise<void> {
  let started = 0
  let sent = 0
  return async (...args) => {
    const mine = ++started
    const value = await build(...args)
    if (mine < sent) return
    sent = mine
    send(value)
  }
}
