import { observeHome } from './home-observability'
import type { PastStreamSummary } from './home-types'

interface PastStreamsProps {
  readonly streams: readonly PastStreamSummary[]
}

/** Visitor's own timezone, because the relative label above it is measured
    against the visitor's own clock. A UTC tooltip made "3 hours ago" resolve to
    a wall-clock time that was hours off from what their clock said. */
const endedAtFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
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
              onClick={() => observeHome({
                name: 'home_past_stream_opened',
                properties: {},
              })}
            >
              {stream.visibility === 'public' && stream.thumbnailCapturedAt && (
                <span aria-hidden="true" className="past-stream-item__media">
                  <img
                    alt=""
                    decoding="async"
                    loading="lazy"
                    src={`/api/past-stream-previews/${encodeURIComponent(stream.roomId)}?capturedAt=${encodeURIComponent(stream.thumbnailCapturedAt)}`}
                  />
                </span>
              )}
              {/* The badge sits inside the name block visually, but the name
                  probe stays a leaf so it reads back as just the room name. */}
              <span className="past-stream-item__name">
                <span data-past-stream-name>{stream.name}</span>
                {stream.visibility === 'private' && (
                  <span className="past-stream-item__private room-chip room-chip--private">
                    Private
                  </span>
                )}
              </span>

              {(stream.category || stream.tags.length > 0) && (
                <span className="past-stream-item__chips">
                  {stream.category && (
                    <span className="room-chip">{stream.category}</span>
                  )}
                  {stream.tags.map((tag) => (
                    <span className="room-chip" key={tag}>#{tag}</span>
                  ))}
                </span>
              )}

              <span className="past-stream-item__meta">
                <span className="past-stream-item__counts tabular-nums">
                  {stream.memberCount}{' '}
                  {stream.memberCount === 1 ? 'member' : 'members'} ·{' '}
                  {stream.streamCount}{' '}
                  {stream.streamCount === 1 ? 'screen' : 'screens'} ·{' '}
                  <time
                    className="past-stream-item__when"
                    dateTime={stream.endedAt}
                    title={`Ended ${endedAtFormatter.format(new Date(stream.endedAt))}`}
                  >
                    {endedLabel(stream.endedAt, now)}
                  </time>
                </span>
                {/* The whole block is the link; this only names where it
                    goes, so it stays out of the accessible name. */}
                <span aria-hidden="true" className="past-stream-item__open">
                  Open <span>→</span>
                </span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  )
}
