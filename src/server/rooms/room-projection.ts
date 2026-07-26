import { ROOM_LIFETIME_MS } from './end-room'
import type { RoomVisibility } from './room-policy'

interface RoomProjectionRecord {
  readonly id: string
  readonly name: string
  readonly category: string | null
  readonly tags: readonly string[]
  readonly visibility: RoomVisibility
  readonly createdAt: Date
  readonly endedAt: Date | null
}

export interface SelfMembership {
  readonly id: string
  readonly role: 'host' | 'member'
}

export interface RoomProjectionSnapshot {
  readonly room: RoomProjectionRecord | null
  readonly memberCount: number
  readonly streamCount: number
  readonly self: SelfMembership | null
  readonly viewerAuthenticated: boolean
}

interface RoomRouteDetails {
  readonly id: string
  readonly name: string
  readonly category: string | null
  readonly tags: readonly string[]
  readonly visibility: RoomVisibility
  readonly memberCount: number
  readonly streamCount: number
}

export interface PreAdmissionRoom extends RoomRouteDetails {
  readonly admission: 'open' | 'password-required' | 'full'
  readonly viewerAuthenticated: boolean
  readonly expiresAt: Date
}

export interface AdmittedRoom extends RoomRouteDetails {
  readonly expiresAt: Date
}

export interface PastStreamRoom extends RoomRouteDetails {
  readonly endedAt: Date
}

export type RoomRouteProjection =
  | { readonly kind: 'preAdmission'; readonly room: PreAdmissionRoom }
  | {
      readonly kind: 'admitted'
      readonly room: AdmittedRoom
      readonly self: SelfMembership
    }
  | { readonly kind: 'pastStream'; readonly room: PastStreamRoom }

type AdmittedRoomProjection = Extract<RoomRouteProjection, { readonly kind: 'admitted' }>
type PreAdmissionRoomProjection = Extract<RoomRouteProjection, { readonly kind: 'preAdmission' }>

export function projectDisplacedRoom(
  projection: AdmittedRoomProjection,
): PreAdmissionRoomProjection {
  return {
    kind: 'preAdmission',
    room: {
      ...projection.room,
      admission: admissionFor(projection.room),
      viewerAuthenticated: true,
    },
  }
}

export function selectRoomRouteProjection(
  snapshot: RoomProjectionSnapshot,
): RoomRouteProjection | null {
  const { room } = snapshot
  if (!room) return null
  const details: RoomRouteDetails = {
    id: room.id,
    name: room.name,
    category: room.category,
    tags: room.tags,
    visibility: room.visibility,
    memberCount: snapshot.memberCount,
    streamCount: snapshot.streamCount,
  }
  if (room.endedAt) {
    return { kind: 'pastStream', room: { ...details, endedAt: room.endedAt } }
  }
  const expiresAt = new Date(room.createdAt.getTime() + ROOM_LIFETIME_MS)
  if (snapshot.self) {
    return {
      kind: 'admitted',
      room: { ...details, expiresAt },
      self: snapshot.self,
    }
  }
  const admission = admissionFor(details)
  return {
    kind: 'preAdmission',
    room: {
      ...details,
      admission,
      viewerAuthenticated: snapshot.viewerAuthenticated,
      expiresAt,
    },
  }
}

function admissionFor(room: Pick<RoomRouteDetails, 'memberCount' | 'visibility'>) {
  return room.memberCount >= 10
    ? 'full' as const
    : room.visibility === 'private'
      ? 'password-required' as const
      : 'open' as const
}
