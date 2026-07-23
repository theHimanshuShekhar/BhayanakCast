import { useEffect, useRef } from 'react'
import type { MembershipConfirmation } from '../../server/rooms/room-service'

interface MembershipConsequencesDialogProps {
  readonly open: boolean
  readonly confirmation: MembershipConfirmation | null
  readonly pending?: boolean
  readonly error?: string | null
  readonly onCancel: () => void
  readonly onConfirm: (confirmation: MembershipConfirmation) => void
}

export function MembershipConsequencesDialog({
  open,
  confirmation,
  pending = false,
  error,
  onCancel,
  onConfirm,
}: MembershipConsequencesDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !open || dialog.open) return
    dialog.showModal()
    cancelRef.current?.focus()
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || open) return
    if (dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
      )]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener('keydown', onKeyDown)
    return () => dialog.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!confirmation) return null
  const consequences = new Set(confirmation.consequences)
  const effects = [
    ...(consequences.has('stop-stream') ? ['The current Stream will stop.'] : []),
    ...(consequences.has('transfer-host') ? ['You will give up Host authority.'] : []),
  ]
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="membership-consequences-title"
      className="membership-consequences-dialog"
      onCancel={(event) => {
        event.preventDefault()
        if (!pending) onCancel()
      }}
      onClick={(event) => {
        if (!pending && event.target === event.currentTarget) onCancel()
      }}
    >
      <form method="dialog" className="membership-consequences-dialog__panel">
        <h2 id="membership-consequences-title">Confirm room change</h2>
        <p>This action affects your current room membership.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <ul>
          {effects.map((effect) => <li key={effect}>{effect}</li>)}
        </ul>
        <div className="membership-consequences-dialog__actions">
          <button ref={cancelRef} disabled={pending} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            aria-busy={pending}
            disabled={pending}
            type="button"
            onClick={() => onConfirm(confirmation)}
          >
            {pending ? 'Confirming…' : 'Confirm'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
