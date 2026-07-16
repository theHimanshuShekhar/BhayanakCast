import type { PastStreamSummary } from './home-types'

interface PastStreamsProps {
  readonly streams: readonly PastStreamSummary[]
}

const endedAtFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

export function PastStreams({ streams }: PastStreamsProps) {
  if (streams.length === 0) return null

  return (
    <section aria-labelledby="past-streams-heading" className="past-streams">
      <div className="home-section-heading">
        <h2 id="past-streams-heading">Past Streams</h2>
        <p>Recent clubhouse rooms</p>
      </div>
      <ol className="past-streams-list">
        {streams.map((stream) => (
          <li className="past-stream-item" key={stream.roomId}>
            <a
              aria-label={`Open summary for ${stream.name}`}
              href={`/rooms/${encodeURIComponent(stream.roomId)}`}
            >
              <div className="past-stream-item__heading">
                <h3 data-past-stream-name>{stream.name}</h3>
                <span
                  className={`room-chip room-chip--${stream.visibility}`}
                >
                  {stream.visibility === 'private' ? 'Private' : 'Public'}
                </span>
              </div>
              <time dateTime={stream.endedAt}>
                Ended {endedAtFormatter.format(new Date(stream.endedAt))} UTC
              </time>
              {(stream.category || stream.tags.length > 0) && (
                <div className="past-stream-item__topics">
                  {stream.category && <span>{stream.category}</span>}
                  {stream.tags.map((tag) => (
                    <span key={tag}>#{tag}</span>
                  ))}
                </div>
              )}
              <p className="past-stream-item__summary tabular-nums">
                {stream.memberCount}{' '}
                {stream.memberCount === 1 ? 'member' : 'members'} ·{' '}
                {stream.streamCount}{' '}
                {stream.streamCount === 1 ? 'stream' : 'streams'}
              </p>
              <span aria-hidden="true" className="past-stream-item__open">
                Open summary <span>→</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  )
}
