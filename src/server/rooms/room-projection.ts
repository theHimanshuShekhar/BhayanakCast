import { ROOM_LIFETIME_MS } from './end-room'
import { ROOM_CAPACITY, type RoomVisibility } from './room-policy'
import { orderRoomRoster, type RoomRosterMember } from './room-roster'

interface RoomProjectionRecord {
  readonly id: string
  readonly name: string
  readonly category: string | null
  readonly description: string | null
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
  /** Unordered; this projection sorts it. Loaded only for an admitted viewer —
      ADR 0003 hides participant identities until admission, so a caller with no
      current membership must pass an empty roster. */
  readonly roster: readonly RoomRosterMember[]
  /** The viewer's one active remote subscription (ADR 0101), or null. */
  readonly watchingStreamId: string | null
}

interface RoomRouteDetails {
  readonly id: string
  readonly name: string
  readonly category: string | null
  readonly description: string | null
  readonly tags: readonly string[]
  readonly visibility: RoomVisibility
  readonly memberCount: number
  readonly streamCount: number
  /** Carried on the projection so the client never has to know the server's
      capacity constant. */
  readonly capacity: number
}

export interface PreAdmissionRoom extends RoomRouteDetails {
  readonly admission: 'open' | 'password-required' | 'full'
  readonly viewerAuthenticated: boolean
  readonly expiresAt: Date
}

export interface AdmittedRoom extends RoomRouteDetails {
  readonly expiresAt: Date
  /** The viewer's single active watch. ADR 0101 permits exactly one. */
  readonly watchingStreamId: string | null
  /** Ordered per ADR 0101. Present on the admitted projection only; the
      pre-admission and Past Stream projections deliberately have no roster. */
  readonly roster: readonly RoomRosterMember[]
}

export interface PastStreamRoom extends RoomRouteDetails {
  readonly endedAt: Date
  /** The account's realtime connection is account-scoped, not room-scoped, so
      the route needs to know a signed-in viewer is still signed in here — an
      ended room must not tear down the connection their other memberships and
      Home presence depend on. */
  readonly viewerAuthenticated: boolean
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
  // Drop the roster explicitly rather than spreading the admitted room: a
  // displaced member is outside the room again, and ADR 0003 keeps identities
  // on the admitted side of that line.
  const {
    roster: _roster,
    watchingStreamId: _watchingStreamId,
    expiresAt,
    ...details
  } = projection.room
  return {
    kind: 'preAdmission',
    room: {
      ...details,
      expiresAt,
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
    description: room.description,
    tags: room.tags,
    visibility: room.visibility,
    memberCount: snapshot.memberCount,
    streamCount: snapshot.streamCount,
    capacity: ROOM_CAPACITY,
  }
  if (room.endedAt) {
    return {
      kind: 'pastStream',
      room: {
        ...details,
        endedAt: room.endedAt,
        viewerAuthenticated: snapshot.viewerAuthenticated,
      },
    }
  }
  const expiresAt = new Date(room.createdAt.getTime() + ROOM_LIFETIME_MS)
  if (snapshot.self) {
    return {
      kind: 'admitted',
      room: {
        ...details,
        expiresAt,
        roster: orderRoomRoster(snapshot.roster, snapshot.self.id),
        watchingStreamId: snapshot.watchingStreamId,
      },
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
  return room.memberCount >= ROOM_CAPACITY
    ? 'full' as const
    : room.visibility === 'private'
      ? 'password-required' as const
      : 'open' as const
}
