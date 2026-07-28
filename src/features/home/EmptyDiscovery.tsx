import { CreateRoomButton } from './HomeNavigation'

interface EmptyDiscoveryProps {
  readonly hasPastStreams: boolean
  readonly canCreate: boolean
  readonly connectedAccountCount: number | undefined
}

export function EmptyDiscovery({
  hasPastStreams,
  canCreate,
  connectedAccountCount,
}: EmptyDiscoveryProps) {
  return (
    <div className="empty-discovery">
      <p className="empty-discovery__lead">
        Nobody has a room open. <strong>Public rooms</strong> let anyone browse in
        and join. <strong>Private rooms</strong> still show up here, but joining
        needs the password the host shares.
      </p>
      {!hasPastStreams && (
        <p className="empty-discovery__first-cue">
          Be the first
          {connectedAccountCount
            ? ` — ${connectedAccountCount} ${connectedAccountCount === 1 ? 'account is' : 'accounts are'} connected and watching this page.`
            : '.'}
        </p>
      )}
      {/* Anonymous visitors get the same control, not a plain sign-in: it
          carries the create intent through Discord and back into the dialog. */}
      <CreateRoomButton
        className="empty-discovery__create"
        label={canCreate ? 'Open the first room' : 'Sign in to open a room'}
      />
    </div>
  )
}
