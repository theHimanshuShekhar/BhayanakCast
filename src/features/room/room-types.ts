import type { RoomBoundaryProjection } from '../../server/rooms/room-service'

export type RoomView = RoomBoundaryProjection
export type RoomPresent = Exclude<RoomView, { status: 'not-found' }>
export type RoomEnded = RoomPresent & { status: 'ended' }
export type RoomPreAdmission = RoomPresent & { status: 'pre-admission' }
export type RoomAdmitted = Extract<RoomView, { status: 'admitted' }>
export type RoomConsequence = 'transfer-host' | 'stop-stream'
