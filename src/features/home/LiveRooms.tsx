import { useState } from 'react'
import { EmptyDiscovery } from './EmptyDiscovery'
import { LiveRoomCard } from './LiveRoomCard'
import type { ActiveRoomSummary } from './home-types'

const EMPTY_ROOMS: readonly ActiveRoomSummary[] = []

export interface RoomPresentation {
  readonly rooms: readonly ActiveRoomSummary[]
  readonly featuredId: string | null
}

interface LiveRoomsProps {
  readonly rooms: readonly ActiveRoomSummary[]
  readonly snapshotKey: string
  readonly showEmptyInvitation: boolean
  readonly hasPastStreams: boolean
  readonly isPlaceholderData: boolean
}

interface RoomPresentationState {
  readonly snapshotKey: string | null
  readonly sourceRooms: readonly ActiveRoomSummary[]
  readonly presentation: RoomPresentation
}

export function createRoomPresentation(
  rooms: readonly ActiveRoomSummary[],
): RoomPresentation {
  return {
    rooms,
    featuredId: rooms[0]?.id ?? null,
  }
}

export function reconcileRoomPresentation(
  previous: RoomPresentation,
  incoming: readonly ActiveRoomSummary[],
): RoomPresentation {
  const incomingById = new Map(incoming.map((room) => [room.id, room]))
  const seen = new Set<string>()
  const rooms: ActiveRoomSummary[] = []

  for (const room of previous.rooms) {
    const updated = incomingById.get(room.id)
    if (!updated) continue
    seen.add(room.id)
    rooms.push(updated)
  }
  for (const room of incoming) {
    if (seen.has(room.id)) continue
    rooms.push(room)
  }

  return { rooms, featuredId: previous.featuredId }
}

export function transitionRoomPresentation(
  previous: RoomPresentation,
  incoming: readonly ActiveRoomSummary[],
  snapshotChanged: boolean,
  isPlaceholderData: boolean,
): RoomPresentation {
  if (isPlaceholderData) return previous
  return snapshotChanged
    ? createRoomPresentation(incoming)
    : reconcileRoomPresentation(previous, incoming)
}

export function LiveRooms({
  rooms,
  snapshotKey,
  showEmptyInvitation,
  hasPastStreams,
  isPlaceholderData,
}: LiveRoomsProps) {
  const [state, setState] = useState<RoomPresentationState>(() => {
    const initialRooms = isPlaceholderData ? EMPTY_ROOMS : rooms
    return {
      snapshotKey: isPlaceholderData ? null : snapshotKey,
      sourceRooms: initialRooms,
      presentation: createRoomPresentation(initialRooms),
    }
  })
  let presentation = state.presentation

  if (
    !isPlaceholderData &&
    (state.snapshotKey !== snapshotKey || state.sourceRooms !== rooms)
  ) {
    presentation = transitionRoomPresentation(
      state.presentation,
      rooms,
      state.snapshotKey !== snapshotKey,
      false,
    )
    setState({ snapshotKey, sourceRooms: rooms, presentation })
  }
  const hasFeature = presentation.rooms.some(
    ({ id }) => id === presentation.featuredId,
  )

  return (
    <section aria-labelledby="live-rooms-heading" className="live-rooms">
      <div className="home-section-heading">
        <h2 id="live-rooms-heading">Live Rooms</h2>
        {presentation.rooms.length > 0 && (
          <p className="tabular-nums">
            {presentation.rooms.length}{' '}
            {presentation.rooms.length === 1 ? 'room' : 'rooms'} live now
          </p>
        )}
      </div>
      {presentation.rooms.length > 0 ? (
        <ol
          className="live-rooms-grid"
          data-editorial={hasFeature && presentation.rooms.length >= 3}
          data-has-feature={hasFeature}
          data-room-count={presentation.rooms.length}
        >
          {presentation.rooms.map((room) => (
            <LiveRoomCard
              key={room.id}
              featured={room.id === presentation.featuredId}
              room={room}
            />
          ))}
        </ol>
      ) : showEmptyInvitation ? (
        <EmptyDiscovery hasPastStreams={hasPastStreams} />
      ) : (
        <p className="live-rooms__no-results">0 rooms available.</p>
      )}
    </section>
  )
}
