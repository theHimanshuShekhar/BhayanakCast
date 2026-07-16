import { MemberPresence, PreviewMosaic } from './PreviewMosaic'
import type { ActiveRoomSummary } from './home-types'

interface LiveRoomCardProps {
  readonly room: ActiveRoomSummary
  readonly featured: boolean
}

export function LiveRoomCard({ room, featured }: LiveRoomCardProps) {
  return (
    <li
      className={`live-room-card${featured ? ' live-room-card--featured' : ''}`}
      data-featured={featured}
      data-room-id={room.id}
    >
      <a
        aria-label={`Open ${room.name} room`}
        href={`/rooms/${encodeURIComponent(room.id)}`}
      >
        <PreviewMosaic room={room} />
        <div className="live-room-card__body">
          <div className="live-room-card__title-row">
            <h3 data-room-name>{room.name}</h3>
            <span
              className={`room-chip room-chip--${room.state}`}
              data-room-state={room.state}
            >
              {room.state === 'full' ? 'Full' : 'Live'}
            </span>
          </div>

          <div className="live-room-card__chips">
            <span
              className={`room-chip room-chip--${room.visibility}`}
              data-room-visibility={room.visibility}
            >
              {room.visibility === 'private' ? 'Private' : 'Public'}
            </span>
            {room.category && <span className="room-chip">{room.category}</span>}
            {room.tags.map((tag) => (
              <span className="room-chip" key={tag}>#{tag}</span>
            ))}
          </div>

          <dl className="live-room-card__metadata">
            <div>
              <dt>Members</dt>
              <dd className="tabular-nums">{room.memberCount}</dd>
            </div>
            <div>
              <dt>Streams</dt>
              <dd className="tabular-nums">{room.streamCount}</dd>
            </div>
          </dl>

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

