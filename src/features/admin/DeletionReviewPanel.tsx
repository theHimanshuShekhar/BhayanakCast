import { useState } from 'react'
import {
  reviewDeletionRequest,
  type PendingDeletionReview,
} from '../../server/profile/deletion-service'
import { formatDate } from './AdminPage'

type Decision = 'approved' | 'rejected'

export function DeletionReviewPanel({
  requests: initialRequests,
}: Readonly<{ requests: readonly PendingDeletionReview[] }>) {
  const [requests, setRequests] = useState(initialRequests)
  const [reviewing, setReviewing] = useState<{
    accountId: string
    decision: Decision
  } | null>(null)
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(accountId: string, decision: Decision) {
    setBusyAccountId(accountId)
    setError(null)
    try {
      const result = await reviewDeletionRequest({ data: { accountId, decision } })
      if (result.status === decision) {
        setRequests((current) => current.filter((request) => request.accountId !== accountId))
        setReviewing(null)
      } else {
        setError('This request is no longer pending. Refresh the queue.')
      }
    } catch {
      setError('The review could not be saved. Try again.')
    } finally {
      setBusyAccountId(null)
    }
  }

  return (
    <section aria-labelledby="deletion-review-heading" className="admin-panel deletion-review">
      <header className="admin-panel__heading">
        <div>
          <p className="admin-eyebrow">Account privacy</p>
          <h2 id="deletion-review-heading">Deletion review</h2>
        </div>
        <span aria-label={`${requests.length} pending deletion requests`} className="admin-count">
          {requests.length}
        </span>
      </header>
      {requests.length === 0 ? (
        <p className="admin-empty">No Account deletion requests need review.</p>
      ) : (
        <ol className="deletion-review-list">
          {requests.map((request) => {
            const confirmation = reviewing?.accountId === request.accountId ? reviewing : null
            const busy = busyAccountId === request.accountId
            return (
              <li className="deletion-review-item" key={request.requestId}>
                <div>
                  <strong>{request.displayName}</strong>
                  <p>Requested {formatDate(request.requestedAt)}</p>
                </div>
                {confirmation ? (
                  <div className="deletion-review-confirmation" role="group" aria-label="Confirm review decision">
                    <p>
                      {confirmation.decision === 'approved'
                        ? 'Approval permanently removes credentials and attribution and revokes every session.'
                        : 'Rejection restores normal access and public visibility.'}
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void decide(request.accountId, confirmation.decision)}
                    >
                      {busy
                        ? 'Saving…'
                        : confirmation.decision === 'approved'
                          ? 'Confirm permanent deletion'
                          : 'Confirm rejection'}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setReviewing(null)}>
                      Keep pending
                    </button>
                  </div>
                ) : (
                  <div className="deletion-review-actions">
                    <button
                      type="button"
                      onClick={() => setReviewing({ accountId: request.accountId, decision: 'approved' })}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => setReviewing({ accountId: request.accountId, decision: 'rejected' })}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  )
}
