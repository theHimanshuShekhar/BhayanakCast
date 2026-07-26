import type {
  AdmittedRoom,
  PastStreamRoom,
  PreAdmissionRoom,
  RoomRouteProjection,
  SelfMembership,
} from '../../server/rooms/room-projection'

export type RoomView = RoomRouteProjection
export type RoomPreAdmission = PreAdmissionRoom
export type RoomAdmitted = AdmittedRoom
export type RoomEnded = PastStreamRoom
export type RoomSelfMembership = SelfMembership
export type RoomConsequence = 'transfer-host' | 'stop-stream'
