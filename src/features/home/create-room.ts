import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getProductionAuth, readSessionProjection } from '../../server/auth/auth'
import {
  RoomInputError,
  normalizeRoomInput,
  type NormalizedRoomInput,
  type RoomInput,
} from '../../server/rooms/room-policy'
import type {
  ConfirmationCommand,
  CreateRoomResult,
  MembershipConfirmation,
  RoomService,
} from '../../server/rooms/room-service'

const ROOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONSEQUENCES = new Set(['transfer-host', 'stop-stream'])

type RoomRuntime = { service?: RoomService }
const globalRoom = globalThis as typeof globalThis & { __bhayanakCastRoom?: RoomRuntime }
const roomState = (globalRoom.__bhayanakCastRoom ??= {})

export function bindRoomService(service: RoomService) {
  roomState.service = service
}

export function getProductionRoomService() {
  if (!roomState.service) throw new Error('Room lifecycle service is not configured')
  return roomState.service
}

export function validateCreateRoomInput(value: unknown): NormalizedRoomInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RoomInputError('ROOM_NAME_LENGTH')
  }
  const source = value as Record<string, unknown>
  const name = source.name
  const category = source.category
  const tags = source.tags
  const visibility = source.visibility
  const password = source.password
  if (typeof name !== 'string') throw new RoomInputError('ROOM_NAME_LENGTH')
  if (category !== undefined && category !== null && typeof category !== 'string') {
    throw new RoomInputError('ROOM_CATEGORY_LENGTH')
  }
  if (tags !== undefined && tags !== null && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string'))) {
    throw new RoomInputError('ROOM_TAG_LENGTH')
  }
  if (visibility !== undefined && visibility !== 'public' && visibility !== 'private') {
    throw new RoomInputError('ROOM_NAME_LENGTH')
  }
  if (password !== undefined && password !== null && typeof password !== 'string') {
    throw new RoomInputError('ROOM_PASSWORD_LENGTH')
  }
  return normalizeRoomInput({
    name,
    category: category as string | null | undefined,
    tags: tags as string[] | null | undefined,
    visibility: visibility as RoomInput['visibility'],
    password: password as string | null | undefined,
  })
}

export const createRoom = createServerFn({ method: 'POST' })
  .validator(validateCreateRoomCommand)
  .handler(async ({ data }): Promise<CreateRoomResult> => {
    const session = await currentSession()
    if (!session) return { status: 'unauthenticated' }
    const result = await getProductionRoomService().createRoom(session.id, data.input, {
      confirmation: data.confirmation,
    })
    return result
  })

function validateCreateRoomCommand(value: unknown): {
  input: NormalizedRoomInput
  confirmation?: MembershipConfirmation
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid room command')
  }
  const source = value as Record<string, unknown>
  return {
    input: validateCreateRoomInput(source.input),
    confirmation: validateConfirmation(source.confirmation),
  }
}

export function validateRoomId(value: unknown): string {
  if (typeof value !== 'string' || !ROOM_ID.test(value)) throw new TypeError('Invalid room id')
  return value.toLowerCase()
}

export function validateConfirmation(value: unknown): MembershipConfirmation | undefined {
  if (value === undefined || value === null) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid confirmation')
  }
  const source = value as Record<string, unknown>
  const token = source.token
  const issuedAt = source.issuedAt
  const command = source.command
  const target = source.target
  const sourceMembershipId = source.sourceMembershipId
  const consequences = source.consequences
  const validCommand = command === 'create' || command === 'admit' || command === 'leave'
  const validTarget =
    typeof target === 'string' &&
    (command === 'create' ? /^[0-9a-f]{64}$/i.test(target) : ROOM_ID.test(target))
  if (
    typeof token !== 'string' || token.length < 16 || token.length > 200 ||
    !validCommand || !validTarget ||
    typeof sourceMembershipId !== 'string' || !ROOM_ID.test(sourceMembershipId) ||
    !Array.isArray(consequences) || consequences.some((item) => typeof item !== 'string' || !CONSEQUENCES.has(item)) ||
    (typeof issuedAt !== 'string' && !(issuedAt instanceof Date))
  ) {
    throw new TypeError('Invalid confirmation')
  }
  const date = issuedAt instanceof Date ? issuedAt : new Date(issuedAt)
  if (Number.isNaN(date.getTime())) throw new TypeError('Invalid confirmation')
  return {
    token,
    issuedAt: date,
    command: command as ConfirmationCommand,
    target,
    sourceMembershipId,
    consequences: consequences as MembershipConfirmation['consequences'],
  }
}

async function currentSession() {
  return readSessionProjection(getProductionAuth(), getRequest().headers)
}


export function roomRuntimeForTests() {
  return roomState.service
}

export { ROOM_ID }
