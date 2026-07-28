import { useThrottler } from '@tanstack/react-pacer'
import { useEffect, useRef, useState } from 'react'
import { orderRoomPeople, type RoomRosterMember } from '../../server/rooms/room-roster'
import { CHAT_BODY_LIMIT } from '../../server/rooms/chat-service'
import { sendChatMessage } from './room-queries'
import type { RoomRealtime } from './useRoomRealtime'

type DockTab = 'chat' | 'people' | 'activity'

interface PendingMessage {
  readonly mutationId: string
  readonly body: string
  readonly failed: boolean
}

/** ADR 0102's companion dock: persistent at ≥1280px, opening on Chat, with
    People and Activity beside it. Each tab keeps its own scroll for the room
    session, and the tabs you are not looking at carry an unread count instead
    of stealing focus. */
export function RoomCompanionDock({
  realtime,
  roomId,
  roster,
  selfMembershipId,
  memberCount,
  sheet,
  onDismissSheet,
}: Readonly<{
  realtime: RoomRealtime
  roomId: string
  roster: readonly RoomRosterMember[]
  selfMembershipId: string
  memberCount: number
  /** Below 768px the dock is a bottom sheet the control bar opens on a tab
      (ADR 0103); null means the desktop dock. */
  sheet: DockTab | null
  onDismissSheet: () => void
}>) {
  const [tab, setTab] = useState<DockTab>('chat')
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<readonly PendingMessage[]>([])
  const scrollPositions = useRef<Record<DockTab, number>>({
    chat: 0,
    people: 0,
    activity: 0,
  })
  const panelRef = useRef<HTMLDivElement | null>(null)
  const seen = useRef({ chat: realtime.messages.length, activity: 0 })
  const [unread, setUnread] = useState({ chat: 0, activity: 0 })

  useEffect(() => {
    if (tab === 'chat') {
      seen.current.chat = realtime.messages.length
      setUnread((current) => (current.chat === 0 ? current : { ...current, chat: 0 }))
      return
    }
    const missed = realtime.messages.length - seen.current.chat
    if (missed > 0) setUnread((current) => ({ ...current, chat: missed }))
  }, [realtime.messages.length, tab])

  useEffect(() => {
    if (tab === 'activity') {
      seen.current.activity = realtime.activity.length
      setUnread((current) => (current.activity === 0 ? current : { ...current, activity: 0 }))
      return
    }
    const missed = realtime.activity.length - seen.current.activity
    if (missed > 0) setUnread((current) => ({ ...current, activity: missed }))
  }, [realtime.activity.length, tab])

  useEffect(() => {
    if (sheet) setTab(sheet)
  }, [sheet])

  // Each tab keeps the place you left it rather than snapping to the bottom.
  useEffect(() => {
    const panel = panelRef.current
    if (panel) panel.scrollTop = scrollPositions.current[tab]
  }, [tab])

  // Typing presence is refreshed, not streamed: one signal per interval while
  // the composer is active, and an explicit stop when it is not (ADR 0102).
  const typingThrottler = useThrottler(
    (value: boolean) => realtime.setTyping(value),
    { wait: 2_000, leading: true, trailing: false },
  )

  const canonicalMutationIds = new Set(
    realtime.messages.map((message) => message.mutationId).filter(Boolean),
  )
  const visiblePending = pending.filter(
    (message) => !canonicalMutationIds.has(message.mutationId),
  )

  return (
    <aside
      aria-label="Room companions"
      className="room-dock"
      data-sheet={sheet ? (expanded ? 'expanded' : 'open') : 'docked'}
    >
      {sheet && (
        <div className="room-dock__sheet-controls">
          <button type="button" onClick={() => setExpanded((current) => !current)}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
          <button type="button" onClick={onDismissSheet}>
            Close
          </button>
        </div>
      )}
      <div className="room-dock__tabs" role="tablist">
        <DockTabButton
          active={tab === 'chat'}
          badge={unread.chat}
          label="Chat"
          onSelect={() => selectTab('chat')}
        />
        <DockTabButton
          active={tab === 'people'}
          badge={memberCount}
          badgeTone="count"
          label="People"
          onSelect={() => selectTab('people')}
        />
        <DockTabButton
          active={tab === 'activity'}
          badge={unread.activity}
          label="Activity"
          onSelect={() => selectTab('activity')}
        />
      </div>

      <div
        className="room-dock__panel"
        ref={panelRef}
        role="tabpanel"
        onScroll={(event) => {
          scrollPositions.current[tab] = event.currentTarget.scrollTop
        }}
      >
        {tab === 'chat' && (
          <ul className="room-chat__log">
            {realtime.messages.map((message) => (
              <li className="room-chat__message" key={message.id}>
                <p className="room-chat__author">{message.displayName}</p>
                <p className="room-chat__body">{message.body}</p>
              </li>
            ))}
            {visiblePending.map((message) => (
              <li
                className="room-chat__message"
                data-message-state={message.failed ? 'failed' : 'pending'}
                key={message.mutationId}
              >
                <p className="room-chat__body">{message.body}</p>
                {message.failed ? (
                  <p className="room-chat__failure">
                    Not sent.{' '}
                    <button type="button" onClick={() => void send(message)}>
                      Retry
                    </button>{' '}
                    <button type="button" onClick={() => discard(message.mutationId)}>
                      Discard
                    </button>
                  </p>
                ) : (
                  <p className="room-chat__pending">Sending…</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {tab === 'people' && (
          <ul className="room-people">
            {orderRoomPeople(roster, selfMembershipId).map((member) => (
              <li className="room-people__member" key={member.membershipId}>
                <span className="room-people__name">{member.displayName}</span>
                <span className="room-people__state">
                  {[
                    member.role === 'host' ? 'Host' : null,
                    member.membershipId === selfMembershipId ? 'You' : null,
                    member.streamId ? 'Streaming' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}

        {tab === 'activity' && (
          <ul className="room-activity">
            {realtime.activity.length === 0 && (
              // Activity begins empty on admission: it is what happened while
              // you were here, not a history of the room (ADR 0102).
              <li className="room-activity__empty">Nothing has happened yet.</li>
            )}
            {realtime.activity.map((entry) => (
              <li
                className="room-activity__entry"
                data-activity-kind={entry.kind}
                data-activity-prominence={entry.minutes === 1 ? 'warning' : 'normal'}
                key={entry.id}
              >
                {activityLabel(entry.kind, entry.displayName, entry.minutes)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {tab === 'chat' && (
        <form
          className="room-chat__composer"
          onSubmit={(event) => {
            event.preventDefault()
            const body = draft.trim()
            if (!body) return
            setDraft('')
            typingThrottler.cancel()
            realtime.setTyping(false)
            void send({ mutationId: crypto.randomUUID(), body, failed: false })
          }}
        >
          {realtime.typing.length > 0 && (
            <p className="room-chat__typing" role="status">
              {typingLabel(realtime.typing.map((member) => member.displayName))}
            </p>
          )}
          <label className="visually-hidden" htmlFor="room-chat-input">
            Message
          </label>
          <textarea
            id="room-chat-input"
            maxLength={CHAT_BODY_LIMIT}
            rows={2}
            value={draft}
            onBlur={() => realtime.setTyping(false)}
            onChange={(event) => {
              setDraft(event.target.value)
              if (event.target.value.trim()) typingThrottler.maybeExecute(true)
              else realtime.setTyping(false)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }}
          />
          <p className="room-chat__count tabular-nums">
            {draft.length} / {CHAT_BODY_LIMIT}
          </p>
          <button disabled={draft.trim().length === 0} type="submit">
            Send
          </button>
        </form>
      )}
    </aside>
  )

  function selectTab(next: DockTab) {
    const panel = panelRef.current
    if (panel) scrollPositions.current[tab] = panel.scrollTop
    setTab(next)
  }

  function discard(mutationId: string) {
    setPending((current) => current.filter((entry) => entry.mutationId !== mutationId))
  }

  /** Retry reuses the original mutation identity so a message that did commit
      before the failure is never posted twice (ADR 0102). */
  async function send(message: PendingMessage) {
    setPending((current) => [
      ...current.filter((entry) => entry.mutationId !== message.mutationId),
      { ...message, failed: false },
    ])
    const result = await sendChatMessage({
      data: { roomId, body: message.body, mutationId: message.mutationId },
    }).catch(() => null)
    if (result?.status === 'sent') {
      discard(message.mutationId)
      return
    }
    setPending((current) =>
      current.map((entry) =>
        entry.mutationId === message.mutationId ? { ...entry, failed: true } : entry,
      ),
    )
  }
}

function DockTabButton({
  active,
  badge,
  badgeTone = 'unread',
  label,
  onSelect,
}: Readonly<{
  active: boolean
  badge: number
  badgeTone?: 'unread' | 'count'
  label: string
  onSelect: () => void
}>) {
  return (
    <button
      aria-selected={active}
      className="room-dock__tab"
      role="tab"
      type="button"
      onClick={onSelect}
    >
      {label}
      {badge > 0 && (
        <span className="room-dock__badge" data-badge-tone={badgeTone}>
          {badge}
        </span>
      )}
    </button>
  )
}

function typingLabel(names: readonly string[]) {
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
  return 'Several people are typing…'
}

function activityLabel(
  kind: string,
  displayName: string | null,
  minutes: 30 | 10 | 1 | undefined,
) {
  const who = displayName ?? 'Someone'
  switch (kind) {
    case 'member-joined':
      return `${who} joined.`
    case 'member-left':
      return `${who} left.`
    case 'stream-started':
      return `${who} started streaming.`
    case 'stream-stopped':
      return `${who} stopped streaming.`
    case 'host-transferred':
      return `${who} is now the Host.`
    // Deliberately bare: ADR 0103 keeps enforcement detail out of the room.
    case 'member-removed':
      return `${who} is no longer in this room.`
    case 'room-warning':
      return `This room ends in ${minutes ?? 1} minute${minutes === 1 ? '' : 's'}.`
    default:
      return ''
  }
}
