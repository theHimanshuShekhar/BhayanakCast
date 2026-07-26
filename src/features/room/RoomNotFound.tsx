export function RoomNotFound() {
  return (
    <main className="room-boundary room-boundary--not-found">
      <p className="room-boundary__eyebrow">Room</p>
      <h1>Room not found</h1>
      <p>This room is unavailable.</p>
      <a className="room-boundary__back" href="/">Back to Home</a>
    </main>
  )
}
