import { useThrottler } from '@tanstack/react-pacer'
import { Activity, MessageCircle, PanelRightClose, PanelRightOpen, Users } from 'lucide-react'
import {
  useEffect,
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { orderRoomPeople, type RoomRosterMember } from '../../server/rooms/room-roster'
import {
  CHAT_BODY_LIMIT,
  chatCharacterCount,
  type RoomChatMessage,
} from '../../server/realtime/room-events'
import {
  getCurrentViewerMuteIds,
  muteAccount,
} from '../../server/profile/chat-mute-service'
import type { RoomMedia } from './useRoomMedia'
import { tileStateFragments } from './RoomMemberMosaic'
import type { RoomRealtime } from './useRoomRealtime'
import { observeRoom } from './room-observability'
import { RoomMemberActions } from './RoomMemberActions'
import { RoomMessageActions } from './RoomMessageActions'

const ACTIVITY_TIME_FORMATTER = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
})

export function formatActivityTime(value: string): string | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : ACTIVITY_TIME_FORMATTER.format(date)
}
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
  canChat,
  roster,
  selfMembershipId,
  media,
  memberCount,
  sheet,
  onDismissSheet,
  onReport,
  onReportMessage,
  hostActions,
  onKickMember,
  onTransferHost,
  onStopStream,
}: Readonly<{
  realtime: RoomRealtime
  canChat: boolean
  roster: readonly RoomRosterMember[]
  selfMembershipId: string
  media: Pick<RoomMedia, 'compatibility' | 'localStream'>
  memberCount: number
  /** People rows carry the same member and Host actions as the tiles, so
      safety never depends on hover or on a particular panel (ADR 0102). */
  onReport: (member: RoomRosterMember) => void
  onReportMessage: (message: RoomChatMessage) => void
  hostActions: ((member: RoomRosterMember) => void) | null
  onKickMember: ((member: RoomRosterMember) => void) | null
  onTransferHost: ((member: RoomRosterMember) => void) | null
  onStopStream: ((member: RoomRosterMember) => void) | null
  /** Below 768px the dock is a bottom sheet the control bar opens on a tab. */
  sheet: DockTab | null
  onDismissSheet: (reason: 'control' | 'escape') => void
}>) {
  const [tab, setTab] = useState<DockTab>('chat')
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<readonly PendingMessage[]>([])
  const [mutedAccountIds, setMutedAccountIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [chatStatus, setChatStatus] = useState<string | null>(null)
  const stage = useCompanionStage()
  const visible = stage === 'mobile' ? sheet !== null : open
  const panelId = useId()
  const tabRefs = useRef<Record<DockTab, HTMLButtonElement | null>>({
    chat: null,
    people: null,
    activity: null,
  })
  const scrollPositions = useRef<Record<DockTab, number>>({
    chat: 0,
    people: 0,
    activity: 0,
  })
  const chatPositioned = useRef(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const chatFollowing = useRef(true)
  const typingActive = useRef(false)
  const seen = useRef({ chat: realtime.messages.length, activity: 0 })
  const [unread, setUnread] = useState({ chat: 0, activity: 0 })
  const [newActivity, setNewActivity] = useState(false)
  const [newMessages, setNewMessages] = useState(false)
  const selfAccountId = roster.find(
    (member) => member.membershipId === selfMembershipId,
  )?.accountId
  const visibleMessages = realtime.messages.filter(
    (message) => !mutedAccountIds.has(message.accountId),
  )
  const dismiss = useCallback(
    (reason: 'control' | 'escape') => {
      const surface =
        stage === 'wide' ? 'dock' : stage === 'medium' ? 'drawer' : 'sheet'
      observeRoom({
        name: 'room_companion_closed',
        properties: { surface, reason },
      })
      if (stage === 'mobile') {
        onDismissSheet(reason)
        return
      }
      setOpen(false)
      requestAnimationFrame(() => tabRefs.current[tab]?.focus())
    },
    [onDismissSheet, stage, tab],
  )

  useEffect(() => {
    const missed = visibleMessages.length - seen.current.chat
    seen.current.chat = visibleMessages.length
    if (missed <= 0) return
    if (tab === 'chat' && visible && chatFollowing.current) {
      requestAnimationFrame(() => {
        const panel = panelRef.current
        if (panel) panel.scrollTop = panel.scrollHeight
      })
      setUnread((current) => (current.chat === 0 ? current : { ...current, chat: 0 }))
      return
    }
    chatFollowing.current = false
    setNewMessages(true)
    setUnread((current) => ({ ...current, chat: current.chat + missed }))
  }, [visibleMessages.length, tab, visible])

  useEffect(() => {
    if (tab === 'activity' && visible) {
      seen.current.activity = realtime.activity.length
      setUnread((current) => (current.activity === 0 ? current : { ...current, activity: 0 }))
      if (!atBottom(panelRef.current)) setNewActivity(true)
      return
    }
    const missed = realtime.activity.length - seen.current.activity
    if (missed > 0) setUnread((current) => ({ ...current, activity: missed }))
  }, [realtime.activity.length, tab, visible])

  useEffect(() => {
    if (sheet) setTab(sheet)
  }, [sheet])

  // Each tab keeps the place you left it rather than snapping to the bottom.
  useEffect(() => {
    const panel = panelRef.current
    if (panel) panel.scrollTop = scrollPositions.current[tab]
  }, [tab])
  useEffect(() => {
    if (chatPositioned.current || tab !== 'chat' || !visible) return
    chatPositioned.current = true
    requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      panel.scrollTop = panel.scrollHeight
      scrollPositions.current.chat = panel.scrollTop
    })
  }, [tab, visible])


  useEffect(() => {
    if (!visible || stage === 'wide') return
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      dismiss('escape')
    }
    document.addEventListener('keydown', dismissOnEscape)
    return () => document.removeEventListener('keydown', dismissOnEscape)
  }, [dismiss, stage, visible])

  useEffect(() => {
    let active = true
    void getCurrentViewerMuteIds()
      .then((accountIds) => {
        if (active) setMutedAccountIds(new Set(accountIds))
      })
      .catch(() => {
        if (active) setChatStatus('Muted chat preferences could not be loaded.')
      })
    return () => {
      active = false
    }
  }, [])

  // Typing presence is refreshed, not streamed: one signal per interval while
  // the composer is active, and an explicit stop when it is not (ADR 0102).
  const typingThrottler = useThrottler(
    (value: boolean) => realtime.setTyping(value),
    { wait: 2_000, leading: true, trailing: true },
  )
  const stopTyping = () => {
    typingThrottler.cancel()
    if (!typingActive.current) return
    typingActive.current = false
    realtime.setTyping(false)
    observeRoom({ name: 'room_chat_typing_changed', properties: { typing: false } })
  }
  const refreshTyping = () => {
    if (!typingActive.current) {
      typingActive.current = true
      observeRoom({ name: 'room_chat_typing_changed', properties: { typing: true } })
    }
    typingThrottler.maybeExecute(true)
  }

  useEffect(() => {
    if (realtime.connection !== 'live') stopTyping()
  }, [realtime.connection])

  useEffect(
    () => () => {
      typingThrottler.cancel()
      realtime.setTyping(false)
    },
    [],
  )

  const canonicalMutationIds = new Set(
    realtime.messages.map((message) => message.mutationId).filter(Boolean),
  )
  const visiblePending = pending.filter(
    (message) => !canonicalMutationIds.has(message.mutationId),
  )
  const visibleTyping = realtime.typing.filter(
    (member) => !mutedAccountIds.has(member.accountId),
  )
  const draftCount = chatCharacterCount(draft)
  const composerStatus =
    !canChat
      ? 'Chat is unavailable on your account. Existing messages remain available.'
      : realtime.connection === 'reconnecting'
        ? 'Chat is reconnecting. Sending is unavailable.'
        : realtime.connection === 'lost'
          ? 'Chat is unavailable. Rejoin the room to send.'
          : draftCount > CHAT_BODY_LIMIT
            ? `Message is ${draftCount - CHAT_BODY_LIMIT} characters too long.`
            : null

  useEffect(() => {
    if (
      visiblePending.length === 0 ||
      tab !== 'chat' ||
      !visible ||
      !chatFollowing.current
    ) {
      return
    }
    requestAnimationFrame(() => {
      const panel = panelRef.current
      if (panel) panel.scrollTop = panel.scrollHeight
    })
  }, [visiblePending.length, tab, visible])

  return (
    <aside
      aria-label="Room companions"
      className="room-dock"
      id="room-companions"
      data-open={visible}
      data-sheet={sheet ? (expanded ? 'expanded' : 'open') : 'docked'}
      data-stage={stage}
    >
      {sheet && (
        <div className="room-dock__sheet-controls">
          <div className="room-dock__heading">
            <span aria-hidden="true" className="room-dock__presence" />
            <span>Room companions</span>
            <span className="room-dock__here">{memberCount} here</span>
          </div>
          <button
            aria-label={expanded ? 'Collapse companion sheet to 55%' : 'Expand companion sheet to 90%'}
            type="button"
            onClick={() => {
              const next = !expanded
              setExpanded(next)
              observeRoom({
                name: 'room_companion_resized',
                properties: { height: next ? '90' : '55' },
              })
            }}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
          <button type="button" onClick={() => dismiss('control')}>
            Close
          </button>
        </div>
      )}
      {!sheet && (
        <div className="room-dock__desktop-controls">
          {open && (
            <div className="room-dock__heading">
              <span aria-hidden="true" className="room-dock__presence" />
              <span>Room companions</span>
              <span className="room-dock__here">{memberCount} here</span>
            </div>
          )}
          <button
            aria-controls={panelId}
            aria-expanded={open}
            aria-label={open ? (stage === 'wide' ? 'Collapse dock' : 'Close') : 'Expand dock'}
            className="room-dock__collapse"
            data-tooltip={open ? undefined : 'Expand dock'}
            title={open ? undefined : 'Expand dock'}
            type="button"
            onClick={() => {
              if (open) {
                dismiss('control')
                return
              }
              setOpen(true)
              observeRoom({
                name: 'room_companion_opened',
                properties: {
                  surface: stage === 'wide' ? 'dock' : 'drawer',
                  tab,
                },
              })
            }}
          >
            {open ? (
              <>
                <PanelRightClose aria-hidden="true" size={18} />
                <span className="room-dock__wide-label">Collapse dock</span>
                <span className="room-dock__medium-label">Close</span>
              </>
            ) : (
              <>
                <PanelRightOpen aria-hidden="true" size={18} />
                <span className="visually-hidden">Expand dock</span>
              </>
            )}
          </button>
        </div>
      )}
      <div className="room-dock__tabs" role="tablist">
        <DockTabButton
          active={tab === 'chat'}
          badge={unread.chat}
          buttonRef={(node) => {
            tabRefs.current.chat = node
          }}
          controls={panelId}
          label="Chat"
          onKeyDown={navigateTabs}
          onSelect={() => selectTab('chat')}
          tab="chat"
        />
        <DockTabButton
          active={tab === 'people'}
          badge={memberCount}
          badgeTone="count"
          buttonRef={(node) => {
            tabRefs.current.people = node
          }}
          controls={panelId}
          label="People"
          onKeyDown={navigateTabs}
          onSelect={() => selectTab('people')}
          tab="people"
        />
        <DockTabButton
          active={tab === 'activity'}
          badge={unread.activity}
          buttonRef={(node) => {
            tabRefs.current.activity = node
          }}
          controls={panelId}
          label="Activity"
          onKeyDown={navigateTabs}
          onSelect={() => selectTab('activity')}
          tab="activity"
        />
      </div>

      <div
        aria-labelledby={`${panelId}-${tab}`}
        className="room-dock__panel"
        hidden={!visible}
        id={panelId}
        ref={panelRef}
        role="tabpanel"
        tabIndex={0}
        onScroll={(event) => {
          scrollPositions.current[tab] = event.currentTarget.scrollTop
          if (tab === 'chat') {
            chatFollowing.current = atBottom(event.currentTarget)
            if (chatFollowing.current) {
              setNewMessages(false)
              setUnread((current) =>
                current.chat === 0 ? current : { ...current, chat: 0 },
              )
            }
          }
          if (tab === 'activity' && atBottom(event.currentTarget)) setNewActivity(false)
        }}
      >
        {tab === 'chat' && (
          <ul className="room-chat__log">
            {visibleMessages.length === 0 && visiblePending.length === 0 && (
              <li className="room-chat__empty">
                <MessageCircle aria-hidden="true" className="room-chat__empty-icon" size={20} />
                <span className="room-chat__empty-copy">
                  <strong>No messages yet</strong>
                  <span>Say hello when you’re ready.</span>
                </span>
              </li>
            )}
            {visibleMessages.map((message) => (
              <li className="room-chat__message" key={message.id}>
                <div className="room-chat__message-heading">
                  <p className="room-chat__author">{message.displayName}</p>
                  {message.accountId !== selfAccountId && (
                    <RoomMessageActions
                      message={message}
                      onMute={(target) => void muteChat(target)}
                      onReport={onReportMessage}
                    />
                  )}
                </div>
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
                    <button type="button" onClick={() => void send(message, 'retry')}>
                      Retry
                    </button>{' '}
                    <button type="button" onClick={() => discard(message.mutationId, true)}>
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
                <span className="room-people__avatar" aria-hidden="true">
                  {member.avatarUrl ? (
                    <img alt="" loading="lazy" src={member.avatarUrl} />
                  ) : (
                    member.displayName.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="room-people__identity">
                  <span className="room-people__name">{member.displayName}</span>
                  <span className="room-people__state">
                    {tileStateFragments({
                      role: member.role,
                      you: member.membershipId === selfMembershipId,
                      sharing:
                        member.streamId !== null &&
                        !(
                          member.membershipId === selfMembershipId &&
                          media.localStream === null
                        ),
                      watching: false,
                      selfCaptureLost:
                        member.membershipId === selfMembershipId &&
                        member.streamId !== null &&
                        media.localStream === null,
                      reconnecting:
                        member.reconnecting ||
                        (member.membershipId === selfMembershipId &&
                          realtime.connection === 'reconnecting'),
                      compatibility:
                        member.membershipId === selfMembershipId && member.streamId === null
                          ? media.compatibility
                          : null,
                    }).map((fragment, index) => (
                      <span data-state-tone={fragment.tone} key={fragment.text}>
                        {index > 0 && ' · '}
                        {fragment.text}
                      </span>
                    ))}
                  </span>
                </span>
                {member.membershipId !== selfMembershipId && (
                  <RoomMemberActions
                    member={member}
                    onBan={hostActions ?? undefined}
                    onKick={onKickMember ?? undefined}
                    onReport={onReport}
                    onStopStream={onStopStream ?? undefined}
                    onTransfer={onTransferHost ?? undefined}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {tab === 'activity' && (
          <ul className="room-activity">
          {/* Activity begins at admission: it is what happened while you were
              here, not a history of the room (ADR 0102). */}
            {realtime.activity.length === 0 && (
              <li className="room-activity__empty">Nothing has happened yet.</li>
            )}
            {realtime.activity.map((entry) => {
              const time = formatActivityTime(entry.at)
              return (
                <li
                  className="room-activity__entry"
                  data-activity-kind={entry.kind}
                  data-activity-prominence={entry.minutes === 1 ? 'warning' : 'normal'}
                  key={entry.id}
                >
                  <span className="room-activity__label">
                    {activityLabel(entry.kind, entry.displayName, entry.minutes)}
                  </span>
                  {time !== null && (
                    <time className="room-activity__time" dateTime={entry.at}>
                      {time}
                    </time>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {visible && tab === 'chat' && newMessages && (
        <button className="room-chat__cue" type="button" onClick={scrollToLatestChat}>
          New messages
        </button>
      )}

      {visible && tab === 'activity' && newActivity && (
        <button className="room-activity__cue" type="button" onClick={scrollToLatestActivity}>
          New activity
        </button>
      )}

      {visible && tab === 'chat' && (
        <form
          className="room-chat__composer"
          onSubmit={(event) => {
            event.preventDefault()
            const body = draft
            if (!canChat || !body.trim() || draftCount > CHAT_BODY_LIMIT || realtime.connection !== 'live') {
              return
            }
            setDraft('')
            stopTyping()
            void send(
              { mutationId: crypto.randomUUID(), body, failed: false },
              'composer',
            )
          }}
        >
          {visibleTyping.length > 0 && (
            <p className="room-chat__typing" role="status">
              {typingLabel(visibleTyping.map((member) => member.displayName))}
            </p>
          )}
          {chatStatus && (
            <p className="room-chat__status" role="status">
              {chatStatus}
            </p>
          )}
          {composerStatus && (
            <p className="room-chat__availability" id="room-chat-availability" role="status">
              {composerStatus}
            </p>
          )}
          <label className="visually-hidden" htmlFor="room-chat-input">
            Message the room
          </label>
          <textarea
            aria-describedby={
              composerStatus
                ? 'room-chat-availability room-chat-guidance'
                : 'room-chat-guidance'
            }
            disabled={!canChat || realtime.connection !== 'live'}
            id="room-chat-input"
            placeholder="Say hello to the room"
            rows={2}
            value={draft}
            onBlur={stopTyping}
            onFocus={() => {
              if (stage !== 'mobile' || expanded) return
              setExpanded(true)
              observeRoom({
                name: 'room_companion_resized',
                properties: { height: '90' },
              })
            }}
            onChange={(event) => {
              setDraft(event.target.value)
              if (event.target.value.trim() && realtime.connection === 'live') refreshTyping()
              else stopTyping()
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }}
          />
          <button
            disabled={
              draft.trim().length === 0 ||
              draftCount > CHAT_BODY_LIMIT ||
              !canChat ||
              realtime.connection !== 'live'
            }
            type="submit"
          >
            Send
          </button>
          <p className="room-chat__guidance" id="room-chat-guidance">
            Enter to send · Shift+Enter for a new line
          </p>
          {draftCount >= 450 && (
            <p
              className="room-chat__count tabular-nums"
              data-over-limit={draftCount > CHAT_BODY_LIMIT}
            >
              {draftCount} / {CHAT_BODY_LIMIT} characters
            </p>
          )}
        </form>
      )}
    </aside>
  )

  function selectTab(next: DockTab) {
    const panel = panelRef.current
    const returningToUnreadChat =
      next === 'chat' && unread.chat > 0 && (!visible || tab !== 'chat')
    if (panel) scrollPositions.current[tab] = panel.scrollTop
    const surface = stage === 'wide' ? 'dock' : stage === 'medium' ? 'drawer' : 'sheet'
    if (!visible) {
      setOpen(true)
      observeRoom({
        name: 'room_companion_opened',
        properties: { surface, tab: next },
      })
    } else if (next !== tab) {
      observeRoom({
        name: 'room_companion_tab_selected',
        properties: { surface, tab: next },
      })
    }
    setTab(next)
    if (returningToUnreadChat) {
      chatFollowing.current = true
      setNewMessages(false)
      setUnread((current) => ({ ...current, chat: 0 }))
      requestAnimationFrame(() => {
        const chatPanel = panelRef.current
        if (chatPanel) chatPanel.scrollTop = chatPanel.scrollHeight
      })
    }
  }


  function navigateTabs(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const tabs: readonly DockTab[] = ['chat', 'people', 'activity']
    let next: DockTab | undefined
    if (event.key === 'Home') next = tabs[0]
    else if (event.key === 'End') next = tabs.at(-1)
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = tabs[(tabs.indexOf(tab) + 1) % tabs.length]
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = tabs[(tabs.indexOf(tab) - 1 + tabs.length) % tabs.length]
    }
    if (!next) return
    event.preventDefault()
    selectTab(next)
    tabRefs.current[next]?.focus()
  }

  function scrollToLatestChat() {
    const panel = panelRef.current
    if (panel) {
      panel.scrollTop = panel.scrollHeight
      scrollPositions.current.chat = panel.scrollTop
    }
    chatFollowing.current = true
    setNewMessages(false)
    setUnread((current) => (current.chat === 0 ? current : { ...current, chat: 0 }))
    observeRoom({ name: 'room_chat_new_messages_opened', properties: {} })
  }

  function scrollToLatestActivity() {
    const panel = panelRef.current
    if (panel) panel.scrollTop = panel.scrollHeight
    setNewActivity(false)
  }

  function discard(mutationId: string, observed = false) {
    setPending((current) => current.filter((entry) => entry.mutationId !== mutationId))
    if (observed) observeRoom({ name: 'room_chat_failed_discarded', properties: {} })
  }

  /** Retry reuses the original mutation identity so a message that did commit
      before the failure is never posted twice (ADR 0102). */
  async function send(message: PendingMessage, trigger: 'composer' | 'retry') {
    setPending((current) => [
      ...current.filter((entry) => entry.mutationId !== message.mutationId),
      { ...message, failed: false },
    ])
    const result = await realtime.sendMessage(message.body, message.mutationId)
    if (result.status === 'sent') {
      realtime.replaceMessage(message.mutationId, result.message)
      discard(message.mutationId)
      observeRoom({
        name: 'room_chat_send',
        properties: { trigger, outcome: 'sent' },
      })
      return
    }
    setPending((current) =>
      current.map((entry) =>
        entry.mutationId === message.mutationId ? { ...entry, failed: true } : entry,
      ),
    )
    observeRoom({
      name: 'room_chat_send',
      properties: {
        trigger,
        outcome: result.status === 'unavailable' ? 'unavailable' : 'failed',
      },
    })
  }

  async function muteChat(message: RoomChatMessage) {
    setChatStatus(`Muting ${message.displayName}’s chat…`)
    try {
      await muteAccount({ data: { accountId: message.accountId } })
      setMutedAccountIds((current) => new Set([...current, message.accountId]))
      setChatStatus(
        `${message.displayName}’s chat is muted. Presence and streams are unchanged.`,
      )
      observeRoom({
        name: 'room_chat_mute_changed',
        properties: { outcome: 'muted' },
      })
    } catch {
      setChatStatus(`Could not mute ${message.displayName}’s chat. Try again.`)
      observeRoom({
        name: 'room_chat_mute_changed',
        properties: { outcome: 'failed' },
      })
    }
  }
}

/** Within a line of the newest entry still counts as reading the latest, so
    the cue never appears for a scroll position that is already at the end. */
export function atBottom(
  panel: Pick<HTMLElement, 'scrollTop' | 'clientHeight' | 'scrollHeight'> | null,
): boolean {
  if (!panel) return true
  return panel.scrollHeight - panel.scrollTop - panel.clientHeight <= 24
}

function DockTabButton({
  active,
  badge,
  badgeTone = 'unread',
  buttonRef,
  controls,
  label,
  onKeyDown,
  onSelect,
  tab,
}: Readonly<{
  active: boolean
  badge: number
  badgeTone?: 'unread' | 'count'
  buttonRef: (node: HTMLButtonElement | null) => void
  controls: string
  label: string
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
  onSelect: () => void
  tab: DockTab
}>) {
  return (
    <button
      aria-controls={controls}
      aria-selected={active}
      className="room-dock__tab"
      data-tooltip={label}
      id={`${controls}-${tab}`}
      ref={buttonRef}
      role="tab"
      tabIndex={active ? 0 : -1}
      type="button"
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      {tab === 'chat' ? (
        <MessageCircle aria-hidden="true" size={18} />
      ) : tab === 'people' ? (
        <Users aria-hidden="true" size={18} />
      ) : (
        <Activity aria-hidden="true" size={18} />
      )}
      <span className="room-dock__tab-label">{label}</span>
      {badge > 0 && (
        <span className="room-dock__badge" data-badge-tone={badgeTone}>
          {badge}
        </span>
      )}
    </button>
  )
}

type CompanionStage = 'mobile' | 'medium' | 'wide'

function useCompanionStage(): CompanionStage {
  const [stage, setStage] = useState<CompanionStage>('wide')
  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 47.999rem)')
    const wide = window.matchMedia('(min-width: 80rem)')
    const update = () => {
      setStage(mobile.matches ? 'mobile' : wide.matches ? 'wide' : 'medium')
    }
    update()
    mobile.addEventListener('change', update)
    wide.addEventListener('change', update)
    return () => {
      mobile.removeEventListener('change', update)
      wide.removeEventListener('change', update)
    }
  }, [])
  return stage
}

function typingLabel(names: readonly string[]) {
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
  const others = names.length - 2
  return `${names[0]}, ${names[1]}, and ${others} ${others === 1 ? 'other' : 'others'} are typing…`
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
