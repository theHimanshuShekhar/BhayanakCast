# BhayanakCast Development Plan

**Last Updated:** March 16, 2026

## Completed Features ✅

### Core Platform
- [x] Discord OAuth authentication (sole method)
- [x] User profile sync from Discord
- [x] 4 theme system (Purple-Blue, Misty-Blue, Onyx-Black, Blue-Gray)
- [x] Real-time user count via WebSocket
- [x] 191 comprehensive tests (155 passing, 36 skipped), 90%+ coverage
- [x] Docker containerization
- [x] GitHub Actions CI/CD to GHCR
- [x] Comprehensive documentation (11 docs)

### Rate Limiting & Security
- [x] Adapter pattern for rate limiting (InMemory + Valkey ready)
- [x] Room creation: 3/minute per user
- [x] Room join: 10/minute per user
- [x] Room leave: 5/minute per user
- [x] Chat: 30 messages/15 seconds
- [x] WebSocket connections: 30/minute per IP
- [x] Streamer transfer: 1/30 seconds per room
- [x] Profanity filter (Hindi + English)

### Room System
- [x] Create/join/leave rooms
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

- [ ] WebRTC integration for actual streaming
- [ ] E2E tests with Playwright

## Planned Features 📋

### High Priority
- [ ] Edit profile (name, avatar)
- [ ] Room categories/tags
- [ ] User search functionality
- [ ] Friend/follow system
- [ ] Notifications

### Medium Priority
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

### Data Flow
1. **Client** emits WebSocket event
2. **Server** updates database
3. **Server** broadcasts to Socket.io room
4. **Clients** refetch via React Query
5. **UI** updates automatically

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

## Blockers

1. WebRTC infrastructure for video/audio streaming
2. CDN for media storage
3. Scalability testing with multiple servers
