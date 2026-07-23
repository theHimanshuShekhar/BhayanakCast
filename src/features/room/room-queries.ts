import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import {
  getProductionAuth,
  readSessionProjection,
} from '../../server/auth/auth'
import {
  getProductionRoomService,
  validateConfirmation,
  validateRoomId,
  ROOM_ID,
} from '../home/create-room'
import type {
  AdmitResult,
  LeaveResult,
  MembershipConfirmation,
  RoomBoundaryProjection,
} from '../../server/rooms/room-service'

export type RoomProjectionResult = RoomBoundaryProjection

export const roomQueryKeys = {
  projection: (roomId: string) => ['room', 'projection', roomId] as const,
}

export function roomProjectionQueryOptions(roomId: string) {
  const canonicalRoomId = validateRoomId(roomId)
  return queryOptions({
    queryKey: roomQueryKeys.projection(canonicalRoomId),
    queryFn: () => getRoomProjection({ data: canonicalRoomId }),
    staleTime: 5_000,
  })
}

export const getRoomProjection = createServerFn({ method: 'GET' })
  .validator(validateRoomId)
  .handler(async ({ data }): Promise<RoomBoundaryProjection> => {
    const session = await currentSession()
    return getProductionRoomService().inspectBoundary(data, session?.id ?? null)
  })

export const admitRoom = createServerFn({ method: 'POST' })
  .validator(validateAdmissionCommand)
  .handler(async ({ data }): Promise<AdmitResult> => {
    const session = await currentSession()
    return getProductionRoomService().admit(session?.id ?? null, data.roomId, {
      password: data.password,
      confirmation: data.confirmation,
      clientIp: getRequest().headers.get('x-bhayanakcast-client-ip') ?? undefined,
    })
  })

export const leaveRoom = createServerFn({ method: 'POST' })
  .validator(validateLeaveCommand)
  .handler(async ({ data }): Promise<LeaveResult> => {
    const session = await currentSession()
    if (!session) return { status: 'not-member' }
    return getProductionRoomService().leave(session.id, {
      roomId: data.roomId,
      membershipId: data.membershipId,
      confirmation: data.confirmation,
    })
  })

function validateAdmissionCommand(value: unknown): {
  roomId: string
  password?: string
  confirmation?: MembershipConfirmation
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid admission command')
  }
  const source = value as Record<string, unknown>
  const password = source.password
  if (password !== undefined && password !== null && typeof password !== 'string') {
    throw new TypeError('Invalid password')
  }
  if (typeof password === 'string' && password.length > 512) throw new TypeError('Invalid password')
  return {
    roomId: validateRoomId(source.roomId),
    password: password as string | undefined,
    confirmation: validateConfirmation(source.confirmation),
  }
}

function validateLeaveCommand(value: unknown): {
  roomId: string
  membershipId: string
  confirmation?: MembershipConfirmation
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid leave command')
  }
  const source = value as Record<string, unknown>
  if (typeof source.membershipId !== 'string' || !ROOM_ID.test(source.membershipId)) {
    throw new TypeError('Invalid membership id')
  }
  return {
    roomId: validateRoomId(source.roomId),
    membershipId: source.membershipId,
    confirmation: validateConfirmation(source.confirmation),
  }
}

async function currentSession() {
  return readSessionProjection(getProductionAuth(), getRequest().headers)
}
