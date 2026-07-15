import type Redis from 'ioredis'

export type FixedWindowDecision =
  | { readonly kind: 'allowed'; readonly remaining: number }
  | { readonly kind: 'limited'; readonly retryAfterSeconds: number }
  | { readonly kind: 'unavailable' }

const CONSUME_FIXED_WINDOW = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return { count, ttl > 0 and ttl or 1 }
`

export async function consumeFixedWindow(
  redis: Redis,
  prefix: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<FixedWindowDecision> {
  try {
    const response = await redis.eval(
      CONSUME_FIXED_WINDOW,
      1,
      `${prefix}${key}`,
      windowSeconds,
    )
    if (!Array.isArray(response)) return { kind: 'unavailable' }

    const count = Number(response[0])
    const retryAfterSeconds = Number(response[1])
    if (
      !Number.isSafeInteger(count) ||
      !Number.isSafeInteger(retryAfterSeconds) ||
      retryAfterSeconds < 1
    ) {
      return { kind: 'unavailable' }
    }
    if (count <= limit) {
      return { kind: 'allowed', remaining: limit - count }
    }
    return { kind: 'limited', retryAfterSeconds }
  } catch {
    return { kind: 'unavailable' }
  }
}
