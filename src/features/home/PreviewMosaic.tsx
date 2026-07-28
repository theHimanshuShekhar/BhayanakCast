import type { ActiveRoomSummary } from './home-types'

interface PreviewMosaicProps {
  readonly room: ActiveRoomSummary
}

export function PreviewMosaic({ room }: PreviewMosaicProps) {
  const previews = room.previews.slice(0, 4)
  const hidden = room.visibility === 'private'

  return (
    <div
      aria-label={
        previews.length === 0
          ? 'No one is sharing a screen'
          : hidden
            ? 'Previews hidden in a private room'
            : `${previews.length} active stream ${previews.length === 1 ? 'preview' : 'previews'}`
      }
      className={`preview-mosaic preview-mosaic--${previews.length} preview-mosaic--${room.visibility}`}
      data-preview-state={
        previews.length === 0 ? 'quiet' : hidden ? 'hidden' : 'shown'
      }
    >
      {previews.length > 0 &&
        previews.map((preview) => (
          <span className="preview-mosaic__tile" key={preview.previewKey}>
            {/* A private room still shows its tiles — blurred past reading, with
                the lock badge over them — so the card keeps its live texture. */}
            <img
              alt=""
              decoding="async"
              loading="lazy"
              src={`/api/stream-previews/${encodeURIComponent(preview.previewKey)}`}
            />
          </span>
        ))}

      {previews.length === 0 && (
        <span className="preview-mosaic__quiet">Talking, no screens up</span>
      )}
      {hidden && previews.length > 0 && (
        <span className="preview-mosaic__hidden">Preview hidden</span>
      )}

      <span
        className={`preview-mosaic__state preview-mosaic__state--${room.state}`}
        data-room-state={room.state}
      >
        {room.state === 'full' ? 'Full' : 'Live'}
      </span>
      {room.streamCount > 0 && (
        <span className="preview-mosaic__summary tabular-nums">
          {room.streamCount} {room.streamCount === 1 ? 'screen' : 'screens'} shared
        </span>
      )}
    </div>
  )
}

export function MemberPresence({
  avatars,
  memberCount,
  capacity,
  privateRoom,
  state,
}: Readonly<{
  avatars: readonly string[]
  memberCount: number
  capacity: number
  privateRoom: boolean
  state: 'live' | 'full'
}>) {
  return (
    <div
      aria-label={
        privateRoom
          ? `${memberCount} of ${capacity} private room seats taken`
          : `${memberCount} of ${capacity} seats taken`
      }
      className="room-member-presence"
      data-room-state={state}
    >
      {avatars.length > 0 && (
        <span aria-hidden="true" className="room-avatar-stack">
          {avatars.slice(0, 4).map((avatar, index) => (
            <img alt="" key={`${avatar}-${index}`} src={avatar} />
          ))}
        </span>
      )}
      <span className="tabular-nums">
        {memberCount} of {capacity} seats taken
      </span>
    </div>
  )
}
