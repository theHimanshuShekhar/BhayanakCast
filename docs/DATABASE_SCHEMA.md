# Database Schema

Complete reference for BhayanakCast database tables and relationships.

## Overview

Uses **PostgreSQL** with **Drizzle ORM**. Schema defined in `src/db/schema.ts`.

## Authentication Tables (Better Auth)

Better Auth manages these tables automatically:

### users
Discord OAuth users.

| Column | Type | Notes |
|--------|------|-------|
| id | varchar(36) | Primary key (nanoid) |
| name | varchar(255) | Display name from Discord |
| email | varchar(255) | Unique, from Discord |
| emailVerified | boolean | Email verification status |
| image | varchar(255) | Discord avatar URL |
| createdAt | timestamp | Account creation |
| updatedAt | timestamp | Last update |

### sessions
User sessions for authentication.

| Column | Type | Notes |
|--------|------|-------|
| id | varchar(36) | Session ID |
| userId | varchar(36) | FK to users.id |
| token | varchar(255) | Session token |
| expiresAt | timestamp | Expiration time |
| createdAt | timestamp | Session start |
| updatedAt | timestamp | Last activity |

### accounts
OAuth account connections.

| Column | Type | Notes |
|--------|------|-------|
| id | varchar(36) | Account ID |
| userId | varchar(36) | FK to users.id |
| accountId | varchar(255) | Discord account ID |
| providerId | varchar(255) | "discord" |
| accessToken | text | OAuth access token |
| refreshToken | text | OAuth refresh token |
| expiresAt | timestamp | Token expiration |
| createdAt | timestamp | Connection date |
| updatedAt | timestamp | Last update |

## Application Tables

### streaming_rooms
Core room entity.

| Column | Type | Notes |
|--------|------|-------|
| id | varchar(21) | Primary key (nanoid) |
| name | varchar(100) | Room name (3-100 chars) |
| description | varchar(500) | Optional description |
| streamerId | varchar(36) | FK to users.id (nullable) |
| status | varchar(20) | waiting/preparing/active/ended |
| createdAt | timestamp | Creation time |
| endedAt | timestamp | When room ended (nullable) |

**Indexes:**
- `idx_rooms_status` on status
- `idx_rooms_streamer` on streamerId
- `idx_rooms_created` on createdAt

**Status Lifecycle:**
```
waiting → preparing → active → ended
   ↑                               |
   └────── 5 min empty ────────────┘
```

### room_participants
Tracks user participation in rooms.

| Column | Type | Notes |
|--------|------|-------|
| id | varchar(21) | Primary key (nanoid) |
| roomId | varchar(21) | FK to streaming_rooms.id |
| userId | varchar(36) | FK to users.id |
| joinedAt | timestamp | When user joined |
| leftAt | timestamp | When user left (nullable) |
| totalTimeSeconds | integer | Total time in room |

**Constraints:**
- User can only have ONE active participation (leftAt IS NULL)

**Indexes:**
- `idx_participants_room` on roomId
- `idx_participants_user` on userId
- `idx_participants_active` on (roomId, leftAt)

### user_relationships
Aggregated time between pairs of users.

| Column | Type | Notes |
|--------|------|-------|
| id | varchar(21) | Primary key (nanoid) |
| user1Id | varchar(36) | FK to users.id |
| user2Id | varchar(36) | FK to users.id |
| totalTimeSeconds | integer | Total overlap time |
| lastOverlapAt | timestamp | Most recent overlap |
| createdAt | timestamp | First connection |
| updatedAt | timestamp | Last update |

**Constraints:**
- Unique constraint on (user1Id, user2Id)
- user1Id < user2Id (enforced in code)

### user_room_overlaps
Detailed tracking of when users overlapped in rooms.

| Column | Type | Notes |
|--------|------|-------|
| id | varchar(21) | Primary key (nanoid) |
| roomId | varchar(21) | FK to streaming_rooms.id |
| user1Id | varchar(36) | FK to users.id |
| user2Id | varchar(36) | FK to users.id |
| overlapStart | timestamp | When overlap began |
| overlapEnd | timestamp | When overlap ended |
| overlapSeconds | integer | Duration of overlap |
| createdAt | timestamp | Record creation |

**Indexes:**
- `idx_overlaps_room` on roomId
- `idx_overlaps_users` on (user1Id, user2Id)
- `idx_overlaps_time` on overlapStart

### community_stats_snapshots
Cached community statistics. Uses single-record pattern with fixed ID.

| Column | Type | Notes |
|--------|------|-------|
| id | varchar(36) | Primary key (fixed: `community-stats-single`) |
| totalRegisteredUsers | integer | User count |
| totalWatchHoursThisWeek | integer | Weekly watch hours |
| totalWatchSecondsThisWeek | decimal(10,2) | Precise weekly seconds |
| mostActiveStreamers | integer | Active streamer count |
| newUsersThisWeek | integer | New registrations |
| calculatedAt | timestamp | When stats computed |

**Design Pattern:** Single record that gets updated via upsert (`INSERT ... ON CONFLICT DO UPDATE`). No historical data is stored. The record is updated in-place whenever stats are recalculated (every 30 minutes or on-demand).

## Entity Relationships

```
users ||--o{ streaming_rooms : "creates/streams"
users ||--o{ room_participants : "joins"
users ||--o{ user_relationships : "connects with"
users ||--o{ user_room_overlaps : "overlaps with"

streaming_rooms ||--o{ room_participants : "has"
streaming_rooms ||--o{ user_room_overlaps : "records"

room_participants }o--|| users : "belongs to"
room_participants }o--|| streaming_rooms : "in"
```

## Common Queries

### Get Active Rooms with Streamer
```typescript
const rooms = await db
  .select({
    room: streamingRooms,
    streamer: { id: users.id, name: users.name, image: users.image },
    participantCount: sql<number>`count(${roomParticipants.id})`
  })
  .from(streamingRooms)
  .leftJoin(users, eq(streamingRooms.streamerId, users.id))
  .leftJoin(roomParticipants, eq(streamingRooms.id, roomParticipants.roomId))
  .where(eq(streamingRooms.status, "active"))
  .groupBy(streamingRooms.id, users.id);
```

### Get User's Total Watch Time
```typescript
const result = await db
  .select({
    totalSeconds: sql<number>`sum(${roomParticipants.totalTimeSeconds})`
  })
  .from(roomParticipants)
  .where(eq(roomParticipants.userId, userId));
```

### Get Top Relationships
```typescript
const relationships = await db
  .select({
    user: { id: users.id, name: users.name, image: users.image },
    totalTimeSeconds: userRelationships.totalTimeSeconds
  })
  .from(userRelationships)
  .innerJoin(users, or(
    and(eq(userRelationships.user1Id, currentUserId), eq(users.id, userRelationships.user2Id)),
    and(eq(userRelationships.user2Id, currentUserId), eq(users.id, userRelationships.user1Id))
  ))
  .where(or(
    eq(userRelationships.user1Id, currentUserId),
    eq(userRelationships.user2Id, currentUserId)
  ))
  .orderBy(desc(userRelationships.totalTimeSeconds))
  .limit(5);
```

## Database Migrations

```bash
# Generate migration from schema changes
pnpm db:generate

# Apply migrations
pnpm db:migrate

# Push schema directly (development only)
pnpm db:push

# Open Drizzle Studio
pnpm db:studio
```

## See Also

- [Room System](./ROOM_SYSTEM.md) - Room lifecycle and business logic
- [Getting Started](./GETTING_STARTED.md) - Database setup
