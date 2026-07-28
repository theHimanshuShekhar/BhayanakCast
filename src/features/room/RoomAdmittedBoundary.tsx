import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { banRoomMember, chatHistoryQueryOptions, leaveRoom } from './room-queries'
import { RoomCompanionDock } from './RoomCompanionDock'
import { RoomControlShelf } from './RoomControlShelf'
import { RoomMemberMosaic } from './RoomMemberMosaic'
import { RoomReportDialog, type ReportTarget } from './RoomReportDialog'
import { RoomSettingsDialog } from './RoomSettingsDialog'
import { RoomFact, RoomHeader, RoomShell, expiresInLabel } from './RoomShell'
import { useRoomMedia } from './useRoomMedia'
import { useRoomRealtime, type RoomSocket } from './useRoomRealtime'
import type { MembershipConfirmation } from '../../server/rooms/room-service'
import type { RoomAdmitted, RoomSelfMembership } from './room-types'

type DockTab = 'chat' | 'people' | 'activity'

interface RoomAdmittedBoundaryProps {
  readonly room: RoomAdmitted
  readonly self: RoomSelfMembership
  /** The room shares Home's single Socket.IO connection (ADR 0104). */
  readonly socket: RoomSocket | null
  readonly onLeft: (roomState: 'active' | 'empty-grace' | 'ended') => void
  readonly onConfirmation: (confirmation: MembershipConfirmation) => void
}

export function RoomAdmittedBoundary({
  room,
  self,
  socket,
  onLeft,
  onConfirmation,
}: RoomAdmittedBoundaryProps) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<DockTab | null>(null)
  const [report, setReport] = useState<ReportTarget | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const history = useQuery(chatHistoryQueryOptions(room.id))
  const realtime = useRoomRealtime({
    socket,
    roomId: room.id,
    admitted: true,
    history: history.data ?? [],
    queryClient,
  })
  const media = useRoomMedia({
    roomId: room.id,
    realtime,
    connection: realtime.connection,
  })

  // ADR 0103: only the one-minute warning raises the countdown's prominence,
  // and it never says why the room is ending.
  const lastWarning = [...realtime.activity]
    .reverse()
    .find((entry) => entry.kind === 'room-warning')?.minutes

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

  return (
    <RoomShell state="admitted">
      <main className="room-boundary room-boundary--admitted" data-room-state="admitted">
        <RoomHeader
          category={room.category}
          description={room.description}
          eyebrow={self.role === 'host' ? 'Host' : 'Member'}
          eyebrowTone={self.role === 'host' ? 'host' : 'neutral'}
          facts={
            <>
              <RoomFact tone={room.streamCount > 0 ? 'live' : 'neutral'}>
                {room.streamCount}{' '}
                {room.streamCount === 1 ? 'screen shared' : 'screens shared'}
              </RoomFact>
              <RoomFact>
                {room.memberCount} of {room.capacity} here
              </RoomFact>
              <RoomFact tone="warning">
                <time
                  data-countdown={lastWarning === 1 ? 'urgent' : 'normal'}
                  dateTime={room.expiresAt.toISOString()}
                >
                  {expiresInLabel(room.expiresAt)}
                </time>
              </RoomFact>
              {self.role === 'host' && (
                <button type="button" onClick={() => setSettingsOpen(true)}>
                  Room settings
                </button>
              )}
            </>
          }
          name={room.name}
          tags={room.tags}
        />

        <div className="room-stage">
          <section
            aria-label="Streams and members"
            className="room-stage__canvas"
            data-connection={realtime.connection}
          >
            <h2 className="visually-hidden">Streams and members</h2>
            <RoomMemberMosaic
              hostActions={
                self.role === 'host'
                  ? (member) => {
                      void banRoomMember({
                        data: { roomId: room.id, accountId: member.accountId },
                      })
                    }
                  : null
              }
              media={media}
              onReport={(member) =>
                setReport({
                  type: member.streamId ? 'stream' : 'account',
                  id: member.streamId ?? member.accountId,
                  label: member.displayName,
                })
              }
              roster={room.roster}
              selfMembershipId={self.id}
            />
          </section>

          {error && (
            <p className="form-error room-boundary__error" role="alert">
              {error}
            </p>
          )}

          <RoomControlShelf
            connection={realtime.connection}
            leavePending={pending}
            media={media}
            onLeave={leave}
          />
        </div>

        <RoomCompanionDock
          memberCount={room.memberCount}
          onDismissSheet={() => setSheet(null)}
          realtime={realtime}
          roomId={room.id}
          roster={room.roster}
          selfMembershipId={self.id}
          sheet={sheet}
        />

        {/* Below 768px this is the only room control surface (ADR 0103). */}
        <nav aria-label="Room controls" className="room-mobile-bar">
          <button
            data-disabled-reason={media.supported ? undefined : 'Desktop only'}
            disabled={!media.supported || realtime.connection !== 'live'}
            type="button"
            onClick={() => void media.startPublishing()}
          >
            {media.supported ? 'Stream' : 'Desktop only'}
          </button>
          {(['chat', 'people', 'activity'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setSheet((current) => (current === tab ? null : tab))}
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
