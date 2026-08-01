import { useState } from 'react'
import type { AdminLiveRoom } from '../../server/rooms/room-service'
import { endAdminRoom } from './admin-room-actions'

export function RoomTerminationPanel({
  rooms: initialRooms,
}: Readonly<{ rooms: readonly AdminLiveRoom[] }>) {
  const [rooms, setRooms] = useState(initialRooms)
  const [confirmingRoomId, setConfirmingRoomId] = useState<string | null>(null)
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function endRoom(roomId: string) {
    setBusyRoomId(roomId)
    setError(null)
    setMessage(null)
    try {
      const result = await endAdminRoom({ data: roomId })
      if (result.status === 'ended' || result.status === 'already-ended') {
        setRooms((current) => current.filter((room) => room.id !== roomId))
        setConfirmingRoomId(null)
        setMessage('The room ended and its stable URL now shows the Past Stream summary.')
      } else if (result.status === 'not-found') {
        setRooms((current) => current.filter((room) => room.id !== roomId))
        setConfirmingRoomId(null)
        setError('That room is no longer available. The live-room list has been updated.')
      } else {
        setError('The room could not be ended. Refresh the workspace and try again.')
      }
    } catch {
      setError('The room could not be ended. Refresh the workspace and try again.')
    } finally {
      setBusyRoomId(null)
    }
  }

  return (
    <section aria-labelledby="room-termination-heading" className="admin-panel admin-room-termination">
      <header className="admin-panel__heading">
        <div>
          <p className="admin-eyebrow">Live intervention</p>
          <h2 id="room-termination-heading">Room termination</h2>
        </div>
        <span aria-label={`${rooms.length} live rooms`} className="admin-count">
          {rooms.length} live
        </span>
      </header>
      <p className="admin-privacy-note">
        Ending a Room is immediate. Members receive ordinary room-ended messaging; enforcement detail stays private.
      </p>

      {rooms.length === 0 ? (
        <p className="admin-empty" role="status">No live Rooms need intervention.</p>
      ) : (
        <ol className="admin-room-list">
          {rooms.map((room) => {
            const confirming = confirmingRoomId === room.id
            const busy = busyRoomId === room.id
            return (
              <li className="admin-room-item" key={room.id}>
                <div className="admin-room-item__summary">
                  <strong>{room.name}</strong>
                  <span>
                    {room.visibility === 'private' ? 'Private' : 'Public'} · {room.memberCount}{' '}
                    {room.memberCount === 1 ? 'member' : 'members'} · {room.streamCount}{' '}
                    {room.streamCount === 1 ? 'Stream' : 'Streams'}
                  </span>
                </div>
                {confirming ? (
                  <div aria-label={`Confirm ending ${room.name}`} className="admin-room-confirmation" role="group">
                    <p>
                      End now? Every Stream, watch, and membership closes immediately. There is no reconnect or empty-room grace.
                    </p>
                    <div className="admin-room-actions">
                      <button
                        className="admin-danger-action"
                        disabled={busy}
                        onClick={() => void endRoom(room.id)}
                        type="button"
                      >
                        {busy ? 'Ending…' : 'Confirm end Room'}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => setConfirmingRoomId(null)}
                        type="button"
                      >
                        Keep live
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="admin-danger-action"
                    onClick={() => {
                      setConfirmingRoomId(room.id)
                      setError(null)
                      setMessage(null)
                    }}
                    type="button"
                  >
                    End Room
                  </button>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {message ? <p className="admin-room-feedback" role="status">{message}</p> : null}
      {error ? <p className="admin-room-feedback admin-room-feedback--error" role="alert">{error}</p> : null}
    </section>
  )
}
