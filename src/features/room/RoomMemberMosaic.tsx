import type { RoomRosterMember } from '../../server/rooms/room-roster'

interface RoomMemberMosaicProps {
  readonly roster: readonly RoomRosterMember[]
  readonly selfMembershipId: string
}

/** ADR 0101: every admitted member owns one stable tile, streaming or not, and
    a non-streaming member gets a presence tile anchored by their real avatar —
    never camera-off iconography that implies a webcam this product does not
    have. Media is not wired up yet, so a sharing member's tile states that a
    screen is up without pretending to show it. */
export function RoomMemberMosaic({ roster, selfMembershipId }: RoomMemberMosaicProps) {
  return (
    <ul className="room-mosaic" data-member-count={roster.length}>
      {roster.map((member) => {
        const you = member.membershipId === selfMembershipId
        return (
          <li
            className="room-mosaic__tile"
            data-member-role={member.role}
            data-member-sharing={member.streamId !== null}
            data-member-self={you}
            key={member.membershipId}
          >
            <div className="room-mosaic__presence">
              <Avatar member={member} />
              {member.streamId !== null && (
                <span className="room-mosaic__sharing">Screen up</span>
              )}
            </div>

            {/* Below the media region, not over it: ADR 0101 keeps the footer
                out of the shared content and out of hover. */}
            <div className="room-mosaic__footer">
              <p className="room-mosaic__name">{member.displayName}</p>
              <p className="room-mosaic__state">
                {[
                  member.role === 'host' ? 'Host' : null,
                  you ? 'You' : null,
                  member.streamId !== null ? 'Sharing' : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Here'}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function Avatar({ member }: Readonly<{ member: RoomRosterMember }>) {
  if (!member.avatarUrl) {
    return (
      <span aria-hidden="true" className="room-mosaic__avatar room-mosaic__avatar--empty">
        {member.displayName.slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return (
    <img alt="" className="room-mosaic__avatar" loading="lazy" src={member.avatarUrl} />
  )
}
