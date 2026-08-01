import { useState } from 'react'
import type { ReportDetail, ReportDisposition, ReportTargetReview } from '../../server/moderation/report-service'
import { formatDate, statusLabel } from './AdminPage'
import { reviewAdminReport } from './admin-report-queries'

const REASON_LABELS = {
  harassment: 'Harassment or hate', sexual: 'Sexual or explicit content',
  violence: 'Violence, threats, or self-harm', privacy: 'Privacy or impersonation',
  spam: 'Spam or scam', copyright: 'Copyright', other: 'Other',
} as const

export function AdminReportDetailPage({ initialReport }: Readonly<{ initialReport: ReportDetail }>) {
  const [report, setReport] = useState(initialReport)
  const [confirming, setConfirming] = useState<ReportDisposition | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitReview(disposition: ReportDisposition) {
    setPending(true)
    setError(null)
    const result = await reviewAdminReport({ data: { reportId: report.id, disposition } }).catch(() => null)
    setPending(false)
    if (result?.status === 'updated' || result?.status === 'already-reviewed') {
      setReport(result.report)
      setConfirming(null)
      return
    }
    setError(result?.status === 'not-found' ? 'This report is no longer available.' : 'The action could not be saved. Try again.')
  }

  return (
    <main className="admin-shell admin-shell--detail">
      <header className="admin-detail-header">
        <a className="admin-back-link" href="/admin">← Report queue</a>
        <div className="admin-detail-header__title">
          <div><p className="admin-eyebrow">Private safety review</p><h1>{targetHeading(report.target)}</h1></div>
          <span className={`admin-status admin-status--${report.status}`}>{statusLabel(report.status)}</span>
        </div>
        <p>Received <time dateTime={report.createdAt.toISOString()}>{formatDate(report.createdAt)}</time></p>
      </header>

      <div className="admin-detail-grid">
        <div className="admin-detail-main">
          <section aria-labelledby="target-heading" className="admin-panel">
            <p className="admin-eyebrow">Reported target</p><h2 id="target-heading">Structured target review</h2>
            <TargetReview target={report.target} />
          </section>
          <section aria-labelledby="signal-heading" className="admin-panel">
            <p className="admin-eyebrow">Reporter signal</p><h2 id="signal-heading">{REASON_LABELS[report.reason]}</h2>
            <dl className="admin-facts">
              <div><dt>Reporter</dt><dd>{report.reporter.displayName}</dd></div>
              {report.room && <div><dt>Room context</dt><dd>{report.room.name} · {report.room.visibility}</dd></div>}
            </dl>
            <div className="admin-report-details"><h3>Details</h3><p>{report.details ?? 'No optional details were provided.'}</p></div>
          </section>
          {report.evidenceDataUrl && (
            <section aria-labelledby="evidence-heading" className="admin-panel">
              <p className="admin-eyebrow">Captured at submission</p><h2 id="evidence-heading">Frozen blurred Stream evidence</h2>
              <div className="admin-evidence-frame"><img alt="Blurred frozen Stream evidence" src={report.evidenceDataUrl} /></div>
              <p className="admin-privacy-note">Private evidence. The frozen image is intentionally blurred and is not publicly accessible.</p>
            </section>
          )}
        </div>
        <aside aria-labelledby="review-heading" className="admin-panel admin-review-panel">
          <p className="admin-eyebrow">Best-effort review</p><h2 id="review-heading">Admin action</h2>
          {report.status === 'pending' ? (
            <>
              <p>Choose the disposition that matches this review. This does not notify the reporter.</p>
              {confirming ? (
                <div aria-live="polite" className="admin-confirmation">
                  <h3>{confirming === 'resolved' ? 'Resolve this report?' : 'Dismiss this report?'}</h3>
                  <p>The action is audited and starts the one-year retention clock.</p>
                  <div className="admin-actions">
                    <button disabled={pending} type="button" onClick={() => setConfirming(null)}>Cancel</button>
                    <button aria-busy={pending} className={confirming === 'dismissed' ? 'button-danger' : 'button-primary'} disabled={pending} type="button" onClick={() => void submitReview(confirming)}>
                      {pending ? 'Saving…' : confirming === 'resolved' ? 'Confirm resolution' : 'Confirm dismissal'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="admin-actions admin-actions--stacked">
                  <button className="button-primary" type="button" onClick={() => setConfirming('resolved')}>Resolve report</button>
                  <button type="button" onClick={() => setConfirming('dismissed')}>Dismiss report</button>
                </div>
              )}
              {error && <p className="admin-error" role="alert">{error}</p>}
            </>
          ) : (
            <dl className="admin-facts admin-facts--stacked">
              <div><dt>Action</dt><dd>{statusLabel(report.status)}</dd></div>
              <div><dt>Reviewed by</dt><dd>{report.resolvedBy?.displayName ?? 'Platform Admin'}</dd></div>
              {report.resolvedAt && <div><dt>Reviewed</dt><dd><time dateTime={report.resolvedAt.toISOString()}>{formatDate(report.resolvedAt)}</time></dd></div>}
              {report.retainUntil && <div><dt>Retain until</dt><dd><time dateTime={report.retainUntil.toISOString()}>{formatDate(report.retainUntil)}</time></dd></div>}
            </dl>
          )}
        </aside>
      </div>
    </main>
  )
}

function TargetReview({ target }: Readonly<{ target: ReportTargetReview }>) {
  if (target.type === 'unavailable') return <p className="admin-unavailable">The original {target.originalType} is no longer available.</p>
  if (target.type === 'account') return <FactRows rows={[['Target type', 'Account'], ['Account', target.account.displayName]]} />
  if (target.type === 'room') return <FactRows rows={[
    ['Target type', 'Room'], ['Room', target.room.name], ['Visibility', target.room.visibility],
    ['Lifecycle', target.room.endedAt ? `Ended ${formatDate(target.room.endedAt)}` : 'Live'],
  ]} />
  if (target.type === 'stream') return <FactRows rows={[
    ['Target type', 'Stream'], ['Streamer', target.stream.account.displayName], ['Started', formatDate(target.stream.startedAt)],
    ['Lifecycle', target.stream.endedAt ? `Ended ${formatDate(target.stream.endedAt)}` : 'Live'],
  ]} />
  return <><FactRows rows={[
    ['Target type', 'Chat message'], ['Author', target.message.account.displayName], ['Sent', formatDate(target.message.createdAt)],
  ]} /><blockquote className="admin-message-evidence">{target.message.body}</blockquote></>
}

function FactRows({ rows }: Readonly<{ rows: readonly (readonly [string, string])[] }>) {
  return <dl className="admin-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}

function targetHeading(target: ReportTargetReview) {
  if (target.type === 'account') return target.account.displayName
  if (target.type === 'room') return target.room.name
  if (target.type === 'stream') return `${target.stream.account.displayName}’s Stream`
  if (target.type === 'message') return `${target.message.account.displayName}’s chat message`
  return 'Unavailable reported target'
}
