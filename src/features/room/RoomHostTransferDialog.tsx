import { useEffect, useRef, useState } from 'react'
import type { RoomRosterMember } from '../../server/rooms/room-roster'
import { observeRoom } from './room-observability'
import { transferRoomHost } from './room-queries'

interface RoomHostTransferDialogProps {
  readonly roomId: string
  readonly target: RoomRosterMember | null
  readonly onClose: () => void
}

export function RoomHostTransferDialog({
  roomId,
  target,
  onClose,
}: RoomHostTransferDialogProps) {
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
  const titleId = `room-host-transfer-title-${target.membershipId}`
  const consequenceId = `room-host-transfer-consequence-${target.membershipId}`

  const cancel = () => {
    if (pending) return
    observeRoom({
      name: 'room_host_transfer_confirmation_cancelled',
      properties: {},
    })
    onClose()
  }

  const confirm = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    observeRoom({
      name: 'room_host_transfer_confirmation_confirmed',
      properties: {},
    })
    const result = await transferRoomHost({
      data: { roomId, accountId: target.accountId },
    }).catch(() => null)
    setPending(false)
    if (result?.status === 'transferred') {
      onClose()
      return
    }
    setError(
      result?.status === 'not-member'
        ? `${target.displayName} is no longer in this room.`
        : result?.status === 'ended'
          ? 'This room has ended.'
          : 'Host authority could not be transferred. Your room is unchanged.',
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
        <p className="room-ban-dialog__eyebrow">Host authority</p>
        <h2 id={titleId}>Transfer Host to {target.displayName}?</h2>
        <p id={consequenceId}>
          You will immediately lose Host controls, and {target.displayName} will gain them.
          Everyone stays in the room and current Streams and watches continue.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
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
            {pending ? 'Transferring…' : 'Transfer Host'}
          </button>
        </div>
      </div>
    </dialog>
  )
}
