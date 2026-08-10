import { useId } from 'react'
import { observeHome } from './home-observability'
import { MemberPresence, PreviewMosaic } from './PreviewMosaic'
import {
  accessibleActiveRoomDescription,
  type ActiveRoomSummary,
} from './home-types'
export function RoomSearchResult({ room }: Readonly<{ room: ActiveRoomSummary }>) {
  const accessibleDescriptionId = useId()
  return (
    <li className="room-search-result">
      <a
        aria-describedby={accessibleDescriptionId}
        aria-label={`Open ${room.name} room`}
        href={`/rooms/${encodeURIComponent(room.id)}`}
        onClick={() => observeHome({
          name: 'home_room_opened',
          properties: { collection: 'search_results' },
        })}
      >
        <span className="visually-hidden" id={accessibleDescriptionId}>
          {accessibleActiveRoomDescription(room)}
        </span>
        <PreviewMosaic room={room} />
        <div className="room-search-result__body">
          <div className="live-room-card__title-row">
            <h3>{room.name}</h3>
            <span className={`room-chip room-chip--${room.state}`}>
              {room.state === 'full' ? 'Full' : 'Live'}
            </span>
          </div>
          {room.description && (
            <p className="room-search-result__description">{room.description}</p>
          )}
          <div className="live-room-card__chips">
            <span className={`room-chip room-chip--${room.visibility}`}>
              {room.visibility === 'private' ? 'Private' : 'Public'}
            </span>
            {room.category && <span className="room-chip">{room.category}</span>}
            {room.tags.map((tag) => (
              <span className="room-chip" key={tag}>#{tag}</span>
            ))}
          </div>
          <p className="room-search-result__counts tabular-nums">
            {room.memberCount} {room.memberCount === 1 ? 'member' : 'members'} ·{' '}
            {room.streamCount} {room.streamCount === 1 ? 'stream' : 'streams'}
          </p>
          {room.previews.length > 0 && (
            <MemberPresence
              avatars={room.visibility === 'public' ? room.memberAvatars : []}
              capacity={room.capacity}
              memberCount={room.memberCount}
              privateRoom={room.visibility === 'private'}
              state={room.state}
            />
          )}
          <span aria-hidden="true" className="live-room-card__open-cue">
            Open room <span>→</span>
          </span>
        </div>
      </a>
    </li>
  )
}
