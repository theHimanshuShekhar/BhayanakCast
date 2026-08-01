import { useEffect, useRef, useState } from 'react'
import type { RoomRosterMember } from '../../server/rooms/room-roster'
import { kickRoomMember } from './room-queries'
import { observeRoom } from './room-observability'

interface RoomKickDialogProps {
  readonly roomId: string
  readonly target: RoomRosterMember | null
  readonly onClose: () => void
}

export function RoomKickDialog({ roomId, target, onClose }: RoomKickDialogProps) {
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
  const titleId = `room-kick-title-${target.membershipId}`
  const consequenceId = `room-kick-consequence-${target.membershipId}`

  const cancel = () => {
    if (pending) return
    observeRoom({ name: 'room_kick_confirmation_cancelled', properties: {} })
    onClose()
  }

  const confirm = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    observeRoom({ name: 'room_kick_confirmation_confirmed', properties: {} })
    const result = await kickRoomMember({
      data: { roomId, accountId: target.accountId },
    }).catch(() => null)
    setPending(false)
    if (result?.status === 'kicked') {
      onClose()
      return
    }
    setError(
      result?.status === 'not-member'
        ? `${target.displayName} is no longer in this room.`
        : result?.status === 'ended'
          ? 'This room has ended.'
          : 'The member could not be kicked. Your room is unchanged.',
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
        <p className="room-ban-dialog__eyebrow">Remove current member</p>
        <h2 id={titleId}>Kick {target.displayName} from this room?</h2>
        <p id={consequenceId}>
          {target.displayName} will be removed now. Their Stream and every related watch will
          stop, but they can re-enter immediately if the room still allows them.
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
            {pending ? 'Kicking…' : `Kick ${target.displayName}`}
          </button>
        </div>
      </div>
    </dialog>
  )
}
