import type { RoomEnded } from './room-types'

export function PastStreamSummary({ room }: Readonly<{ room: RoomEnded }>) {
  return (
    <main className="room-boundary room-boundary--ended" data-room-state="ended">
      <p className="room-boundary__eyebrow">Past Stream</p>
      <h1 data-room-primary-heading="" tabIndex={-1}>{room.name}</h1>
      <p>This room has ended and is no longer accepting members.</p>
      <dl className="room-boundary__facts">
        <div><dt>Members</dt><dd>{room.memberCount}</dd></div>
        <div><dt>Streams</dt><dd>{room.streamCount}</dd></div>
      </dl>
      <a className="room-boundary__back" href="/">Back to Home</a>
    </main>
  )
}
