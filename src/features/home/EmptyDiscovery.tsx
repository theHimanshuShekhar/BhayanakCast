import { CreateRoomButton } from './HomeNavigation'

interface EmptyDiscoveryProps {
  readonly hasPastStreams: boolean
}

export function EmptyDiscovery({ hasPastStreams }: EmptyDiscoveryProps) {
  return (
    <div className="empty-discovery">
      <h3>The clubhouse is quiet,</h3>
      <p>
        Public rooms welcome anyone to browse and join. Private rooms stay
        visible, but joining requires the room’s shared password.
      </p>
      {!hasPastStreams && (
        <p className="empty-discovery__first-cue">Be the first to open a room.</p>
      )}
      <CreateRoomButton
        className="empty-discovery__create"
        label="Create Room"
      />
    </div>
  )
}
