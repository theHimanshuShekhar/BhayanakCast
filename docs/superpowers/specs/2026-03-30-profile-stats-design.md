# Profile Stats Card — Design Spec

**Date:** 2026-03-30

## Problem

The profile page currently shows only the user's name, avatar, and top connections. There is no summary of the user's activity on the platform, making profiles feel sparse and uninformative.

## Goal

Add two new sections to the profile page (visible to all visitors):

1. **Stats card** — Member Since, Total Watch Time, Watch Time (Last 30d)
2. **Top Connections (Last 30d) card** — separate from the existing all-time connections card, showing who the user has shared room time with in the past 30 days

---

## Architecture

### Data Layer

**`src/db/queries/stats.ts` — `getUserStats()`**
Extend to also compute `watchTimeLast30Days`. Add one query: sum `roomParticipants.totalTimeSeconds` where `userId = userId AND joinedAt >= 30 days ago`. The `thirtyDaysAgo` variable already exists in the function — reuse it. Update the `UserStats` interface to include `watchTimeLast30Days: number`.

**`src/db/queries.ts` — new `getTopRelationshipsLast30Days()`**
Query the `userRoomOverlaps` table (which has per-session `overlapStart` timestamps) filtered to the last 30 days. Group by the other user, summing `overlapSeconds` and counting distinct rooms. Join with `users` for name/image. Returns `RelationshipWithUser[]` — same shape as the existing `getTopRelationships()`.

**`src/db/queries.ts` — `UserProfileData` type**
Add:
- `stats: { totalWatchTime: number; watchTimeLast30Days: number }`
- `topRelationshipsLast30Days: RelationshipWithUser[]`

The `user.createdAt` is already returned, so no change needed there.

**`src/utils/profile.ts` — `getProfileData()`**
Call `getUserStats()` and `getTopRelationshipsLast30Days()` in parallel with the existing `getTopRelationships()` call. Include both in the return object.

### UI Layer

**`src/routes/profile.$userId.tsx`**

Card order (top to bottom):
1. Profile header (existing)
2. **Stats card** (new)
3. Top Connections — All Time (existing, renamed heading for clarity)
4. **Top Connections — Last 30 Days** (new card, same layout as all-time)

**Stats card** — three equal-width columns:

| Member Since | Total Watch Time | Last 30 Days |
|---|---|---|
| Jan 2025 | 142h 30m | 12h 5m |

- Label: `text-text-tertiary text-sm`
- Value: `text-text-primary text-2xl font-bold mt-1`
- Card: `bg-depth-1 rounded-lg p-6 border border-border-subtle`
- Date formatted as `MMM YYYY` via `toLocaleDateString("en-US", { month: "short", year: "numeric" })`
- Time via existing `formatDuration()`

**Top Connections (Last 30 Days) card** — identical layout to all-time card, with empty state: *"No shared room time in the last 30 days."* (or own-profile variant: *"You haven't shared room time with anyone in the last 30 days."*)

---

## Files to Modify

1. `src/db/queries/stats.ts` — extend `UserStats` + add 30d watch time query
2. `src/db/queries.ts` — add `getTopRelationshipsLast30Days()` + update `UserProfileData` type
3. `src/utils/profile.ts` — call new functions, include in return
4. `src/routes/profile.$userId.tsx` — render stats card + 30d connections card

---

## Verification

1. Visit any profile — stats card and 30d connections card both appear
2. Stats visible when logged out (public)
3. `Member Since` shows correct month/year
4. Watch time values format correctly via `formatDuration()`
5. 30d connections card shows correct users (only those from last 30 days)
6. Empty states render correctly when no recent activity
7. Run `pnpm check` — no lint/format errors
