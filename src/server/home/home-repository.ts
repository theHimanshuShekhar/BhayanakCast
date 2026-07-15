import { Client, type Pool, type PoolClient, type QueryResultRow } from 'pg'
import {
  rankProfiles,
  rankRooms,
  type ProfileSearchCandidate,
  type RoomSearchCandidate,
} from '../../features/home/home-search'
import { OPERATOR_TIME_ZONE } from '../../features/home/operator-day'
import type {
  ActiveRoomSummary,
  Facet,
  HomeFacets,
  HomeSearch,
  HomeStatistics,
  PastStreamSummary,
  PublicProfileSummary,
  StreamPreview,
} from '../../features/home/home-types'
const ACTIVE_ROOM_LIMIT = 50
const PROFILE_LIMIT = 20
const PAST_STREAM_LIMIT = 10

export interface HomeQueryExecutor {
  query<T extends QueryResultRow>(
    text: string,
    values?: unknown[],
    signal?: AbortSignal,
  ): Promise<{ rows: T[] }>
}

export function createPoolHomeQueryExecutor(pool: Pool): HomeQueryExecutor {
  return {
    query: async <T extends QueryResultRow>(
      text: string,
      values?: unknown[],
      signal?: AbortSignal,
    ) => {
      signal?.throwIfAborted()
      const client = await pool.connect()
      let released = false
      const release = (destroy = false) => {
        if (released) return
        released = true
        client.release(destroy)
      }
      if (!signal) {
        try {
          return await client.query<T>(text, values)
        } finally {
          release()
        }
      }
      let cancellation: Promise<void> | undefined
      const onAbort = () => {
        cancellation ??= cancelPostgresQuery(pool, client)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) {
        signal.removeEventListener('abort', onAbort)
        release()
        signal.throwIfAborted()
      }
      try {
        const result = await client.query<T>(text, values)
        if (cancellation) await cancellation
        signal.throwIfAborted()
        return result
      } catch (error) {
        if (cancellation) await cancellation.catch(() => undefined)
        if (signal.aborted) throw signal.reason
        throw error
      } finally {
        signal.removeEventListener('abort', onAbort)
        if (cancellation) await cancellation.catch(() => undefined)
        release()
      }
    },
  }
}

async function cancelPostgresQuery(pool: Pool, client: PoolClient) {
  const processId = (client as PoolClient & { readonly processID: number }).processID
  const canceller = new Client(pool.options)
  await canceller.connect()
  try {
    await canceller.query('SELECT pg_cancel_backend($1)', [processId])
  } finally {
    await canceller.end()
  }
}

export class HomeRepository {
  constructor(private readonly database: HomeQueryExecutor) {}


  async activeRooms(search: HomeSearch, signal?: AbortSignal): Promise<ActiveRoomSummary[]> {
    const rows = await this.query<ActiveRoomRow>(
      `SELECT r.id,
              r.name,
              r.category,
              r.tags,
              r.visibility,
              COUNT(DISTINCT m.id)::int AS "memberCount",
              COUNT(DISTINCT s.id)::int AS "streamCount",
              GREATEST(r.created_at, COALESCE(MAX(m.joined_at), r.created_at), COALESCE(MAX(s.preview_updated_at), r.created_at), COALESCE(MAX(s.started_at), r.created_at)) AS "activityAt",
              COALESCE(previews.items, '[]'::jsonb) AS previews,
              CASE
                WHEN r.visibility = 'public' THEN COALESCE(member_avatars.items, '[]'::jsonb)
                ELSE '[]'::jsonb
              END AS "memberAvatars"
         FROM room r
         LEFT JOIN room_membership m ON m.room_id = r.id AND m.left_at IS NULL
         LEFT JOIN stream s ON s.room_id = r.id AND s.ended_at IS NULL
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object('previewKey', recent.preview_key, 'updatedAt', recent.preview_updated_at) ORDER BY recent.preview_updated_at DESC, recent.id DESC) AS items
             FROM (
               SELECT id, preview_key, preview_updated_at
                 FROM stream
                WHERE room_id = r.id
                  AND ended_at IS NULL
                  AND preview_key IS NOT NULL
                ORDER BY preview_updated_at DESC, id DESC
                LIMIT 4
             ) recent
         ) previews ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(recent.image ORDER BY recent.joined_at, recent.id) AS items
             FROM (
               SELECT membership.id, membership.joined_at, account.image
                 FROM room_membership membership
                 JOIN "user" account ON account.id = membership.account_id
                WHERE membership.room_id = r.id
                  AND membership.left_at IS NULL
                  AND account.image IS NOT NULL
                ORDER BY membership.joined_at, membership.id
                LIMIT 4
             ) recent
         ) member_avatars ON true
        WHERE r.ended_at IS NULL
        GROUP BY r.id, previews.items, member_avatars.items
        ORDER BY COUNT(DISTINCT m.id) DESC,
                 COUNT(DISTINCT s.id) DESC,
                 GREATEST(r.created_at, COALESCE(MAX(m.joined_at), r.created_at), COALESCE(MAX(s.preview_updated_at), r.created_at), COALESCE(MAX(s.started_at), r.created_at)) DESC,
                 r.id ASC`,
      signal,
    )
    return rankRooms<RankedRoomRow>(
      rows.rows.map((row) => ({ ...row, activityAt: row.activityAt.toISOString() })),
      search,
    ).slice(0, ACTIVE_ROOM_LIMIT).map(toActiveRoom)
  }

  async pastStreams(signal?: AbortSignal): Promise<PastStreamSummary[]> {
    const rows = await this.query<PastStreamRow>(
      `SELECT r.id AS "roomId",
              r.name,
              r.ended_at AS "endedAt",
              r.visibility,
              r.category,
              r.tags,
              COUNT(DISTINCT m.id)::int AS "memberCount",
              COUNT(DISTINCT s.id)::int AS "streamCount"
         FROM room r
         LEFT JOIN room_membership m ON m.room_id = r.id
         LEFT JOIN stream s ON s.room_id = r.id
        WHERE r.ended_at IS NOT NULL
        GROUP BY r.id
        ORDER BY r.ended_at DESC, r.id ASC
        LIMIT ${PAST_STREAM_LIMIT}`,
      signal,
    )
    return rows.rows.map(toPastStream)
  }

  async profiles(search: HomeSearch, signal?: AbortSignal): Promise<PublicProfileSummary[]> {
    if (!search.q) return []
    const candidates = await this.query<ProfileIdentityRow>(
      `SELECT account.id AS "accountId",
              account.name AS "displayName",
              account.image AS "avatarUrl"
         FROM "user" account
         LEFT JOIN account_state state ON state.account_id = account.id
        WHERE state.deletion_requested_at IS NULL`,
      signal,
    )
    const selected = rankProfiles(candidates.rows, search).slice(0, PROFILE_LIMIT)
    if (selected.length === 0) return []
    const rows = await this.query<ProfileRow>(
      `WITH candidates AS (
         SELECT account.id, account.name, account.image
           FROM "user" account
           LEFT JOIN account_state state ON state.account_id = account.id
          WHERE account.id = ANY($1::text[])
            AND state.deletion_requested_at IS NULL
       )
       SELECT c.id AS "accountId",
              c.name AS "displayName",
              c.image AS "avatarUrl",
              COALESCE(aggregates."roomCount", 0)::int AS "roomCount",
              COALESCE(aggregates."streamCount", 0)::int AS "streamCount",
              COALESCE(past.items, '[]'::json) AS "pastStreams",
              COALESCE(co_users.items, '[]'::json) AS "coUsers"
         FROM candidates c
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT m.room_id)::int AS "roomCount",
                  COUNT(DISTINCT s.id)::int AS "streamCount"
             FROM room_membership m
             JOIN room r ON r.id = m.room_id
                        AND r.ended_at IS NOT NULL
             LEFT JOIN stream s ON s.membership_id = m.id
            WHERE m.account_id = c.id
         ) aggregates ON true
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object('roomId', item."roomId", 'name', item.name, 'endedAt', item."endedAt", 'visibility', item.visibility, 'category', item.category, 'tags', item.tags, 'memberCount', item."memberCount", 'streamCount', item."streamCount") ORDER BY item."endedAt" DESC, item."roomId" ASC) AS items
             FROM (
               SELECT r.id AS "roomId",
                      r.name,
                      r.ended_at AS "endedAt",
                      r.visibility,
                      r.category,
                      r.tags,
                      COUNT(DISTINCT all_members.id)::int AS "memberCount",
                      COUNT(DISTINCT all_streams.id)::int AS "streamCount"
                 FROM room_membership own_membership
                 JOIN room r ON r.id = own_membership.room_id
                           AND r.ended_at IS NOT NULL
                 LEFT JOIN room_membership all_members ON all_members.room_id = r.id
                 LEFT JOIN stream all_streams ON all_streams.room_id = r.id
                WHERE own_membership.account_id = c.id
                GROUP BY r.id
                ORDER BY r.ended_at DESC, r.id ASC
                LIMIT 3
             ) item
         ) past ON true
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object('accountId', item."accountId", 'avatarUrl', item."avatarUrl") ORDER BY item.shared DESC, item."accountId" ASC) AS items
             FROM (
               SELECT other.account_id AS "accountId",
                      MAX(other_user.image) AS "avatarUrl",
                      SUM(EXTRACT(EPOCH FROM LEAST(
                        COALESCE(own_membership.left_at, r.ended_at, CURRENT_TIMESTAMP),
                        COALESCE(other.left_at, r.ended_at, CURRENT_TIMESTAMP)
                      ) - GREATEST(own_membership.joined_at, other.joined_at)))::bigint AS shared
                 FROM room_membership own_membership
                 JOIN room r ON r.id = own_membership.room_id
                           AND r.ended_at IS NOT NULL
                 JOIN room_membership other ON other.room_id = own_membership.room_id
                                           AND other.account_id <> c.id
                                           AND other.joined_at < COALESCE(own_membership.left_at, r.ended_at, CURRENT_TIMESTAMP)
                                           AND own_membership.joined_at < COALESCE(other.left_at, r.ended_at, CURRENT_TIMESTAMP)
                 JOIN "user" other_user ON other_user.id = other.account_id
                 LEFT JOIN account_state other_state ON other_state.account_id = other.account_id
                WHERE own_membership.account_id = c.id
                  AND other_state.deletion_requested_at IS NULL
                GROUP BY other.account_id
                ORDER BY shared DESC, other.account_id ASC
                LIMIT 3
             ) item
         ) co_users ON true`,
      signal,
      [selected.map(({ accountId }) => accountId)],
    )
    const profilesById = new Map(rows.rows.map((profile) => [profile.accountId, profile]))
    return selected.flatMap(({ accountId }) => {
      const profile = profilesById.get(accountId)
      return profile ? [toProfile(profile)] : []
    })
  }

  async facets(signal?: AbortSignal): Promise<HomeFacets> {
    const [categories, tags] = await Promise.all([
      this.query<Facet>(
        `SELECT category AS value, COUNT(*)::int AS count
           FROM room
          WHERE ended_at IS NULL AND category IS NOT NULL
          GROUP BY category
          ORDER BY count DESC, category ASC
          LIMIT 50`,
        signal,
      ),
      this.query<Facet>(
        `SELECT tag AS value, COUNT(*)::int AS count
           FROM room, unnest(tags) AS tag
          WHERE ended_at IS NULL
          GROUP BY tag
          ORDER BY count DESC, tag ASC
          LIMIT 50`,
        signal,
      ),
    ])
    return { categories: categories.rows, tags: tags.rows }
  }

  async statistics(
    operatorDay: string,
    signal?: AbortSignal,
  ): Promise<DatabaseHomeStatistics> {
    const rows = await this.query<DatabaseHomeStatistics>(
      `SELECT
         (SELECT COUNT(*)::int FROM room WHERE ended_at IS NULL) AS "activeRoomCount",
         (SELECT COUNT(*)::int FROM stream WHERE ended_at IS NULL) AS "activeStreamCount",
         (SELECT COUNT(*)::int FROM room_membership WHERE left_at IS NULL) AS "currentMembershipCount",
         (SELECT COUNT(*)::int
            FROM room
           WHERE created_at >= (($1::date::timestamp AT TIME ZONE $2) AT TIME ZONE 'UTC')
             AND created_at < ((($1::date + 1)::timestamp AT TIME ZONE $2) AT TIME ZONE 'UTC')) AS "roomsCreatedToday"`,
      signal,
      [operatorDay, OPERATOR_TIME_ZONE],
    )
    return (
      rows.rows[0] ?? {
        activeRoomCount: 0,
        activeStreamCount: 0,
        currentMembershipCount: 0,
        roomsCreatedToday: 0,
      }
    )
  }

  private async query<T extends QueryResultRow>(
    text: string,
    signal?: AbortSignal,
    values?: unknown[],
  ) {
    signal?.throwIfAborted()
    return await this.database.query<T>(text, values, signal)
  }
}


type DatabaseHomeStatistics = Omit<
  HomeStatistics,
  'peakConnectedAccountCount'
>

interface ActiveRoomRow extends Omit<RoomSearchCandidate, 'activityAt'> {
  readonly activityAt: Date
  readonly visibility: 'public' | 'private'
  readonly previews: StreamPreview[]
  readonly memberAvatars: string[]
}

type RankedRoomRow = Omit<ActiveRoomRow, 'activityAt'> & {
  readonly activityAt: string
}

interface PastStreamRow extends Omit<PastStreamSummary, 'endedAt'> {
  readonly endedAt: Date | string
}

interface ProfileIdentityRow extends ProfileSearchCandidate {
  readonly avatarUrl: string | null
}

interface ProfileRow extends ProfileSearchCandidate {
  readonly avatarUrl: string | null
  readonly roomCount: number
  readonly streamCount: number
  readonly pastStreams: PastStreamRow[]
  readonly coUsers: { accountId: string; avatarUrl: string | null }[]
}

function toActiveRoom(
  row: Omit<ActiveRoomRow, 'activityAt'>,
): ActiveRoomSummary {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    tags: row.tags,
    visibility: row.visibility,
    memberCount: row.memberCount,
    streamCount: row.streamCount,
    state: row.memberCount >= 10 ? 'full' : 'live',
    previews: row.previews.map((preview) => ({
      previewKey: preview.previewKey,
      updatedAt: new Date(preview.updatedAt).toISOString(),
    })),
    memberAvatars: row.memberAvatars,
  }
}

function toPastStream(row: PastStreamRow): PastStreamSummary {
  return {
    roomId: row.roomId,
    name: row.name,
    endedAt: new Date(row.endedAt).toISOString(),
    visibility: row.visibility,
    category: row.category,
    tags: row.tags,
    memberCount: row.memberCount,
    streamCount: row.streamCount,
  }
}

function toProfile(row: ProfileRow): PublicProfileSummary {
  return {
    accountId: row.accountId,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    roomCount: row.roomCount,
    streamCount: row.streamCount,
    pastStreams: row.pastStreams.map(toPastStream),
    coUsers: row.coUsers,
  }
}
