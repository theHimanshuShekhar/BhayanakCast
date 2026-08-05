import type { RoomMedia } from './useRoomMedia'

/** ADR 0100's control shelf: integrated below the media canvas, holding the
    viewer's single stateful own-Stream slot and Leave. Nothing here ever
    controls someone else's stream — those controls live on their tile. */
export function RoomControlShelf({
  media,
  canStream,
  connection,
  reconnectSecondsRemaining,
  leavePending,
  onLeave,
}: Readonly<{
  media: RoomMedia
  canStream: boolean
  connection: 'live' | 'reconnecting' | 'lost'
  reconnectSecondsRemaining: number | null
  leavePending: boolean
  onLeave: () => void
}>) {
  const frozen = connection !== 'live'
  return (
    <div className="room-shelf" data-connection={connection}>
      {media.compatibility !== 'compatible' && (
        // Compatibility never blocks admission. A failed probe is explicitly
        // rerunnable in place, without leaving chat or the room.
        <div className="room-shelf__compatibility" role="status">
          <p>
            {media.compatibility === 'probing'
              ? 'Checking direct media compatibility… Chat and presence remain available.'
              : 'Direct media is unavailable. Chat and presence remain available.'}
          </p>
          {media.compatibility === 'incompatible' && (
            <button type="button" onClick={() => void media.retryCompatibility()}>
              Retry compatibility
            </button>
          )}
        </div>
      )}
      {media.captureSupported === false && (
        <p className="room-shelf__guidance" id="desktop-stream-guidance">
          Sharing a screen requires a Chromium-family browser on a desktop computer.
          You can still watch streams on this device after the media check passes.
        </p>
      )}
      {!canStream && (
        <p className="room-shelf__guidance" id="stream-sanction-guidance" role="status">
          Streaming is unavailable on your account. You can remain in the room.
        </p>
      )}
      {frozen && (
        <p className="room-shelf__compatibility" role="status">
          {connection === 'reconnecting'
            ? `Reconnecting… ${reconnectSecondsRemaining ?? 45}s remaining. Your media was stopped; Start or Watch again after recovery.`
            : 'Connection lost. Start your stream and pick a stream to watch again.'}
        </p>
      )}

      <div className="room-shelf__slot">
        <StreamSlot canStream={canStream} frozen={frozen} media={media} />
      </div>

      {media.error && (
        <p className="form-error room-shelf__error" role="alert">
          {media.error}
        </p>
      )}

      <div className="room-shelf__trailing">
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
  canStream,
  frozen,
}: Readonly<{ media: RoomMedia; frozen: boolean; canStream: boolean }>) {
  if (!canStream) {
    return (
      <button
        aria-describedby="stream-sanction-guidance"
        className="room-shelf__stream"
        disabled
        type="button"
      >
        Streaming unavailable
      </button>
    )
  }
  // `null` means the client has not been determined yet, so fall through to the ordinary
  // probing copy rather than claiming this device cannot share.
  if (media.captureSupported === false) {
    return (
      <button
        aria-describedby="desktop-stream-guidance"
        className="room-shelf__stream"
        disabled
        type="button"
      >
        Desktop only
      </button>
    )
  }
  if (media.compatibility !== 'compatible') {
    return (
      <button className="room-shelf__stream" disabled type="button">
        {media.compatibility === 'probing' ? 'Checking media…' : 'Media unavailable'}
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
