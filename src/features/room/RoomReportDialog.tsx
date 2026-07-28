import { useState } from 'react'
import {
  REPORT_DETAILS_LIMIT,
  REPORT_REASONS,
  type ReportReason,
} from '../../server/moderation/report-policy'
import { submitRoomReport } from './room-queries'

const REASON_LABELS: Readonly<Record<ReportReason, string>> = {
  harassment: 'Harassment or hate',
  sexual: 'Sexual or explicit content',
  violence: 'Violence, threats, or self-harm',
  privacy: 'Privacy or impersonation',
  spam: 'Spam or scam',
  copyright: 'Copyright',
  other: 'Something else',
}

export interface ReportTarget {
  readonly type: 'account' | 'room' | 'stream' | 'message'
  readonly id: string
  readonly label: string
}

/** ADR 0008: one top-level reason, details required only for `other`, and no
    reporter-facing status afterwards — the acknowledgement is the whole
    response the platform promises in V1. */
export function RoomReportDialog({
  roomId,
  target,
  onClose,
  onSubmitted,
}: Readonly<{
  roomId: string
  target: ReportTarget | null
  onClose: () => void
  onSubmitted: () => void
}>) {
  const [reason, setReason] = useState<ReportReason>('harassment')
  const [details, setDetails] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [received, setReceived] = useState(false)

  if (!target) return null

  return (
    <div aria-modal="true" className="room-dialog" role="dialog">
      <div className="room-dialog__panel">
        <h2>Report {target.label}</h2>
        {received ? (
          <>
            <p>Thanks — this report is with the review queue.</p>
            <button type="button" onClick={close}>
              Close
            </button>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <fieldset className="room-dialog__reasons">
              <legend>Why are you reporting this?</legend>
              {REPORT_REASONS.map((value) => (
                <label key={value}>
                  <input
                    checked={reason === value}
                    name="report-reason"
                    type="radio"
                    value={value}
                    onChange={() => setReason(value)}
                  />
                  {REASON_LABELS[value]}
                </label>
              ))}
            </fieldset>

            <label htmlFor="report-details">
              Details {reason === 'other' ? '(required)' : '(optional)'}
            </label>
            <textarea
              id="report-details"
              maxLength={REPORT_DETAILS_LIMIT}
              rows={4}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
            />

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <div className="room-dialog__actions">
              <button type="button" onClick={close}>
                Cancel
              </button>
              <button aria-busy={pending} disabled={pending} type="submit">
                {pending ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )

  function close() {
    setReason('harassment')
    setDetails('')
    setError(null)
    setReceived(false)
    onClose()
  }

  async function submit() {
    setPending(true)
    setError(null)
    const result = await submitRoomReport({
      data: {
        targetType: target!.type,
        targetId: target!.id,
        roomId,
        reason,
        details: details || null,
      },
    }).catch(() => null)
    setPending(false)
    if (result?.status === 'received') {
      setReceived(true)
      // Reporting a stream stops the reporter watching it — the report is not
      // a request to keep looking at it (ADR 0102).
      onSubmitted()
      return
    }
    setError(
      result?.status === 'details-required'
        ? 'Add a short description so this can be reviewed.'
        : 'That report could not be sent. Try again.',
    )
  }
}
