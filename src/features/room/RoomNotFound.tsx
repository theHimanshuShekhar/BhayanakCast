import { RoomShell } from './RoomShell'

export function RoomNotFound() {
  return (
    <RoomShell state="not-found">
      <main className="room-boundary room-boundary--not-found">
        <header className="room-header">
          <div className="room-header__identity">
            <p className="room-header__eyebrow room-header__eyebrow--neutral">Room</p>
            <h1>Room not found</h1>
          </div>
        </header>
        <div className="room-stage">
          <div className="room-spotlight" data-spotlight="ended">
            <p className="room-spotlight__state">This room is unavailable.</p>
          </div>
          <div className="room-controls">
            <a className="room-boundary__back" href="/">Back to Home</a>
          </div>
        </div>
      </main>
    </RoomShell>
  )
}
