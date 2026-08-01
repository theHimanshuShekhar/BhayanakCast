export interface RoomRosterMember {
  readonly membershipId: string
  readonly accountId: string
  readonly displayName: string
  readonly avatarUrl: string | null
  readonly role: 'host' | 'member'
  readonly joinedAt: Date
  /** A disconnected member remains present during reconnect grace. */
  readonly reconnecting: boolean
  /** The member's current active Stream, or null when they are present but not
      sharing. A presence tile is a member without a Stream, never a member the
      roster left out. */
  readonly streamId: string | null
  /** The member's latest Stream Preview and when it was captured, so a tile
      can show the thumbnail and its freshness before anyone watches (ADR
      0035). Null while a stream has not uploaded its first preview. */
  readonly previewKey: string | null
  readonly previewUpdatedAt: Date | null
  /** ADR 0101's informational watcher stack: up to three watchers plus the
      total. Empty for a member who is not streaming. */
  readonly watcherCount: number
  readonly watchers: readonly RoomWatcher[]
}

export interface RoomWatcher {
  readonly accountId: string
  readonly displayName: string
  readonly avatarUrl: string | null
}

/** ADR 0101's stable mosaic order: the viewer, then the Host, then everyone
    else by how long they have been here.
 *
 *  This is the *initial* order. The ADR also requires that host transfer and
 *  stream state never reorder existing tiles, so a client that has already
 *  rendered a mosaic keeps its order and appends new members rather than
 *  re-running this on every snapshot.
 */
export function orderRoomRoster(
  members: readonly RoomRosterMember[],
  viewerMembershipId: string,
): readonly RoomRosterMember[] {
  return [...members].sort((left, right) => rank(left) - rank(right) || byJoin(left, right))

  function rank(member: RoomRosterMember) {
    if (member.membershipId === viewerMembershipId) return 0
    return member.role === 'host' ? 1 : 2
  }
}

/** Keeps the first projection's mosaic positions while refreshing member
 * state and appending genuinely new memberships in continuous join order.
 * Host transfer, sharing, reconnect and compatibility updates therefore
 * cannot move an existing tile.
 */
export function preserveRoomRosterOrder(
  previous: readonly RoomRosterMember[],
  next: readonly RoomRosterMember[],
  viewerMembershipId: string,
): readonly RoomRosterMember[] {
  if (previous.length === 0) return orderRoomRoster(next, viewerMembershipId)

  const nextById = new Map(next.map((member) => [member.membershipId, member]))
  const previousIds = new Set(previous.map((member) => member.membershipId))
  const retained = previous.flatMap((member) => {
    const refreshed = nextById.get(member.membershipId)
    return refreshed ? [refreshed] : []
  })
  if (retained.length === 0) return orderRoomRoster(next, viewerMembershipId)
  const joined = next.filter((member) => !previousIds.has(member.membershipId)).sort(byJoin)
  return [...retained, ...joined]
}

/** ADR 0102's People order: the Host leads, then the viewer, then whoever is
    sharing, then everyone else by join time. Deliberately not the mosaic's
    order — People answers "who runs this room", the mosaic answers "where am
    I looking". */
export function orderRoomPeople(
  members: readonly RoomRosterMember[],
  viewerMembershipId: string,
): readonly RoomRosterMember[] {
  return [...members].sort((left, right) => rank(left) - rank(right) || byJoin(left, right))

  function rank(member: RoomRosterMember) {
    if (member.role === 'host') return 0
    if (member.membershipId === viewerMembershipId) return 1
    return member.streamId ? 2 : 3
  }
}

/** Join time alone is not a total order — two members can be admitted in the
    same transaction — so identity settles the tie and keeps the sort stable
    across snapshots. */
function byJoin(left: RoomRosterMember, right: RoomRosterMember) {
  return (
    left.joinedAt.getTime() - right.joinedAt.getTime() ||
    compare(left.displayName, right.displayName) ||
    compare(left.membershipId, right.membershipId)
  )
}

function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}
