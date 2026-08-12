import { expect, test, vi } from 'vitest'
import { installControlledDate } from '../helpers/test-account'
import { createOriginalResourcesCloser } from '../helpers/test-environment'

test('overlapping controlled Dates fully restore the native Date', () => {
  const nativeDate = globalThis.Date

  try {
    const firstClock = installControlledDate(1_000)
    const secondClock = installControlledDate(2_000)

    firstClock.restore()
    secondClock.restore()

    expect(globalThis.Date).toBe(nativeDate)
  } finally {
    globalThis.Date = nativeDate
  }
})

test('a failed original resource close remains retryable', async () => {
  const closeResources = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error('first close failed'))
    .mockResolvedValue(undefined)
  const closeOriginalResources = createOriginalResourcesCloser(closeResources)

  await expect(closeOriginalResources()).rejects.toThrow('first close failed')
  await expect(closeOriginalResources()).resolves.toBeUndefined()
  expect(closeResources).toHaveBeenCalledTimes(2)
})

test('successful original resource closes are not repeated when another close is retried', async () => {
  const closePool = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const closeRedis = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error('redis close failed'))
    .mockResolvedValue(undefined)
  const closeOriginalResources = createOriginalResourcesCloser(
    closePool,
    closeRedis,
  )

  await expect(closeOriginalResources()).rejects.toThrow('redis close failed')
  await expect(closeOriginalResources()).resolves.toBeUndefined()
  expect(closePool).toHaveBeenCalledTimes(1)
  expect(closeRedis).toHaveBeenCalledTimes(2)
})
