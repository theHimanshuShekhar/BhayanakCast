import { RoomFact, RoomHeader, RoomShell } from './RoomShell'
import type { RoomEnded } from './room-types'

const ENDED_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

export function PastStreamSummary({ room }: Readonly<{ room: RoomEnded }>) {
  return (
    <RoomShell state="ended">
      <main className="room-boundary room-boundary--ended" data-room-state="ended">
        <RoomHeader
          category={room.category}
          description={room.description}
          eyebrow="Past Stream"
          facts={
            <>
              <RoomFact>
                {room.memberCount}{' '}
                {room.memberCount === 1 ? 'member' : 'members'}
              </RoomFact>
              <RoomFact>
                {room.streamCount}{' '}
                {room.streamCount === 1 ? 'screen shared' : 'screens shared'}
              </RoomFact>
            </>
          }
          name={room.name}
          tags={room.tags}
        />

        <div className="room-stage">
          <div className="room-spotlight" data-spotlight="ended">
            <p className="room-spotlight__state">This room has ended.</p>
            <p className="room-spotlight__note">
              It is no longer accepting members.{' '}
              <time dateTime={room.endedAt.toISOString()}>
                Ended {ENDED_FORMATTER.format(room.endedAt)} UTC
              </time>
              .
            </p>
          </div>

          <div className="room-controls">
            <a className="room-boundary__back" href="/">Back to Home</a>
          </div>
        </div>
      </main>
    </RoomShell>
  )
}
