import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  preserveRoomRosterOrder,
  type RoomRosterMember,
  type RoomWatcher,
} from '../../server/rooms/room-roster'
import {
  WATCH_MAX_ATTEMPTS,
  type RoomMedia,
  type WatchBlockedReason,
  type WatchState,
} from './useRoomMedia'
import { RoomMemberActions } from './RoomMemberActions'
import { observeRoom } from './room-observability'

interface RoomMemberMosaicProps {
  readonly roster: readonly RoomRosterMember[]
  readonly selfMembershipId: string
  readonly media: RoomMedia
  /** Decides the preview treatment: a private room's previews are blurred
      (ADR 0035), on top of being captured small enough to carry no detail. */
  readonly visibility: 'public' | 'private'
  readonly onReport: (member: RoomRosterMember) => void
  readonly hostActions: ((member: RoomRosterMember) => void) | null
  readonly onKickMember: ((member: RoomRosterMember) => void) | null
  readonly onTransferHost: ((member: RoomRosterMember) => void) | null
  readonly onStopStream: ((member: RoomRosterMember) => void) | null
}

/** Mirrors `--transition-duration-layout` and `--ease-clubhouse`: the FLIP runs
    through the Web Animations API, which cannot read the stylesheet's tokens. */
const TILE_MOVE_MS = 240
const STAGE_ARRIVE_MS = 320
const EASE_CLUBHOUSE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/** The mosaic renders on the server (ADR 0099 hydrates the admitted room), and
    a layout effect there is both useless and noisy. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** ADR 0101: every admitted member owns one stable tile, streaming or not, and
    a non-streaming member gets a presence tile anchored by their real avatar —
    never camera-off iconography that implies a webcam this product does not
    have. The one watched stream enlarges in place; emphasis changes a tile's
    size, never its position in the order. */
export function RoomMemberMosaic({
  roster,
  selfMembershipId,
  media,
  visibility,
  onReport,
  hostActions,
  onKickMember,
  onTransferHost,
  onStopStream,
}: RoomMemberMosaicProps) {
  // Viewer-local and unshared: hiding a member from your own mosaic says
  // nothing to them and nothing to anyone else.
  const [hideQuiet, setHideQuiet] = useState(false)
  const stableRoster = useRef<readonly RoomRosterMember[]>([])
  stableRoster.current = preserveRoomRosterOrder(
    stableRoster.current,
    roster,
    selfMembershipId,
  )
  const streaming = stableRoster.current.filter((member) => member.streamId !== null)
  const visible = hideQuiet ? streaming : stableRoster.current
  const watch = media.watch
  const hasWatch =
    watch.kind === 'watching' &&
    visible.some((member) => member.streamId === watch.streamId)

  // The whole watch lifecycle is a sequence of silent DOM swaps: preview to
  // `Connecting`, four attempts, then media or guidance. One polite region for
  // the mosaic narrates it, because the viewer who most needs to know whether
  // the click landed is the one who cannot see the tile change.
  const watchTarget =
    watch.kind === 'idle'
      ? null
      : (stableRoster.current.find((member) => member.streamId === watch.streamId) ?? null)
  const lastWatched = useRef<string | null>(null)
  useEffect(() => {
    if (watchTarget) lastWatched.current = watchTarget.displayName
  }, [watchTarget])
  const announcement = watchAnnouncement(
    watch,
    watchTarget?.displayName ?? lastWatched.current,
  )

  // The one authored moment on this surface: a stream you asked for arrives
  // and takes the stage. Without it the grid teleports — the chosen tile is
  // suddenly full width in row one and every other member has jumped to a new
  // place, with nothing connecting the click to the result. Tiles translate
  // from where they were; the promoted tile also grows its media region out of
  // the preview's footprint, so the thing you picked is visibly the thing that
  // got bigger. Only the media scales — scaling a whole tile would smear its
  // name and controls.
  const mosaicRef = useRef<HTMLUListElement | null>(null)
  const lastTileRects = useRef(new Map<string, DOMRect>())
  useIsomorphicLayoutEffect(() => {
    const list = mosaicRef.current
    if (!list) return
    const previous = lastTileRects.current
    const current = new Map<string, DOMRect>()
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const node of list.children) {
      const tile = node as HTMLElement
      const key = tile.dataset.membershipId
      if (!key) continue
      const to = tile.getBoundingClientRect()
      current.set(key, to)
      const from = previous.get(key)
      if (!from || still) continue
      const dx = from.left - to.left
      const dy = from.top - to.top
      if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
        tile.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
          { duration: TILE_MOVE_MS, easing: EASE_CLUBHOUSE },
        )
      }
      const media = tile.querySelector<HTMLElement>('.room-mosaic__presence')
      const grew = to.width / from.width
      if (media && grew > 1.1) {
        media.animate(
          [
            { transform: `scale(${1 / grew})`, opacity: 0.4 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: STAGE_ARRIVE_MS, easing: EASE_CLUBHOUSE },
        )
      }
    }
    lastTileRects.current = current
  })

  return (
    <div className="room-mosaic-region">
      <p aria-live="polite" className="visually-hidden" role="status">
        {announcement}
      </p>

      <div className="room-mosaic-region__controls">
        <label className="room-mosaic-region__filter">
          <input
            checked={hideQuiet}
            type="checkbox"
            onChange={(event) => {
              const hidden = event.target.checked
              setHideQuiet(hidden)
              observeRoom({
                name: 'room_mosaic_filter_changed',
                properties: { hidden },
              })
            }}
          />
          Hide non-streaming participants
        </label>
      </div>

      {streaming.length === 0 && (
        <p className="room-mosaic-region__empty">No one is sharing yet.</p>
      )}

      <ul
        className="room-mosaic"
        data-has-watch={hasWatch}
        data-member-count={visible.length}
        ref={mosaicRef}
      >
        {visible.map((member) => (
          <MemberTile
            hostActions={hostActions}
            onKickMember={onKickMember}
            onTransferHost={onTransferHost}
            onStopStream={onStopStream}
            key={member.membershipId}
            media={media}
            member={member}
            selfMembershipId={selfMembershipId}
            visibility={visibility}
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
  visibility,
  onReport,
  hostActions,
  onKickMember,
  onTransferHost,
  onStopStream,
}: Readonly<{
  member: RoomRosterMember
  selfMembershipId: string
  media: RoomMedia
  visibility: 'public' | 'private'
  onReport: (member: RoomRosterMember) => void
  hostActions: ((member: RoomRosterMember) => void) | null
  onKickMember: ((member: RoomRosterMember) => void) | null
  onTransferHost: ((member: RoomRosterMember) => void) | null
  onStopStream: ((member: RoomRosterMember) => void) | null
}>) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Every watch starts muted (ADR 0101); unmuting is the viewer's own act.
  const [muted, setMuted] = useState(true)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [fullscreenError, setFullscreenError] = useState<string | null>(null)
  const tileId = useId()
  const nameId = `${tileId}-name`
  const blockId = `${tileId}-blocked`
  const you = member.membershipId === selfMembershipId
  const attempt = subscriptionFor(media.watch, member.streamId)
  const watching = attempt?.kind === 'watching'
  // The roster can say you are streaming after your capture has already gone —
  // a reconnect stops local media but the server still holds the Stream. Your
  // own tile must not answer that with a stale thumbnail labelled `Live`.
  const selfCaptureLost = you && member.streamId !== null && media.localStream === null
  const sharing = member.streamId !== null && !selfCaptureLost

  useEffect(() => {
    if (!watching) setMuted(true)
  }, [watching])
  useEffect(() => setPreviewFailed(false), [member.previewKey])
  useEffect(() => {
    if (!watching) setFullscreenError(null)
  }, [watching])

  const showPreview = sharing && member.previewKey !== null && !previewFailed
  const showWatchButton =
    sharing && !you && !watching && attempt?.kind !== 'connecting'
  const badge = sharingLabel(attempt)

  // Four conditions grey out Watch and the button looks the same for all of
  // them. `watchBlockedReason` covers the three the media layer owns; the
  // fourth is local — one subscription at a time, so a connect in flight
  // blocks every other tile until it settles.
  const otherConnecting =
    media.watch.kind === 'connecting' && media.watch.streamId !== member.streamId
  const watchBlock = media.watchBlockedReason
    ? WATCH_BLOCKED_COPY[media.watchBlockedReason]
    : otherConnecting
      ? 'Finishing the stream you just picked. Try again in a moment.'
      : null

  // iOS Safari never implemented the standard call on a video element; it
  // exposes `webkitEnterFullscreen` instead. Without this branch the most
  // prominent control on a watched tile silently does nothing on the phones
  // ADR 0014 promises to support.
  async function enterFullscreen() {
    const video = videoRef.current
    if (!video) return
    observeRoom({ name: 'room_watch_fullscreen_requested', properties: {} })
    setFullscreenError(null)
    const legacy = (video as HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      .webkitEnterFullscreen
    try {
      if (typeof video.requestFullscreen === 'function') {
        await video.requestFullscreen()
      } else if (typeof legacy === 'function') {
        legacy.call(video)
      } else {
        setFullscreenError('This browser cannot show the stream fullscreen.')
      }
    } catch {
      setFullscreenError('Your browser blocked fullscreen. Try again from this tile.')
    }
  }

  return (
    <li
      aria-labelledby={nameId}
      className="room-mosaic__tile"
      data-member-role={member.role}
      data-member-sharing={sharing}
      data-member-self={you}
      data-member-watched={watching}
      data-membership-id={member.membershipId}
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
            {/* Before a subscription, a streaming tile shows the Stream
                Preview — non-interactive, with Watch in the footer where every
                other control lives (ADR 0102). A preview that cannot be
                fetched falls back to the member rather than to an empty frame
                that reads as a stream with nothing in it. */}
            {showPreview ? (
              <img
                alt=""
                className="room-mosaic__preview"
                data-preview-visibility={visibility}
                decoding="async"
                src={`/api/stream-previews/${encodeURIComponent(member.previewKey as string)}`}
                onError={() => setPreviewFailed(true)}
              />
            ) : (
              <Avatar member={member} />
            )}
            {sharing && (
              <span className="room-mosaic__sharing" data-tone={badge.tone}>
                {badge.text}
              </span>
            )}
          </>
        )}
      </div>

      {/* Below the media region, not over it: ADR 0101 keeps the footer
          out of the shared content and out of hover. */}
      <div className="room-mosaic__footer">
        <div className="room-mosaic__identity">
          <p className="room-mosaic__name" id={nameId}>
            {member.displayName}
          </p>
          <p className="room-mosaic__state">
            {tileStateFragments({
              role: member.role,
              you,
              sharing,
              watching,
              selfCaptureLost,
              reconnecting: member.reconnecting,
              compatibility:
                you && member.streamId === null ? media.compatibility : null,
              // Preview freshness, so a still tile says how still it is
              // (ADR 0102's footer, ADR 0035's two-minute cadence).
              previewUpdatedAt: sharing && !watching ? member.previewUpdatedAt : undefined,
            }).map((fragment) => (
              <span data-tone={fragment.tone} key={fragment.text}>
                {fragment.text}
              </span>
            ))}
          </p>
        </div>

        {sharing && (
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

        {fullscreenError && <p className="room-mosaic__failure">{fullscreenError}</p>}

        {watchBlock && showWatchButton && (
          // The reason, not just the grey: four different conditions disable
          // Watch and a viewer cannot tell them apart from the button alone.
          <p className="room-mosaic__blocked" id={blockId}>
            {watchBlock}
          </p>
        )}

        <div className="room-mosaic__actions">
          {/* Every control for a remote stream lives on that stream's tile;
              the shelf below the canvas is only ever about your own stream
              (ADR 0100). One row when it fits, wrapping to a second when it
              does not — no overflow menu, no auto-hiding overlay (ADR 0101). */}
          {watching && (
            <>
              <button
                type="button"
                onClick={() =>
                  setMuted((current) => {
                    const next = !current
                    observeRoom({
                      name: 'room_watch_audio_changed',
                      properties: { muted: next },
                    })
                    return next
                  })
                }
              >
                {muted ? 'Unmute' : 'Mute'}
              </button>
              <button type="button" onClick={() => void enterFullscreen()}>
                Fullscreen
              </button>
            </>
          )}
          {sharing &&
            !you &&
            (watching || attempt?.kind === 'connecting' ? (
              <button
                aria-label={
                  watching
                    ? `Stop watching ${member.displayName}'s screen`
                    : `Cancel connecting to ${member.displayName}'s screen`
                }
                className="room-mosaic__watch"
                type="button"
                onClick={() => void media.stopWatchingStream()}
              >
                {watching ? 'Stop watching' : 'Cancel'}
              </button>
            ) : (
              // `aria-disabled` rather than `disabled`: a blocked Watch that
              // leaves the tab order takes its own explanation with it. The
              // member is in the accessible name, not the visible one — ten
              // buttons reading `Watch` are indistinguishable in a screen
              // reader's element list, and a 35-character display name inside
              // the label wraps the button onto two lines.
              <button
                aria-describedby={watchBlock ? blockId : undefined}
                aria-disabled={watchBlock ? true : undefined}
                aria-label={
                  attempt?.kind === 'failed'
                    ? `Retry watching ${member.displayName}'s screen`
                    : `Watch ${member.displayName}'s screen`
                }
                className="room-mosaic__watch"
                data-blocked={watchBlock ? true : undefined}
                type="button"
                onClick={() => {
                  if (watchBlock) return
                  void media.startWatching(member.streamId as string)
                }}
              >
                {attempt?.kind === 'failed' ? 'Retry' : 'Watch'}
              </button>
            ))}
          {!you && (
            <RoomMemberActions
              member={member}
              onBan={hostActions ?? undefined}
              onKick={onKickMember ?? undefined}
              onReport={onReport}
              onStopStream={onStopStream ?? undefined}
              onTransfer={onTransferHost ?? undefined}
              surface="tile"
            />
          )}
        </div>
      </div>
    </li>
  )
}

/** The viewer's single subscription, when it belongs to this member's stream. */
export type WatchAttempt = Exclude<WatchState, { readonly kind: 'idle' }> | null

function subscriptionFor(watch: WatchState, streamId: string | null): WatchAttempt {
  if (streamId === null || watch.kind === 'idle' || watch.streamId !== streamId) return null
  return watch
}

/** What the mosaic's live region says as a watch progresses. The visible tile
    already carries all of this; the region exists so the sequence is available
    to someone who cannot watch the tile change. */
export function watchAnnouncement(watch: WatchState, displayName: string | null): string {
  const whose = displayName ? `${displayName}'s screen` : 'the stream'
  if (watch.kind === 'connecting') {
    return `Connecting to ${whose}, attempt ${watch.attempt} of ${WATCH_MAX_ATTEMPTS}.`
  }
  if (watch.kind === 'watching') return `Watching ${whose}. Audio starts muted.`
  if (watch.kind === 'failed') {
    return `Could not connect to ${whose}. Chat and the rest of the room keep working.`
  }
  return displayName ? `Stopped watching ${whose}.` : ''
}

/** Named so the greyed-out button and the sentence under it come from one
    place; ADR 0059 keeps every one of these recoverable rather than terminal. */
const WATCH_BLOCKED_COPY: Record<NonNullable<WatchBlockedReason>, string> = {
  probing: 'Checking whether this browser can watch streams.',
  incompatible: 'This browser cannot watch streams. Chat and presence still work.',
  reconnecting: 'Reconnecting to the room. Watching resumes once you are back.',
  'room-ended': 'This room has ended.',
}

/** How old the tile's preview is, coarsely — previews refresh every two
    minutes (ADR 0035), so a per-second countdown would say nothing true. */
export function previewFreshnessLabel(
  updatedAt: Date | null,
  now: Date = new Date(),
): string | null {
  if (!updatedAt) return 'No preview yet'
  const seconds = Math.max(0, Math.round((now.getTime() - updatedAt.getTime()) / 1_000))
  if (seconds < 60) return 'Preview just now'
  const minutes = Math.round(seconds / 60)
  return `Preview ${RELATIVE_TIME.format(-minutes, 'minute')}`
}

const RELATIVE_TIME = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

function sharingLabel(attempt: WatchAttempt) {
  if (attempt?.kind === 'connecting') {
    // Bounded progress, so a viewer can see the retries end (ADR 0077).
    return {
      text: `Connecting… attempt ${attempt.attempt} of ${WATCH_MAX_ATTEMPTS}`,
      tone: 'warning' as const,
    }
  }
  // A failure wearing the Live colour reads as a celebration; keep the Live
  // family for the one state that is actually live (ADR 0096).
  if (attempt?.kind === 'failed') {
    return { text: 'Could not connect', tone: 'danger' as const }
  }
  return { text: 'Screen up', tone: 'live' as const }
}

/** Up to three avatars plus the total, ordered by watch start. */
function WatcherStack({
  watchers,
  total,
}: Readonly<{ watchers: readonly RoomWatcher[]; total: number }>) {
  return (
    <p
      aria-label={watcherAccessibleLabel(watchers, total)}
      className="room-mosaic__watchers"
    >
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

export function watcherAccessibleLabel(
  watchers: readonly RoomWatcher[],
  total: number,
): string {
  if (total === 0) return 'No watchers'
  const names = watchers.map((watcher) => watcher.displayName).join(', ')
  const remaining = Math.max(0, total - watchers.length)
  const visible = names ? `Watched by ${names}` : 'Watchers'
  const hidden = remaining > 0 ? ` and ${remaining} more` : ''
  return `${visible}${hidden}; ${total} ${total === 1 ? 'watcher' : 'watchers'} total`
}

/** One tile status line, split into fragments that each own a semantic tone.
    The old single joined string forced every state — role, sharing, health,
    compatibility, thumbnail age — through one muted colour, so nothing in the
    grid was scannable. Each fragment now carries its family (ADR 0096) and the
    Live fragment also carries a dot, so hue is never the only signal. */
export function tileStateFragments({
  role,
  you,
  sharing,
  watching,
  selfCaptureLost,
  reconnecting,
  compatibility,
  previewUpdatedAt,
}: Readonly<{
  role: RoomRosterMember['role']
  you: boolean
  sharing: boolean
  watching: boolean
  selfCaptureLost: boolean
  reconnecting: boolean
  compatibility: RoomMedia['compatibility'] | null
  previewUpdatedAt?: Date | null
}>): readonly { readonly text: string; readonly tone: StateTone }[] {
  const fragments: { text: string; tone: StateTone }[] = []
  if (role === 'host') fragments.push({ text: 'Host', tone: 'host' })
  if (you) fragments.push({ text: 'You', tone: 'muted' })
  if (sharing) fragments.push({ text: watching ? 'Watching' : 'Live', tone: 'live' })
  if (selfCaptureLost) fragments.push({ text: 'Screen stopped', tone: 'warning' })
  if (reconnecting) fragments.push({ text: 'Reconnecting', tone: 'warning' })
  if (compatibility === 'probing') {
    fragments.push({ text: 'Checking media…', tone: 'muted' })
  } else if (compatibility === 'compatible') {
    fragments.push({ text: 'Media ready', tone: 'host' })
  } else if (compatibility === 'incompatible') {
    fragments.push({ text: 'Chat only', tone: 'danger' })
  }
  if (previewUpdatedAt !== undefined) {
    const freshness = previewFreshnessLabel(previewUpdatedAt)
    if (freshness) fragments.push({ text: freshness, tone: 'muted' })
  }
  if (fragments.length === 0) fragments.push({ text: 'Here', tone: 'muted' })
  return fragments
}

type StateTone = 'host' | 'live' | 'warning' | 'danger' | 'muted'

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
