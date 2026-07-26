import { useEffect, useRef, type SyntheticEvent } from 'react'

interface DeletionConfirmationProps {
  readonly open: boolean
  readonly busy?: boolean
  readonly error?: string
  readonly onConfirm: () => void
  readonly onCancel: (event: SyntheticEvent<Element>) => void
}

export function DeletionConfirmation({
  open,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: DeletionConfirmationProps) {
  const handleCancel = (event: SyntheticEvent<Element>) => {
    if (busy) {
      event.preventDefault()
      return
    }
    onCancel(event)
  }
  const dialogRef = useRef<HTMLDialogElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
    if (open) keepRef.current?.focus()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      aria-describedby="deletion-consequences"
      aria-labelledby="deletion-confirmation-heading"
      onCancel={handleCancel}
    >
      <form method="dialog" onSubmit={(event) => event.preventDefault()}>
        <h2 id="deletion-confirmation-heading">Request account deletion</h2>
        <p id="deletion-consequences">
          This takes effect immediately: your public profile, statistics, past rooms,
          co-user presence, and Home profile search entry will be hidden. You will be
          read-only, leave current rooms and streams through normal host handoff, and
          cannot create or join rooms, chat, stream, report, moderate, or start new
          membership while this request is pending.
        </p>
        <p>
          Account-deletion terms: review is manual and has no promised SLA; you can
          cancel only while pending; approval is irreversible and revokes sessions;
          approved data handling follows the account retention and deletion policy.
          These terms apply only to deletion and do not gate ordinary participation.
        </p>
        {error ? <p role="alert">{error}</p> : null}
        <div>
          <button ref={keepRef} type="button" onClick={handleCancel} disabled={busy}>
            Keep my account
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}>
            {busy ? 'Submitting deletion request…' : 'Request deletion now'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
