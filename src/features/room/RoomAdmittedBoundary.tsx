import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { chatHistoryQueryOptions, leaveRoom } from './room-queries'
import { RoomCompanionDock } from './RoomCompanionDock'
import { RoomBanDialog } from './RoomBanDialog'
import { RoomKickDialog } from './RoomKickDialog'
import { RoomHostTransferDialog } from './RoomHostTransferDialog'
import { RoomHostStreamStopDialog } from './RoomHostStreamStopDialog'
import { RoomControlShelf } from './RoomControlShelf'
import { RoomMemberMosaic } from './RoomMemberMosaic'
import { RoomReportDialog, type ReportTarget } from './RoomReportDialog'
import { RoomSettingsDialog } from './RoomSettingsDialog'
import { RoomShell } from './RoomShell'
import { RoomLiveHeader } from './RoomLiveHeader'
import { useRoomMedia } from './useRoomMedia'
import { useStreamPreview } from './useStreamPreview'
import { useRoomRealtime, type RoomSocket } from './useRoomRealtime'
import type { RoomRosterMember } from '../../server/rooms/room-roster'
import type { MembershipConfirmation } from '../../server/rooms/room-service'
import type { RoomAdmitted, RoomSelfMembership } from './room-types'
import type { SessionProjection } from '../auth/auth-client'
import { observeRoom } from './room-observability'

type DockTab = 'chat' | 'people' | 'activity'
const EMPTY_CHAT_HISTORY: [] = []

interface RoomAdmittedBoundaryProps {
  readonly room: RoomAdmitted
  readonly self: RoomSelfMembership
  readonly session: SessionProjection | null
  /** The room shares Home's single Socket.IO connection (ADR 0104). */
  readonly socket: RoomSocket | null
  readonly onLeft: (roomState: 'active' | 'empty-grace' | 'ended') => void
  readonly onConfirmation: (confirmation: MembershipConfirmation) => void
}

export function RoomAdmittedBoundary({
  room,
  self,
  session,
  socket,
  onLeft,
  onConfirmation,
}: RoomAdmittedBoundaryProps) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<DockTab | null>(null)
  const sheetInvoker = useRef<HTMLButtonElement | null>(null)
  const [report, setReport] = useState<ReportTarget | null>(null)
  const [banTarget, setBanTarget] = useState<RoomRosterMember | null>(null)
  const [kickTarget, setKickTarget] = useState<RoomRosterMember | null>(null)
  const [transferTarget, setTransferTarget] = useState<RoomRosterMember | null>(null)
  const [streamStopTarget, setStreamStopTarget] = useState<RoomRosterMember | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const history = useQuery(chatHistoryQueryOptions(room.id))
  const realtime = useRoomRealtime({
    socket,
    roomId: room.id,
    admitted: true,
    history: history.data ?? EMPTY_CHAT_HISTORY,
    queryClient,
  })
  const media = useRoomMedia({
    activeStreamIds: room.roster.flatMap((member) =>
      member.streamId === null ? [] : [member.streamId],
    ),
    roomId: room.id,
    realtime,
    connection: realtime.connection,
    roomEnded: realtime.ended,
  })

  // ADR 0035: the viewer's own Stream keeps its preview fresh while it runs,
  // and stops uploading the moment the stream does.
  useStreamPreview({ stream: media.localStream, visibility: room.visibility })


  // Tiles and People rows offer the same actions, from one definition each
  // (ADR 0102).
  const reportMember = (member: RoomRosterMember) =>
    setReport({
      type: member.streamId ? 'stream' : 'account',
      id: member.streamId ?? member.accountId,
      label: member.displayName,
    })
  const hostActions = self.role === 'host' ? setBanTarget : null
  const onKickMember = self.role === 'host' ? setKickTarget : null
  const onTransferHost = self.role === 'host' ? setTransferTarget : null
  const onStopStream = self.role === 'host' ? setStreamStopTarget : null

  const leave = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const result = await leaveRoom({
        data: {
          roomId: room.id,
          membershipId: self.id,
        },
      })
      if (result.status === 'left') onLeft(result.roomState)
      else if (result.status === 'confirmation-required') onConfirmation(result.confirmation)
      else setError('You are no longer a member of this room.')
    } catch {
      setError('Unable to leave this room right now.')
    } finally {
      setPending(false)
    }
  }

  const toggleCompanionSheet = (tab: DockTab, invoker: HTMLButtonElement) => {
    sheetInvoker.current = invoker
    if (sheet === tab) {
      observeRoom({
        name: 'room_companion_closed',
        properties: { surface: 'sheet', reason: 'control' },
      })
      setSheet(null)
      return
    }
    observeRoom({
      name: sheet === null ? 'room_companion_opened' : 'room_companion_tab_selected',
      properties: { surface: 'sheet', tab },
    })
    setSheet(tab)
  }

  const dismissCompanionSheet = () => {
    setSheet(null)
    requestAnimationFrame(() => sheetInvoker.current?.focus())
  }

  return (
    <RoomShell session={session} state="admitted">
      <main className="room-boundary room-boundary--admitted" data-room-state="admitted">
        <RoomLiveHeader
          canManageSettings={self.role === 'host'}
          room={room}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <div className="room-stage">
          <section
            aria-label="Streams and members"
            className="room-stage__canvas"
            data-connection={realtime.connection}
          >
            <h2 className="visually-hidden">Streams and members</h2>
            <RoomMemberMosaic
              hostActions={hostActions}
              media={media}
              onKickMember={onKickMember}
              onReport={reportMember}
              onStopStream={onStopStream}
              onTransferHost={onTransferHost}
              roster={room.roster}
              selfMembershipId={self.id}
              visibility={room.visibility}
            />
          </section>

          {error && (
            <p className="form-error room-boundary__error" role="alert">
              {error}
            </p>
          )}

          <RoomControlShelf
            canStream={room.canStream}
            connection={realtime.connection}
            reconnectSecondsRemaining={realtime.reconnectSecondsRemaining}
            leavePending={pending}
            media={media}
            onLeave={leave}
          />
        </div>

        <RoomCompanionDock
          canChat={room.canChat}
          hostActions={hostActions}
          memberCount={room.memberCount}
          onDismissSheet={dismissCompanionSheet}
          onReport={reportMember}
          onReportMessage={(message) =>
            setReport({
              type: 'message',
              id: message.id,
              label: `Message from ${message.displayName}`,
            })
          }
          onKickMember={onKickMember}
          onStopStream={onStopStream}
          onTransferHost={onTransferHost}
          realtime={realtime}
          roster={room.roster}
          selfMembershipId={self.id}
          sheet={sheet}
        />

        {/* Below 768px this is the only room control surface (ADR 0103). */}
        <nav aria-label="Room controls" className="room-mobile-bar">
          <button
            aria-describedby="mobile-stream-guidance"
            data-disabled-reason="Desktop only"
            disabled
            type="button"
          >
            Desktop only
          </button>
          <span className="visually-hidden" id="mobile-stream-guidance">
            Sharing a screen requires a Chromium-family browser on a desktop
            computer. Watching remains available after the media check passes.
          </span>
          {(['chat', 'people', 'activity'] as const).map((tab) => (
            <button
              aria-controls="room-companions"
              aria-expanded={sheet === tab}
              key={tab}
              type="button"
              onClick={(event) => toggleCompanionSheet(tab, event.currentTarget)}
            >
              {tab === 'chat' ? 'Chat' : tab === 'people' ? 'People' : 'Activity'}
            </button>
          ))}
          <button disabled={pending} type="button" onClick={leave}>
            Leave
          </button>
        </nav>

        <RoomReportDialog
          roomId={room.id}
          target={report}
          onClose={() => setReport(null)}
          onSubmitted={() => {
            if (report?.type === 'stream') void media.stopWatchingStream()
          }}
        />
        <RoomBanDialog
          roomId={room.id}
          target={banTarget}
          onClose={() => setBanTarget(null)}
        />
        <RoomKickDialog
          roomId={room.id}
          target={kickTarget}
          onClose={() => setKickTarget(null)}
        />
        <RoomHostTransferDialog
          roomId={room.id}
          target={transferTarget}
          onClose={() => setTransferTarget(null)}
        />
        <RoomHostStreamStopDialog
          roomId={room.id}
          target={streamStopTarget}
          onClose={() => setStreamStopTarget(null)}
        />
        {self.role === 'host' && (
          <RoomSettingsDialog
            open={settingsOpen}
            room={room}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </main>
    </RoomShell>
  )
}
