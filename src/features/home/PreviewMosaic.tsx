import type { ActiveRoomSummary } from './home-types'

interface PreviewMosaicProps {
  readonly room: ActiveRoomSummary
}

export function PreviewMosaic({ room }: PreviewMosaicProps) {
  const previews = room.previews.slice(0, 4)

  if (previews.length === 0) {
    return (
      <div aria-label="Room presence" className="room-presence-panel">
        <MemberPresence
          avatars={room.visibility === 'public' ? room.memberAvatars : []}
          memberCount={room.memberCount}
          privateRoom={room.visibility === 'private'}
        />
        <strong>No one is sharing yet</strong>
        <span>
          {room.state === 'full'
            ? 'The room is full.'
            : 'Conversation is live without an active stream.'}
        </span>
      </div>
    )
  }

  return (
    <div
      aria-label={`${previews.length} active stream ${previews.length === 1 ? 'preview' : 'previews'}`}
      className={`preview-mosaic preview-mosaic--${previews.length} preview-mosaic--${room.visibility}`}
    >
      {previews.map((preview) => (
        <span className="preview-mosaic__tile" key={preview.previewKey}>
          <img
            alt=""
            decoding="async"
            loading="lazy"
            src={`/api/stream-previews/${encodeURIComponent(preview.previewKey)}`}
          />
        </span>
      ))}
      <span className="preview-mosaic__summary">
        {room.streamCount} {room.streamCount === 1 ? 'stream' : 'streams'} live
      </span>
    </div>
  )
}

export function MemberPresence({
  avatars,
  memberCount,
  privateRoom,
}: Readonly<{
  avatars: readonly string[]
  memberCount: number
  privateRoom: boolean
}>) {
  return (
    <div
      aria-label={
        privateRoom
          ? `${memberCount} private room members`
          : `${memberCount} room members`
      }
      className="room-member-presence"
    >
      {avatars.length > 0 && (
        <span aria-hidden="true" className="room-avatar-stack">
          {avatars.slice(0, 4).map((avatar, index) => (
            <img alt="" key={`${avatar}-${index}`} src={avatar} />
          ))}
        </span>
      )}
      <span className="tabular-nums">
        {memberCount} {memberCount === 1 ? 'member' : 'members'}
      </span>
    </div>
  )
}
