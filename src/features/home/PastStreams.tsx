import type { PastStreamSummary } from './home-types'

interface PastStreamsProps {
  readonly streams: readonly PastStreamSummary[]
}

const endedAtFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** Whole days back, floored, so "2 days ago" never drifts to "1 day ago" for
    two rows that ended minutes apart. */
function endedLabel(endedAt: string, now: number) {
  const days = Math.floor((now - new Date(endedAt).getTime()) / 86_400_000)
  if (days >= 1) return relativeFormatter.format(-days, 'day')
  const hours = Math.floor((now - new Date(endedAt).getTime()) / 3_600_000)
  return hours >= 1 ? relativeFormatter.format(-hours, 'hour') : 'just now'
}

export function PastStreams({ streams }: PastStreamsProps) {
  if (streams.length === 0) return null
  const now = Date.now()

  return (
    <section aria-label="Past Streams" className="past-streams">
      <div className="home-section-heading">
        <h2>Wrapped up</h2>
        <p>last ten rooms</p>
      </div>
      <ol className="past-streams-list">
        {streams.map((stream) => (
          <li className="past-stream-item" key={stream.roomId}>
            <a
              aria-label={`Open summary for ${stream.name}`}
              href={`/rooms/${encodeURIComponent(stream.roomId)}`}
            >
              {/* The badge sits inside the name block visually, but the name
                  probe stays a leaf so it reads back as just the room name. */}
              <span className="past-stream-item__name">
                <span data-past-stream-name>{stream.name}</span>
                {stream.visibility === 'private' && (
                  <span className="past-stream-item__private">Private</span>
                )}
              </span>
              <span className="past-stream-item__counts tabular-nums">
                {stream.memberCount}{' '}
                {stream.memberCount === 1 ? 'member' : 'members'} ·{' '}
                {stream.streamCount}{' '}
                {stream.streamCount === 1 ? 'screen' : 'screens'}
              </span>
              <time
                className="past-stream-item__when"
                dateTime={stream.endedAt}
                title={`Ended ${endedAtFormatter.format(new Date(stream.endedAt))} UTC`}
              >
                {endedLabel(stream.endedAt, now)}
              </time>
            </a>
          </li>
        ))}
      </ol>
    </section>
  )
}
