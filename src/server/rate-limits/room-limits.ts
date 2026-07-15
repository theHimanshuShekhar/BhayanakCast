import { createHash } from 'node:crypto'
import type Redis from 'ioredis'
import {
  consumeFixedWindow,
  type FixedWindowDecision,
} from './fixed-window'

export interface PrivatePasswordLimitInput {
  readonly accountId: string
  readonly roomId: string
  readonly clientIp: string
}

export function consumeRoomCreationLimit(
  redis: Redis,
  prefix: string,
  accountId: string,
): Promise<FixedWindowDecision> {
  return consumeFixedWindow(redis, prefix, `room-creation:${accountId}`, 5, 60 * 60)
}

export function consumePrivatePasswordLimit(
  redis: Redis,
  prefix: string,
  input: PrivatePasswordLimitInput,
): Promise<FixedWindowDecision> {
  const clientIpHash = createHash('sha256')
    .update(input.clientIp)
    .digest('hex')
  return consumeFixedWindow(
    redis,
    prefix,
    `private-password:${input.accountId}:${input.roomId}:${clientIpHash}`,
    10,
    10 * 60,
  )
}
