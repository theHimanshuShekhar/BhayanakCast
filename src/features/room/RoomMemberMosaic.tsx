import { useEffect, useRef, useState } from 'react'
import type { RoomRosterMember, RoomWatcher } from '../../server/rooms/room-roster'
import type { RoomMedia } from './useRoomMedia'

interface RoomMemberMosaicProps {
  readonly roster: readonly RoomRosterMember[]
  readonly selfMembershipId: string
  readonly media: RoomMedia
  readonly onReport: (member: RoomRosterMember) => void
  readonly hostActions: ((member: RoomRosterMember) => void) | null
}

/** ADR 0101: every admitted member owns one stable tile, streaming or not, and
    a non-streaming member gets a presence tile anchored by their real avatar —
    never camera-off iconography that implies a webcam this product does not
    have. The one watched stream enlarges in place; emphasis changes a tile's
    size, never its position in the order. */
export function RoomMemberMosaic({
  roster,
  selfMembershipId,
  media,
  onReport,
  hostActions,
}: RoomMemberMosaicProps) {
  // Viewer-local and unshared: hiding a member from your own mosaic says
  // nothing to them and nothing to anyone else.
  const [hideQuiet, setHideQuiet] = useState(false)
  const streaming = roster.filter((member) => member.streamId !== null)
  const visible = hideQuiet ? streaming : roster

  return (
    <div className="room-mosaic-region">
      <div className="room-mosaic-region__controls">
        <label className="room-mosaic-region__filter">
          <input
            checked={hideQuiet}
            type="checkbox"
            onChange={(event) => setHideQuiet(event.target.checked)}
          />
          Hide non-streaming participants
        </label>
      </div>

      {streaming.length === 0 && (
        <p className="room-mosaic-region__empty">No one is sharing yet.</p>
      )}

      <ul className="room-mosaic" data-member-count={visible.length}>
        {visible.map((member) => {
          const you = member.membershipId === selfMembershipId
          const watched =
            member.streamId !== null &&
            media.watch.kind !== 'idle' &&
            media.watch.streamId === member.streamId
          return (
            <li
              className="room-mosaic__tile"
              data-member-role={member.role}
              data-member-sharing={member.streamId !== null}
              data-member-self={you}
              data-member-watched={watched}
              key={member.membershipId}
            >
              <div className="room-mosaic__presence">
                {you && media.localStream ? (
                  <StreamSurface label="Your screen" stream={media.localStream} />
                ) : watched && media.remoteStream ? (
                  <StreamSurface
                    label={`${member.displayName}'s screen`}
                    stream={media.remoteStream}
                  />
                ) : (
                  <>
                    <Avatar member={member} />
                    {member.streamId !== null && (
                      <span className="room-mosaic__sharing">
                        {watched ? 'Connecting…' : 'Screen up'}
                      </span>
                    )}
                  </>
                )}
              </div>

              {/* Below the media region, not over it: ADR 0101 keeps the footer
                  out of the shared content and out of hover. */}
              <div className="room-mosaic__footer">
                <div className="room-mosaic__identity">
                  <p className="room-mosaic__name">{member.displayName}</p>
                  <p className="room-mosaic__state">
                    {[
                      member.role === 'host' ? 'Host' : null,
                      you ? 'You' : null,
                      member.streamId !== null ? (watched ? 'Watching' : 'Live') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Here'}
                  </p>
                </div>

                {member.streamId !== null && (
                  <WatcherStack total={member.watcherCount} watchers={member.watchers} />
                )}

                <div className="room-mosaic__actions">
                  {/* Every control for a remote stream lives on that stream's
                      tile; the shelf below the canvas is only ever about your
                      own stream (ADR 0100). */}
                  {member.streamId !== null &&
                    !you &&
                    (watched ? (
                      <button
                        className="room-mosaic__watch"
                        type="button"
                        onClick={() => void media.stopWatchingStream()}
                      >
                        Stop watching
                      </button>
                    ) : (
                      <button
                        className="room-mosaic__watch"
                        disabled={!media.supported || media.watch.kind === 'connecting'}
                        type="button"
                        onClick={() => void media.startWatching(member.streamId as string)}
                      >
                        Watch
                      </button>
                    ))}
                  {!you && (
                    <button
                      className="room-mosaic__menu"
                      type="button"
                      onClick={() => onReport(member)}
                    >
                      Report
                    </button>
                  )}
                  {hostActions && !you && (
                    <button
                      className="room-mosaic__menu"
                      type="button"
                      onClick={() => hostActions(member)}
                    >
                      Host tools
                    </button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Up to three avatars plus the total, ordered by watch start. */
function WatcherStack({
  watchers,
  total,
}: Readonly<{ watchers: readonly RoomWatcher[]; total: number }>) {
  return (
    <p className="room-mosaic__watchers">
      <span aria-hidden="true" className="room-mosaic__watcher-avatars">
        {watchers.map((watcher) =>
          watcher.avatarUrl ? (
            <img alt="" key={watcher.accountId} src={watcher.avatarUrl} />
          ) : (
            <span key={watcher.accountId}>
              {watcher.displayName.slice(0, 1).toUpperCase()}
            </span>
          ),
        )}
      </span>
      <span className="tabular-nums">
        {total} {total === 1 ? 'watcher' : 'watchers'}
      </span>
    </p>
  )
}

/** Every watch starts muted (ADR 0101); the element holds the media, so
    unmuting is the viewer's own deliberate act. */
function StreamSurface({
  stream,
  label,
}: Readonly<{ stream: MediaStream; label: string }>) {
  const ref = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  return (
    <video
      aria-label={label}
      autoPlay
      className="room-mosaic__video"
      controls
      muted
      playsInline
      ref={ref}
    />
  )
}

function Avatar({ member }: Readonly<{ member: RoomRosterMember }>) {
  if (!member.avatarUrl) {
    return (
      <span aria-hidden="true" className="room-mosaic__avatar room-mosaic__avatar--empty">
        {member.displayName.slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return (
    <img alt="" className="room-mosaic__avatar" loading="lazy" src={member.avatarUrl} />
  )
}
