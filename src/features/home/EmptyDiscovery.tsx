import { CreateRoomButton } from './HomeNavigation'

interface EmptyDiscoveryProps {
  readonly hasPastStreams: boolean
  readonly canCreate: boolean
}

export function EmptyDiscovery({ hasPastStreams, canCreate }: EmptyDiscoveryProps) {
  return (
    <div className="empty-discovery">
      <p className="empty-discovery__lead">
        Nobody has a room open. <strong>Public rooms</strong> let anyone browse in
        and join. <strong>Private rooms</strong> still show up here, but joining
        needs the password the host shares.
      </p>
      {/* The count of who is here is already the largest thing on the page, so
          this cue says the one thing that counter cannot: nothing has ever run
          here yet. */}
      {!hasPastStreams && (
        <p className="empty-discovery__first-cue">
          Nothing has been streamed here yet. Whatever you open is the first
          thing this page will have to remember.
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
