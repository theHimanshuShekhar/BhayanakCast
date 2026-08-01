import { useState, type FormEvent } from 'react'
import { useRouter } from '@tanstack/react-router'
import type { SanctionType } from '../../server/auth/account-access-policy'
import type { SanctionDashboard } from '../../server/moderation/sanction-service'
import { applyAdminSanction, liftAdminSanction } from './admin-sanction-queries'

const CAPABILITY_LABELS: Record<SanctionType, string> = {
  streaming: 'Streaming',
  chat: 'Chat',
  room_creation: 'Room creation',
  all_access: 'All access',
}

export function SanctionPanel({ dashboard }: Readonly<{ dashboard: SanctionDashboard }>) {
  const router = useRouter()
  const [duration, setDuration] = useState<'default-seven-days' | 'custom' | 'indefinite'>(
    'default-seven-days',
  )
  const [busy, setBusy] = useState(false)
  const [confirmLift, setConfirmLift] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const active = dashboard.sanctions.filter((sanction) => sanction.status === 'active')
  const history = dashboard.sanctions.filter((sanction) => sanction.status !== 'active')

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await applyAdminSanction({
        data: {
          accountId: String(form.get('accountId')),
          type: String(form.get('type')) as SanctionType,
          duration,
          ...(duration === 'custom'
            ? { expiresAt: new Date(String(form.get('expiresAt'))).toISOString() }
            : {}),
        },
      })
      setNotice('Sanction applied. Capability state is now authoritative.')
      await router.invalidate()
    } catch {
      setError('The sanction could not be applied. Check the expiry and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function lift(sanctionId: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await liftAdminSanction({ data: sanctionId })
      if (result.status === 'lifted') setNotice('Sanction lifted across its enforcement lineage.')
      else setNotice('This sanction is already inactive.')
      setConfirmLift(null)
      await router.invalidate()
    } catch {
      setError('The sanction could not be lifted. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="sanctions-heading" className="admin-panel admin-sanctions">
      <header className="admin-panel__heading">
        <div>
          <p className="admin-panel__eyebrow">Account enforcement</p>
          <h2 id="sanctions-heading">Platform sanctions</h2>
        </div>
        <span className="admin-count">{active.length} active</span>
      </header>

      <form className="admin-sanctions__form" onSubmit={apply}>
        <label>
          Account
          <select name="accountId" required defaultValue="">
            <option disabled value="">Select an Account</option>
            {dashboard.accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.displayName}</option>
            ))}
          </select>
        </label>
        <label>
          Capability
          <select name="type" defaultValue="streaming">
            {Object.entries(CAPABILITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Duration</legend>
          <label><input checked={duration === 'default-seven-days'} name="duration" onChange={() => setDuration('default-seven-days')} type="radio" /> 7 days (default)</label>
          <label><input checked={duration === 'custom'} name="duration" onChange={() => setDuration('custom')} type="radio" /> Custom expiry</label>
          <label><input checked={duration === 'indefinite'} name="duration" onChange={() => setDuration('indefinite')} type="radio" /> Indefinite</label>
        </fieldset>
        {duration === 'custom' ? (
          <label>
            Expires at
            <input name="expiresAt" required type="datetime-local" />
          </label>
        ) : null}
        <p className="admin-sanctions__effect">
          Streaming stops current media; chat blocks new sends; room creation blocks new rooms;
          all access removes live membership and media through normal room lifecycle.
        </p>
        <button disabled={busy || dashboard.accounts.length === 0} type="submit">
          {busy ? 'Saving…' : 'Apply sanction'}
        </button>
      </form>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="admin-sanctions__notice" role="status">{notice}</p> : null}

      <div className="admin-sanctions__columns">
        <SanctionList
          busy={busy}
          confirmLift={confirmLift}
          heading="Active sanctions"
          sanctions={active}
          onCancelLift={() => setConfirmLift(null)}
          onConfirmLift={(id) => void lift(id)}
          onRequestLift={setConfirmLift}
        />
        <SanctionList heading="Recent inactive history" sanctions={history} />
      </div>
    </section>
  )
}

function SanctionList({
  sanctions,
  heading,
  busy = false,
  confirmLift = null,
  onRequestLift,
  onCancelLift,
  onConfirmLift,
}: Readonly<{
  sanctions: SanctionDashboard['sanctions']
  heading: string
  busy?: boolean
  confirmLift?: string | null
  onRequestLift?: (id: string) => void
  onCancelLift?: () => void
  onConfirmLift?: (id: string) => void
}>) {
  return (
    <section aria-label={heading} className="admin-sanctions__list">
      <h3>{heading}</h3>
      {sanctions.length === 0 ? <p className="admin-empty">None.</p> : (
        <ol>
          {sanctions.map((sanction) => (
            <li key={sanction.id}>
              <div>
                <strong>{sanction.displayName}</strong>
                <span>{CAPABILITY_LABELS[sanction.type]} · {expiryLabel(sanction.expiresAt)}</span>
                <small>{sanction.status}{sanction.carriedForward ? ' · carried to fresh Account' : ''}</small>
              </div>
              {onRequestLift ? (
                confirmLift === sanction.id ? (
                  <div className="admin-sanctions__confirm">
                    <span>Lift now?</span>
                    <button disabled={busy} type="button" onClick={() => onConfirmLift?.(sanction.id)}>Confirm</button>
                    <button disabled={busy} type="button" onClick={onCancelLift}>Cancel</button>
                  </div>
                ) : (
                  <button disabled={busy} type="button" onClick={() => onRequestLift(sanction.id)}>Lift</button>
                )
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function expiryLabel(value: Date | null) {
  if (!value) return 'Indefinite'
  return `until ${new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))}`
}
