import { MemberPresence, PreviewMosaic } from './PreviewMosaic'
import type { ActiveRoomSummary } from './home-types'

export function RoomSearchResult({ room }: Readonly<{ room: ActiveRoomSummary }>) {
  return (
    <li className="room-search-result">
      <a
        aria-label={`Open ${room.name} room`}
        href={`/rooms/${encodeURIComponent(room.id)}`}
      >
        <PreviewMosaic room={room} />
        <div className="room-search-result__body">
          <div className="live-room-card__title-row">
            <h3>{room.name}</h3>
            <span className={`room-chip room-chip--${room.state}`}>
              {room.state === 'full' ? 'Full' : 'Live'}
            </span>
          </div>
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
              memberCount={room.memberCount}
              privateRoom={room.visibility === 'private'}
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
