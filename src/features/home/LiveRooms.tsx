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
  readonly canJoin: boolean
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
  canJoin,
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
  const featured =
    presentation.rooms.find(({ id }) => id === presentation.featuredId) ?? null
  const rest = featured
    ? presentation.rooms.filter((room) => room.id !== featured.id)
    : presentation.rooms

  if (presentation.rooms.length === 0) {
    return (
      <section aria-label="Live Rooms" className="live-rooms">
        {showEmptyInvitation ? (
          <EmptyDiscovery
            canCreate={canJoin}
            hasPastStreams={hasPastStreams}
          />
        ) : (
          <p className="live-rooms__no-results">0 rooms available.</p>
        )}
      </section>
    )
  }

  return (
    <section aria-label="Live Rooms" className="live-rooms">
      {featured && (
        <div className="live-rooms__feature">
          <div className="home-section-heading">
            <h2>Busiest room</h2>
            <p>The room with the most people in it right now. Reload to re-rank.</p>
          </div>
          <ol
            className="live-rooms-grid live-rooms-grid--feature"
            data-has-feature="true"
          >
            <LiveRoomCard canJoin={canJoin} featured room={featured} />
          </ol>
        </div>
      )}

      {rest.length > 0 && (
        <div className="live-rooms__rest">
          <div className="home-section-heading">
            <h2>Also live</h2>
            <p className="tabular-nums">
              {rest.length} {rest.length === 1 ? 'room' : 'rooms'}
            </p>
          </div>
          <ol className="live-rooms-grid" data-room-count={rest.length}>
            {rest.map((room) => (
              <LiveRoomCard
                key={room.id}
                canJoin={canJoin}
                featured={false}
                room={room}
              />
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
