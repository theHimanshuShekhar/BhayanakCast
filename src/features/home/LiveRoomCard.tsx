import { MemberPresence, PreviewMosaic } from './PreviewMosaic'
import type { ActiveRoomSummary } from './home-types'

interface LiveRoomCardProps {
  readonly room: ActiveRoomSummary
  readonly featured: boolean
  /** Anonymous visitors can browse every room but cannot enter one, so the
      card's action states the gate instead of promising an open door. */
  readonly canJoin: boolean
}

export function LiveRoomCard({ room, featured, canJoin }: LiveRoomCardProps) {
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
          <h3 data-room-name>{room.name}</h3>

          <p className="live-room-card__host">
            <HostIcon known={Boolean(room.hostName)} />
            {room.hostName ?? 'Host hidden'}
          </p>

          <div className="live-room-card__chips">
            <span
              className={`room-chip room-chip--${room.visibility}`}
              data-room-visibility={room.visibility}
            >
              {room.visibility === 'private' ? 'Private' : 'Public'}
            </span>
            {room.state === 'full' && (
              <span className="room-chip room-chip--full" data-room-state="full">
                Full
              </span>
            )}
            {room.category && <span className="room-chip">{room.category}</span>}
            {room.tags.map((tag) => (
              <span className="room-chip" key={tag}>#{tag}</span>
            ))}
          </div>

          {/* The chips carry the same two facts, but only as labels. The
              sentence says what they mean for someone deciding to knock. */}
          {room.state === 'full' && (
            <p className="live-room-card__note">
              Room is full — the conversation is still going.
            </p>
          )}
          {room.visibility === 'private' && (
            <p className="live-room-card__note">
              Anyone can see it — joining needs the password.
            </p>
          )}

          <div className="live-room-card__footer">
            {room.visibility === 'public' ? (
              <MemberPresence
                avatars={room.memberAvatars}
                capacity={room.capacity}
                memberCount={room.memberCount}
                privateRoom={false}
                state={room.state}
              />
            ) : (
              <span className="live-room-card__seats tabular-nums">
                {room.memberCount} of {room.capacity} · members hidden
              </span>
            )}
            <span aria-hidden="true" className="live-room-card__open-cue">
              {canJoin ? 'Open room' : 'Sign in to join'} <span>→</span>
            </span>
          </div>
        </div>
      </a>
    </li>
  )
}

function HostIcon({ known }: Readonly<{ known: boolean }>) {
  return (
    <svg
      aria-hidden="true"
      className={`host-icon${known ? '' : ' host-icon--unknown'}`}
      viewBox="0 0 24 24"
    >
      <path d="m3 7 4.5 3.5L12 5l4.5 5.5L21 7l-1.8 10.5H4.8Z" />
    </svg>
  )
}
