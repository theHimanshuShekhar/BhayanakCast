import type { RoomMedia } from './useRoomMedia'

/** ADR 0100's control shelf: integrated below the media canvas, holding the
    viewer's single stateful own-Stream slot and Leave. Nothing here ever
    controls someone else's stream — those controls live on their tile. */
export function RoomControlShelf({
  media,
  connection,
  leavePending,
  onLeave,
}: Readonly<{
  media: RoomMedia
  connection: 'live' | 'reconnecting' | 'lost'
  leavePending: boolean
  onLeave: () => void
}>) {
  const frozen = connection !== 'live'
  return (
    <div className="room-shelf" data-connection={connection}>
      {!media.supported && (
        // Persistent and inline above the shelf — never a dismissible toast, so
        // a member who cannot stream always knows why (ADR 0103).
        <p className="room-shelf__compatibility" role="status">
          This browser cannot share a screen. Streaming and watching need a
          desktop browser with screen sharing support.
        </p>
      )}
      {frozen && (
        <p className="room-shelf__compatibility" role="status">
          {connection === 'reconnecting'
            ? 'Reconnecting… the room is paused until the connection returns.'
            : 'Connection lost. Start your stream and pick a stream to watch again.'}
        </p>
      )}

      <div className="room-shelf__slot">
        <StreamSlot frozen={frozen} media={media} />
      </div>

      {media.error && (
        <p className="form-error room-shelf__error" role="alert">
          {media.error}
        </p>
      )}

      <div className="room-shelf__trailing">
        <a className="room-boundary__back" href="/">
          Back to Home
        </a>
        <button
          aria-busy={leavePending}
          className="room-controls__leave"
          disabled={leavePending}
          type="button"
          onClick={onLeave}
        >
          {leavePending ? 'Leaving…' : 'Leave'}
        </button>
      </div>
    </div>
  )
}

/** One slot, three states — the same control changes label rather than a row
    of buttons appearing and disappearing (ADR 0100). */
function StreamSlot({
  media,
  frozen,
}: Readonly<{ media: RoomMedia; frozen: boolean }>) {
  if (!media.supported) {
    return (
      <button className="room-shelf__stream" disabled type="button">
        Desktop only
      </button>
    )
  }
  if (media.publish.kind === 'starting') {
    return (
      <>
        <button aria-busy className="room-shelf__stream" disabled type="button">
          Starting…
        </button>
        <button
          className="room-shelf__cancel"
          type="button"
          onClick={() => media.cancelPublishing()}
        >
          Cancel
        </button>
      </>
    )
  }
  if (media.publish.kind === 'live') {
    return (
      <button
        className="room-shelf__stream"
        data-streaming="true"
        type="button"
        onClick={() => void media.stopPublishing()}
      >
        Stop Stream
      </button>
    )
  }
  return (
    <button
      className="room-shelf__stream"
      disabled={frozen}
      type="button"
      onClick={() => void media.startPublishing()}
    >
      Start Stream
    </button>
  )
}
