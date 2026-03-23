# BhayanakCast Development Plan

**Last Updated:** March 16, 2026

## Completed Features ✅

### Core Platform
- [x] Discord OAuth authentication (sole method)
- [x] User profile sync from Discord
- [x] 4 theme system (Purple-Blue, Misty-Blue, Onyx-Black, Blue-Gray)
- [x] Real-time user count via WebSocket
- [x] **265 total tests** (205 unit/integration + 23 E2E + 37 skipped), 90%+ coverage
- [x] **WebSocket-first architecture** - In-memory state with DB persistence
- [x] Docker containerization
- [x] GitHub Actions CI/CD to GHCR
- [x] Comprehensive documentation (11 docs + 8 WebRTC docs)

### Rate Limiting & Security
- [x] Adapter pattern for rate limiting (InMemory + Valkey ready)
- [x] Room creation: 3/minute per user
- [x] Room join: 10/minute per user
- [x] Room leave: 5/minute per user
- [x] Chat: 30 messages/15 seconds
- [x] WebSocket connections: 30/minute per IP
- [x] Streamer transfer: 1/30 seconds per room
- [x] Profanity filter (Hindi + English)

### Room System (WebSocket-First Architecture)
- [x] **WebSocket-first room operations** - No direct DB writes from frontend
- [x] **In-memory state management** - Primary source of truth during runtime
- [x] **Synchronous DB persistence** - Wait for confirmation before broadcasting
- [x] **Auto-rejoin on reconnect** - Server restart recovery
- [x] Create/join/leave rooms via WebSocket events

#### Room Status State Machine
**Status transitions:**
1. **waiting** → **preparing**: Creator joins
2. **preparing** → **active**: 2nd participant joins
3. **active** → **preparing**: Streamer stops streaming (stays in room)
4. **active** → **preparing**: Streamer leaves, eligible viewer exists
5. **active** → **waiting**: Streamer leaves, no eligible viewers
6. **waiting** → **ended**: Empty for 5+ minutes (cleanup job)

**Key rules:**
- Room does NOT end when stream ends
- Room does NOT end when streamer leaves
- Room only ends after being empty for 5+ minutes
- Automatic streamer transfer (30s cooldown)
- 3-hour visibility for ended streams

- [x] 4 status states: waiting, preparing, active, ended
- [x] Nullable streamer support
- [x] Automatic streamer transfer when host leaves
- [x] 5-minute cleanup job for empty waiting rooms
- [x] 3-hour visibility for ended streams
- [x] Socket.io room management
- [x] Real-time chat with system messages
- [x] Streamer transfer with 30s cooldown

### User Features
- [x] User profiles with top 5 connections
- [x] Community stats with single-record upsert (no historical data)
- [x] Debounced room search
- [x] Trending rooms algorithm
- [x] Active room indicator

### Technical
- [x] PostgreSQL + Drizzle ORM
- [x] Socket.io WebSocket server
- [x] TanStack Query with 30min caching
- [x] Better Auth integration
- [x] Social media meta tags (Open Graph, Twitter)

## In Progress 🚧

- [x] ~~WebRTC integration for actual streaming~~ ✅ **COMPLETED**
- [x] ~~E2E tests with Playwright~~ ✅ **Configuration ready**, tests in development

## Planned Features 📋

### High Priority
- [ ] Edit profile (name, avatar)
- [ ] Room categories/tags
- [ ] User search functionality
- [ ] Friend/follow system
- [ ] Notifications

### Medium Priority
- [x] ~~Screen sharing~~ ✅ **COMPLETED (WebRTC)**
- [ ] Room thumbnails
- [ ] Room sorting options
- [ ] Stream recording/replay
- [ ] User settings page

### Nice to Have
- [ ] Virtual gifts/donations
- [ ] Mobile app/PWA
- [ ] Admin dashboard
- [ ] Discord bot integration

## Architecture Notes

### Room Lifecycle
```
Create → preparing → active (multiple participants)
                ↓
         streamer leaves + no viewers → waiting → ended (after 5min)
```

### Data Flow (WebSocket-First)
1. **Client** emits WebSocket event (e.g., `room:create`, `room:join`)
2. **Server** updates database synchronously (waits for confirmation)
3. **Server** updates in-memory state
4. **Server** broadcasts to Socket.io room
5. **Clients** receive event and update state directly (no refetch needed)

**Server Restart Recovery:**
- Client auto-reconnects via WebSocket
- Context tracks `currentRoomId`
- Emits `room:rejoin` automatically
- Server rebuilds state from database
- Client receives `room:state_sync` with full state

### Caching Strategy
- Static data: 30 minutes
- Community stats: 30 minutes (single record, updated via upsert)
- Room data: 2 minutes

### Community Stats Architecture
Single record design with fixed ID (`community-stats-single`):
- Uses `INSERT ... ON CONFLICT DO UPDATE` for atomic upsert
- No historical data stored (keeps table size constant)
- In-memory cache with 30-minute TTL
- Auto-recalculation when cache expires or data missing

## Deployment

**Registry**: `ghcr.io/thehimanshushekhar/bhayanak_cast`

**Tags:**
- `latest` - Most recent main branch
- `v1.2.3` - Semantic versions
- `sha-abc123` - Commit SHA

**Trigger:** Push to main or git tags (`v*.*.*`)

## Completed Architecture

### WebSocket-First Architecture ✅
- **In-Memory State**: `websocket/room-state.ts` manages room state in Maps
- **Synchronous DB Persistence**: All writes wait for database confirmation
- **Event-Based**: `room:create`, `room:join`, `room:leave`, `room:rejoin`, `streamer:transfer`
- **State Recovery**: Automatic rebuild from database on `room:rejoin` after restart
- **React Integration**: `useRoom()` hook for subscription-based state management
- **Zero Polling**: No HTTP polling, all updates via WebSocket events

### WebRTC Implementation ✅
- P2P mesh architecture (1 streamer → N viewers)
- Simple-Peer pattern with Socket.io signaling
- Screen sharing via `getDisplayMedia()`
- 3 audio configurations (system+mic, mic-only, none)
- Browser "Stop Sharing" detection
- Mobile device restrictions
- 8-15 second transfer timing
- TURN server fallback support

### Remaining Blockers
1. ~~WebRTC infrastructure~~ ✅ **COMPLETED**
2. CDN for media storage (if moving beyond P2P)
3. Scalability testing with multiple servers
