import { RoomFact, RoomHeader, RoomShell } from './RoomShell'
import { observeRoom } from './room-observability'
import type { RoomEnded } from './room-types'
import type { SessionProjection } from '../auth/auth-client'

const ENDED_FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

export function PastStreamSummary({
  room,
  session,
}: Readonly<{ room: RoomEnded; session: SessionProjection | null }>) {
  return (
    <RoomShell session={session} state="ended">
      <main className="room-boundary room-boundary--ended" data-room-state="ended">
        <RoomHeader
          category={room.category}
          description={room.description}
          eyebrow="Past Stream"
          facts={
            <>
              <RoomFact>{room.visibility === 'private' ? 'Private' : 'Public'}</RoomFact>
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
              <time dateTime={room.endedAt.toISOString()}>
                Ended {ENDED_FORMATTER.format(room.endedAt)} UTC.
              </time>{' '}
              No replay or public transcript is available.
            </p>
          </div>

          <div className="room-controls">
            <a
              className="room-boundary__back"
              href="/"
              onClick={() => {
                observeRoom({
                  name: 'room_route_action',
                  properties: {
                    state: 'past_stream',
                    action: 'back_home',
                    outcome: 'navigated',
                  },
                })
              }}
            >
              Back to Home
            </a>
          </div>
        </div>
      </main>
    </RoomShell>
  )
}
