import { useEffect, useId, useRef, useState } from 'react'
import type { RoomChatMessage } from '../../server/realtime/room-events'
import { observeRoom } from './room-observability'

interface RoomMessageActionsProps {
  readonly message: RoomChatMessage
  readonly onMute: (message: RoomChatMessage) => void
  readonly onReport: (message: RoomChatMessage) => void
}

/** Persistent message safety actions using the same keyboard menu contract as
    member and tile actions. Message content never enters the action callbacks
    or analytics payloads. */
export function RoomMessageActions({
  message,
  onMute,
  onReport,
}: RoomMessageActionsProps) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
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
    observeRoom({ name: 'room_message_menu_opened', properties: {} })
  }

  return (
    <div className="room-message-actions" ref={rootRef}>
      <button
        ref={triggerRef}
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Actions for message from ${message.displayName}`}
        className="room-message-actions__trigger"
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
          aria-label={`Actions for message from ${message.displayName}`}
          className="room-message-actions__menu"
          id={menuId}
          role="menu"
          onKeyDown={(event) => {
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
            ]
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
                name: 'room_message_action_selected',
                properties: { action: 'report' },
              })
              onReport(message)
            }}
          >
            Report message…
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              close(true)
              observeRoom({
                name: 'room_message_action_selected',
                properties: { action: 'mute' },
              })
              onMute(message)
            }}
          >
            Mute {message.displayName}’s chat
          </button>
        </div>
      )}
    </div>
  )
}
