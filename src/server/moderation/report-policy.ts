/** The report vocabulary, kept free of database work so the dialog can import
    it — a client component must not pull a service module into its bundle. */

/** ADR 0008's fixed top-level reasons. `other` is the only one that requires
    details, and the form enforces the same rule the table checks. */
export const REPORT_REASONS = [
  'harassment',
  'sexual',
  'violence',
  'privacy',
  'spam',
  'copyright',
  'other',
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]
export type ReportTargetType = 'account' | 'room' | 'stream' | 'message'

export interface ReportInput {
  readonly targetType: ReportTargetType
  readonly targetId: string
  readonly roomId: string | null
  readonly reason: ReportReason
  readonly details: string | null
}

export type SubmitReportResult =
  | { readonly status: 'received' }
  | { readonly status: 'details-required' }

export const REPORT_DETAILS_LIMIT = 2_000

/** Returns the storable details, or `null` when the submission fails ADR
    0008's rule — `other` needs a description, and nothing exceeds the limit. */
export function normalizeReportDetails(
  reason: ReportReason,
  details: string | null,
): { readonly ok: true; readonly details: string | null } | { readonly ok: false } {
  const normalized = details?.normalize('NFKC').trim() || null
  if (reason === 'other' && !normalized) return { ok: false }
  if (normalized && normalized.length > REPORT_DETAILS_LIMIT) return { ok: false }
  return { ok: true, details: normalized }
}
