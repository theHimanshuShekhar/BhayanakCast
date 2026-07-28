import { useEffect, useRef, useState } from 'react'
import type { RoomRosterMember, RoomWatcher } from '../../server/rooms/room-roster'
import { WATCH_MAX_ATTEMPTS, type RoomMedia, type WatchState } from './useRoomMedia'

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
        {visible.map((member) => (
          <MemberTile
            hostActions={hostActions}
            key={member.membershipId}
            media={media}
            member={member}
            selfMembershipId={selfMembershipId}
            onReport={onReport}
          />
        ))}
      </ul>
    </div>
  )
}

function MemberTile({
  member,
  selfMembershipId,
  media,
  onReport,
  hostActions,
}: Readonly<{
  member: RoomRosterMember
  selfMembershipId: string
  media: RoomMedia
  onReport: (member: RoomRosterMember) => void
  hostActions: ((member: RoomRosterMember) => void) | null
}>) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Every watch starts muted (ADR 0101); unmuting is the viewer's own act.
  const [muted, setMuted] = useState(true)
  const you = member.membershipId === selfMembershipId
  const attempt = subscriptionFor(media.watch, member.streamId)
  const watching = attempt?.kind === 'watching'

  useEffect(() => {
    if (!watching) setMuted(true)
  }, [watching])

  return (
    <li
      className="room-mosaic__tile"
      data-member-role={member.role}
      data-member-sharing={member.streamId !== null}
      data-member-self={you}
      data-member-watched={watching}
    >
      <div className="room-mosaic__presence">
        {you && media.localStream ? (
          <StreamSurface
            label="Your screen"
            muted
            stream={media.localStream}
            videoRef={videoRef}
          />
        ) : watching && media.remoteStream ? (
          <StreamSurface
            label={`${member.displayName}'s screen`}
            muted={muted}
            stream={media.remoteStream}
            videoRef={videoRef}
          />
        ) : (
          <>
            <Avatar member={member} />
            {member.streamId !== null && (
              <span className="room-mosaic__sharing">{sharingLabel(attempt)}</span>
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
              member.streamId !== null ? (watching ? 'Watching' : 'Live') : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Here'}
          </p>
        </div>

        {member.streamId !== null && (
          <WatcherStack total={member.watcherCount} watchers={member.watchers} />
        )}

        {attempt?.kind === 'failed' && (
          // Exhausted retries hand the tile back with guidance rather than a
          // silent loop (ADR 0077); the room stays usable without media
          // (ADR 0059).
          <p className="room-mosaic__failure">
            Could not connect to this stream. Chat and the rest of the room keep
            working — try again, or use a recent Chrome, Edge, Firefox or Safari.
          </p>
        )}

        <div className="room-mosaic__actions">
          {/* Every control for a remote stream lives on that stream's tile;
              the shelf below the canvas is only ever about your own stream
              (ADR 0100). One row when it fits, wrapping to a second when it
              does not — no overflow menu, no auto-hiding overlay (ADR 0101). */}
          {watching && (
            <>
              <button type="button" onClick={() => setMuted((current) => !current)}>
                {muted ? 'Unmute' : 'Mute'}
              </button>
              <button type="button" onClick={() => void videoRef.current?.requestFullscreen()}>
                Fullscreen
              </button>
            </>
          )}
          {member.streamId !== null &&
            !you &&
            (watching || attempt?.kind === 'connecting' ? (
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
                {attempt?.kind === 'failed' ? 'Retry' : 'Watch'}
              </button>
            ))}
          {!you && (
            <button className="room-mosaic__menu" type="button" onClick={() => onReport(member)}>
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
}

/** The viewer's single subscription, when it belongs to this member's stream. */
function subscriptionFor(watch: WatchState, streamId: string | null) {
  if (streamId === null || watch.kind === 'idle' || watch.streamId !== streamId) return null
  return watch
}

function sharingLabel(attempt: ReturnType<typeof subscriptionFor>) {
  if (attempt?.kind === 'connecting') {
    // Bounded progress, so a viewer can see the retries end (ADR 0077).
    return `Connecting… attempt ${attempt.attempt} of ${WATCH_MAX_ATTEMPTS}`
  }
  if (attempt?.kind === 'failed') return 'Could not connect'
  return 'Screen up'
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

/** The media only — its controls are explicit buttons in the tile footer, so
    nothing floats over what is being shared and nothing auto-hides (ADR 0101). */
function StreamSurface({
  stream,
  label,
  muted,
  videoRef,
}: Readonly<{
  stream: MediaStream
  label: string
  muted: boolean
  videoRef: React.RefObject<HTMLVideoElement | null>
}>) {
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream
  }, [stream, videoRef])
  return (
    <video
      aria-label={label}
      autoPlay
      className="room-mosaic__video"
      muted={muted}
      playsInline
      ref={videoRef}
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
