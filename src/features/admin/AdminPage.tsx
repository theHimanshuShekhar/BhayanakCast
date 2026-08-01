import type { ReactNode } from 'react'
import type { ReportQueueItem } from '../../server/moderation/report-service'

const TARGET_LABELS = {
  account: 'Account',
  room: 'Room',
  stream: 'Stream',
  message: 'Chat message',
} as const

const REASON_LABELS = {
  harassment: 'Harassment or hate',
  sexual: 'Sexual or explicit content',
  violence: 'Violence, threats, or self-harm',
  privacy: 'Privacy or impersonation',
  spam: 'Spam or scam',
  copyright: 'Copyright',
  other: 'Other',
} as const

export function AdminPage({
  reports,
  children,
}: Readonly<{ reports: readonly ReportQueueItem[]; children?: ReactNode }>) {
  const pendingCount = reports.filter((report) => report.status === 'pending').length
  return (
    <main className="admin-shell">
      <header className="admin-header">
        <a className="admin-back-link" href="/">← Home</a>
        <div>
          <p className="admin-eyebrow">Private operator workspace</p>
          <h1>Platform Admin</h1>
          <p>Review community safety signals on a best-effort basis.</p>
        </div>
      </header>

      <nav aria-label="Platform Admin" className="admin-tabs">
        <a aria-current="page" href="/admin">Reports</a>
      </nav>

      <section aria-labelledby="report-queue-heading" className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <p className="admin-eyebrow">Safety signals</p>
            <h2 id="report-queue-heading">Report queue</h2>
          </div>
          <span className="admin-count" aria-label={`${pendingCount} pending reports`}>
            {pendingCount} pending
          </span>
        </div>
        <p className="admin-privacy-note">
          Reports and evidence are private. Operational audit logs are the action authority.
        </p>
        <ReportQueue reports={reports} />
      </section>
      {children}
    </main>
  )
}

function ReportQueue({ reports }: Readonly<{ reports: readonly ReportQueueItem[] }>) {
  if (reports.length === 0) {
    return (
      <div className="admin-empty" role="status">
        <h3>No reports to review</h3>
        <p>New safety signals will appear here when they arrive.</p>
      </div>
    )
  }
  return (
    <ol className="admin-report-list">
      {reports.map((report) => (
        <li key={report.id}>
          <a className="admin-report-card" href={`/admin/reports/${report.id}`}>
            <span className={`admin-status admin-status--${report.status}`}>
              {statusLabel(report.status)}
            </span>
            <span className="admin-report-card__main">
              <strong>{TARGET_LABELS[report.targetType]}</strong>
              <span>{REASON_LABELS[report.reason]}</span>
            </span>
            <span className="admin-report-card__meta">
              {report.evidenceAvailable && <span>Evidence captured</span>}
              <time dateTime={report.createdAt.toISOString()}>{formatDate(report.createdAt)}</time>
            </span>
            <span aria-hidden="true" className="admin-report-card__arrow">→</span>
          </a>
        </li>
      ))}
    </ol>
  )
}

export function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value)
}

export function statusLabel(status: ReportQueueItem['status']): string {
  if (status === 'pending') return 'Pending'
  if (status === 'resolved') return 'Resolved'
  return 'Dismissed'
}
