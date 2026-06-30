# Observability

V1 uses structured server logs only. Do not add a tracing stack or metrics endpoint unless a later decision expands observability.

## Log important events

Log these server-side events with stable event names and IDs:

- Auth/session failures and Discord OAuth callback errors.
- Room create, join, leave, revive, empty-grace start, end.
- Host handoff.
- Stream start, stop, stop-by-host, and connection setup failures reported by clients.
- Thumbnail upload rejected by rate limit or size limit.
- Chat rejected by validation, sanction, or rate limit.
- Report creation and report resolution.
- Platform sanction create/lift.
- Room ban create/clear.
- Valkey rate-limit rejects.
- Unexpected Socket.IO command errors.

## Never log sensitive content

Do not log:

- Private-room passwords or hashes.
- Better Auth secrets, Discord client secrets, OAuth tokens, cookies, or session tokens.
- Chat message bodies.
- Thumbnail bytes or report snapshot bytes.
- Full database URLs or Valkey URLs.

## Recommended fields

Use fields that help debug without exposing content:

- `event`
- `requestId` or `socketId`
- `roomId`
- `userId`
- `targetUserId` when relevant
- `streamSessionId` when relevant
- `reportId` when relevant
- `rateLimitKey` category, not raw secret material
- `errorCode`
- `durationMs`
