import { useEffect, useId, useRef, useState } from 'react'
import type { RoomRosterMember } from '../../server/rooms/room-roster'
import { observeRoom } from './room-observability'

export type RoomMemberActionSurface = 'tile' | 'people'

interface RoomMemberActionsProps {
  readonly member: RoomRosterMember
  readonly surface: RoomMemberActionSurface
  readonly onReport: (member: RoomRosterMember) => void
  readonly onBan?: (member: RoomRosterMember) => void
  readonly onKick?: (member: RoomRosterMember) => void
  readonly onTransfer?: (member: RoomRosterMember) => void
  readonly onStopStream?: (member: RoomRosterMember) => void
}

/** One persistent, keyboard-operable safety menu shared by tiles and People.
    Host authority is represented by the presence of Host callbacks;
    unauthorized actions are not rendered into the DOM. */
export function RoomMemberActions({
  member,
  surface,
  onReport,
  onBan,
  onKick,
  onTransfer,
  onStopStream,
}: RoomMemberActionsProps) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const first = rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')
    first?.focus()
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus())
  }

  const openMenu = () => {
    setOpen(true)
    observeRoom({ name: 'room_member_menu_opened', properties: { surface } })
  }

  return (
    <div className="room-member-actions" ref={rootRef}>
      <button
        ref={triggerRef}
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Actions for ${member.displayName}`}
        className="room-member-actions__trigger"
        type="button"
        onClick={() => {
          if (open) close()
          else openMenu()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          if (!open) openMenu()
        }}
      >
        Actions
      </button>
      {open && (
        <div
          aria-label={`Actions for ${member.displayName}`}
          className="room-member-actions__menu"
          id={menuId}
          role="menu"
          onKeyDown={(event) => {
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
            const current = items.indexOf(document.activeElement as HTMLButtonElement)
            if (event.key === 'Escape') {
              event.preventDefault()
              close(true)
            } else if (event.key === 'Tab') {
              close()
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault()
              items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const direction = event.key === 'ArrowDown' ? 1 : -1
              items[(current + direction + items.length) % items.length]?.focus()
            }
          }}
        >
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              close(true)
              observeRoom({
                name: 'room_member_action_selected',
                properties: { surface, action: 'report' },
              })
              onReport(member)
            }}
          >
            Report
          </button>
          {onTransfer && (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                close(true)
                observeRoom({
                  name: 'room_member_action_selected',
                  properties: { surface, action: 'host_transfer' },
                })
                onTransfer(member)
              }}
            >
              Transfer Host…
            </button>
          )}
          {onStopStream && member.streamId !== null && (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                close(true)
                observeRoom({
                  name: 'room_member_action_selected',
                  properties: { surface, action: 'host_stream_stop' },
                })
                onStopStream(member)
              }}
            >
              Stop Stream…
            </button>
          )}
          {onKick && (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                close(true)
                observeRoom({
                  name: 'room_member_action_selected',
                  properties: { surface, action: 'kick' },
                })
                onKick(member)
              }}
            >
              Kick from room…
            </button>
          )}
          {onBan && (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                close(true)
                observeRoom({
                  name: 'room_member_action_selected',
                  properties: { surface, action: 'room_ban' },
                })
                onBan(member)
              }}
            >
              Ban from room…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
