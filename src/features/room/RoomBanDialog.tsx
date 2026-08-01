import { useEffect, useRef, useState } from 'react'
import type { RoomRosterMember } from '../../server/rooms/room-roster'
import { banRoomMember } from './room-queries'
import { observeRoom } from './room-observability'

interface RoomBanDialogProps {
  readonly roomId: string
  readonly target: RoomRosterMember | null
  readonly onClose: () => void
}

export function RoomBanDialog({ roomId, target, onClose }: RoomBanDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !target || dialog.open) return
    dialog.showModal()
    cancelRef.current?.focus()
  }, [target])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || target) return
    if (dialog.open) dialog.close()
    setPending(false)
    setError(null)
  }, [target])

  if (!target) return null
  const titleId = `room-ban-title-${target.membershipId}`
  const consequenceId = `room-ban-consequence-${target.membershipId}`

  const cancel = () => {
    if (pending) return
    observeRoom({ name: 'room_ban_confirmation_cancelled', properties: {} })
    onClose()
  }

  const confirm = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    observeRoom({ name: 'room_ban_confirmation_confirmed', properties: {} })
    const result = await banRoomMember({
      data: { roomId, accountId: target.accountId },
    }).catch(() => null)
    setPending(false)
    if (result?.status === 'banned') {
      onClose()
      return
    }
    setError(
      result?.status === 'not-member'
        ? `${target.displayName} is no longer in this room.`
        : result?.status === 'ended'
          ? 'This room has ended.'
          : 'The Room Ban could not be applied. Your room is unchanged.',
    )
  }

  return (
    <dialog
      ref={dialogRef}
      aria-describedby={consequenceId}
      aria-labelledby={titleId}
      className="room-ban-dialog"
      onCancel={(event) => {
        event.preventDefault()
        cancel()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) cancel()
      }}
    >
      <div className="room-ban-dialog__panel">
        <p className="room-ban-dialog__eyebrow">Room Ban</p>
        <h2 id={titleId}>Ban {target.displayName} from this room?</h2>
        <p id={consequenceId}>
          {target.displayName} will be removed now. Their Stream and every related watch will
          stop, and they cannot re-enter until a Host clears this ban or the room ends.
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="room-ban-dialog__actions">
          <button ref={cancelRef} disabled={pending} type="button" onClick={cancel}>
            Cancel
          </button>
          <button
            aria-busy={pending}
            className="room-ban-dialog__confirm"
            disabled={pending}
            type="button"
            onClick={() => void confirm()}
          >
            {pending ? 'Banning…' : `Ban ${target.displayName}`}
          </button>
        </div>
      </div>
    </dialog>
  )
}
