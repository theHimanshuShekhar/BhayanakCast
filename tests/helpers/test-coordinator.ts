import Redis from 'ioredis'

export interface PublishedWorker {
  workerId: string
  schema: string
  valkeyPrefix: string
  port: number
}

export async function createTestCoordinator() {
  const valkeyUrl = process.env.TEST_VALKEY_URL ?? process.env.VALKEY_URL
  if (!valkeyUrl) {
    throw new Error('TEST_VALKEY_URL or VALKEY_URL is required')
  }
  const runId = process.env.TEST_RUN_ID ?? String(process.ppid)
  const key = `bhayanakcast:test-coordination:${runId}:workers`
  const valkey = new Redis(valkeyUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })
  await valkey.connect()
  let closePromise: Promise<void> | undefined

  const close = () => {
    closePromise ??= valkey.quit().then(() => undefined)
    return closePromise
  }
  return {
    async publish(worker: PublishedWorker) {
      const results = await valkey
        .multi()
        .rpush(key, JSON.stringify(worker))
        .expire(key, 30)
        .exec()
      const error = results?.find(([entryError]) => entryError)?.[0]
      if (error) throw error
    },
    async receive(): Promise<PublishedWorker> {
      // Redis owns this cross-process wait; the application clock cannot bound it.
      const result = await valkey.blpop(key, 10)
      if (!result) throw new Error('worker coordination timed out')
      return JSON.parse(result[1]) as PublishedWorker
    },
    async cleanup() {
      const results = await Promise.allSettled([valkey.del(key), close()])
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      )
      if (errors.length > 0) {
        throw new AggregateError(errors, 'Worker coordination cleanup failed')
      }
    },
    close,
  }
}
