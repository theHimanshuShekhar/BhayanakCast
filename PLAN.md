# BhayanakCast Development Plan

This document outlines the current state and future development plans for BhayanakCast.

**Last Updated:** March 5, 2026  
**Version:** 1.1

---

## Current Routes Overview

### 1. Home Page (`/`)
**Status:** ✅ Core Implementation Complete  
**Priority:** High

#### Implemented:
- [x] Active rooms listing with debounced search (TanStack Pacer)
- [x] Room cards with live indicators and streamer info
- [x] Server-side room search with PostgreSQL full-text
- [x] Time-weighted trending algorithm (viewer count × 0.6 + recency × 0.4)
- [x] 30-minute data caching for performance
- [x] Create Room button (UI only)
- [x] Responsive grid layout (1-3 columns)
- [x] Live/Ended room sections

#### Implemented:
- [x] **Create Room Functionality** - Backend API and UI modal for creating streaming rooms
- [x] **Room Lifecycle Management** - Join/leave tracking with auto-leave previous room
- [x] **Streamer Transfer** - Automatic and manual streamer ownership transfer
- [x] **Active Room Indicator** - Bottom-right card showing current room with leave button
- [x] **Room Cleanup Cron** - 5-minute cron job to end inactive rooms
- [x] **Past Streams Visibility** - Only show ended streams for 3 hours
- [x] **Room Status System** - Four states: waiting, preparing, active, ended
- [x] **Streamer Null Handling** - Rooms can exist without a streamer (waiting status)

#### Pending:
- [ ] **Real-time Participant Counts** - WebSocket updates for room viewer counts
- [ ] **Room Categories/Tags** - Filter rooms by category (Gaming, Coding, Music, etc.)
- [ ] **Room Sorting Options** - Sort by viewers, recent, trending
- [ ] **Pagination** - Handle large number of rooms
- [ ] **Room Thumbnails** - Support for room cover images

---

### 2. Room Detail Page (`/room/$roomId`)
**Status:** ✅ UI Complete, ⚠️ Needs Real Data  
**Priority:** High

#### Implemented:
- [x] Room header with duration and max viewers
- [x] Streamer info section with profile link
- [x] Viewers list with watch time
- [x] Mock data for demonstration

#### Implemented:
- [x] **Join/Leave Room Tracking** - Backend participant management with auto-join on enter
- [x] **Streamer Controls** - Transfer stream ownership, end stream
- [x] **5-Minute Grace Period** - Empty rooms stay in waiting status for 5 mins before cleanup

#### Pending:
- [ ] **Real-time Chat** - WebSocket-based chat system
- [ ] **Video/Audio Streaming** - WebRTC integration for actual streaming
- [ ] **Screen Share** - Allow streamers to share screen
- [ ] **Room Permissions** - Public vs private rooms, password protection
- [ ] **Room Settings** - Edit room details, kick/ban users
- [ ] **Recording/Replay** - Save streams for later viewing
- [ ] **Raised Hand Feature** - Request to speak in chat

---

### 3. User Profile Page (`/profile/$userId`)
**Status:** ✅ Core Complete  
**Priority:** Medium

#### Implemented:
- [x] User profile display (name, email, image)
- [x] Top 5 connections with time spent
- [x] Database query for relationships

#### Pending:
- [ ] **Edit Profile** - Update name, avatar, bio
- [ ] **Profile Stats Dashboard** - Total watch time, rooms joined, favorite categories
- [ ] **Streaming History** - List of past attended streams
- [ ] **Achievements/Badges** - Gamification elements
- [ ] **Follow System** - Follow users to get notified when they stream
- [ ] **Block/Report Users** - Moderation features
- [ ] **Privacy Settings** - Control profile visibility

---

### 4. Authentication (`/auth/sign-in`)
**Status:** ✅ Complete  
**Priority:** High

#### Implemented:
- [x] Better Auth integration
- [x] Discord OAuth (only authentication method)
- [x] User profile sync from Discord (name, email, avatar)
- [x] Profile refresh on every login
- [x] Session management
- [x] Protected routes

#### Authentication Flow:
1. User clicks "Continue with Discord" button
2. Discord OAuth redirects to `/api/auth/callback/discord`
3. User data (username, email, avatar) synced from Discord
4. New users automatically created, existing users updated
5. Redirected to home page after successful login

#### Pending:
- [ ] **Additional OAuth Providers** - Google, GitHub login (optional)

---

## Sidebar Components

### Theme System
**Status:** ✅ Complete  
**Implemented:**
- [x] 4 color themes (Purple-Blue, Misty-Blue, Onyx-Black, Blue-Gray)
- [x] Theme cycling button
- [x] Persistent storage (localStorage)
- [x] Smooth transitions

#### Pending:
- [ ] **Custom Theme Builder** - User-defined accent colors
- [ ] **Light Mode** - Full light theme variant
- [ ] **Auto Theme** - Sync with system preference

---

### User Stats Card (Logged In)
**Status:** ✅ Complete  
**Implemented:**
- [x] Personal stats (watch time, rooms joined, connections)
- [x] Community stats (total users, watch hours, etc.)
- [x] Top connections list
- [x] Create room button (UI)
- [x] 30-minute data caching

#### Pending:
- [ ] **Real-time Stat Updates** - WebSocket for live stat changes
- [ ] **Stat History Charts** - Show stats over time
- [ ] **Export Data** - Download personal stats

---

### Anonymous Stats Column (Logged Out)
**Status:** ✅ Complete  
**Implemented:**
- [x] Global site stats
- [x] Trending rooms
- [x] Community stats
- [x] Call to action

#### Pending:
- [ ] **Featured Streamers** - Highlight popular creators
- [ ] **Platform Announcements** - News and updates section

---

## Database & Backend

### Current Schema
- [x] Users (Better Auth)
- [x] Streaming Rooms
- [x] Room Participants
- [x] User Relationships
- [x] User Room Overlaps

### Pending Database Features:
- [ ] **Room Categories Table** - Categories and tags
- [ ] **Chat Messages Table** - Store chat history
- [ ] **Notifications Table** - User notifications
- [ ] **Reports Table** - Moderation reports
- [ ] **Room Settings Table** - Room configuration

---

## Room Status System

### Status States

| Status | Description | Visual Indicator |
|--------|-------------|------------------|
| **waiting** | No streamer or viewers present | Gray dot • "Waiting" |
| **preparing** | Streamer present but not streaming | Yellow dot • "Preparing" |
| **active** | Streamer actively streaming (WebRTC) | Green dot • "Streaming" |
| **ended** | Room cleaned up after grace period | History icon • "Ended" |

### Status Transitions

```
Create Room → preparing (streamer joins)
Streamer Leaves + Viewers Remain → new streamer promoted → preparing
Streamer Leaves + No One Left → waiting
waiting + 5 min empty → ended (cleanup)
```

### Implementation Details
- **Database**: `streamerId` column is nullable, `status` has 4 values
- **Cleanup**: Cron job runs every 5 minutes to end `waiting` rooms empty for 5+ minutes
- **UI**: RoomCard shows appropriate status badge and "No Streamer" when applicable
- **Queries**: All queries use `leftJoin` for streamer relationship to handle null cases

---

## WebSocket Infrastructure

### Current:
- [x] Basic Socket.io server
- [x] Global user count tracking
- [x] Client connection management
- [x] **Room-specific Channels** - Join/leave room events
- [x] **Stream Status Updates** - Streamer transfer and room ended notifications
- [x] **Viewer Presence** - Track participants in rooms

### Pending:
- [ ] **Chat Messages** - Real-time chat
- [ ] **Typing Indicators** - Show when users are typing
- [ ] **Heartbeat System** - Detect inactive users

---

## Performance & Optimization

### Implemented:
- [x] 30-minute data caching (2-minute for community stats)
- [x] Debounced search
- [x] Server-side rendering (TanStack Start)
- [x] Code splitting with lazy loading

### Pending:
- [ ] **Image Optimization** - Next-gen formats, lazy loading
- [ ] **Virtual Scrolling** - For long room lists
- [ ] **Service Worker** - Offline support
- [ ] **CDN Integration** - Static asset delivery
- [ ] **Database Indexing** - Optimize slow queries
- [ ] **Redis Caching** - Replace in-memory cache

---

## Security & Moderation

### Implemented:
- [x] Authentication with Better Auth
- [x] Protected routes

### Pending:
- [ ] **Rate Limiting** - Prevent spam/abuse
- [ ] **Content Moderation** - Auto-flag inappropriate content
- [ ] **IP Banning** - Block malicious users
- [ ] **CSRF Protection** - Secure forms
- [ ] **CSP Headers** - Content Security Policy
- [ ] **Audit Logs** - Track admin actions

---

## Mobile & Responsive

### Current:
- [x] Responsive grid layouts
- [x] Mobile-friendly sidebar
- [x] Touch-friendly buttons

### Pending:
- [ ] **Mobile App** - React Native or PWA
- [ ] **Mobile Navigation** - Bottom tab bar
- [ ] **Touch Gestures** - Swipe to navigate
- [ ] **Mobile Streaming** - Stream from mobile devices

---

## Analytics & Monitoring

### Pending:
- [ ] **PostHog Integration** - Product analytics
- [ ] **Error Tracking** - Sentry integration
- [ ] **Performance Monitoring** - Core Web Vitals
- [ ] **User Analytics** - Engagement metrics
- [ ] **Stream Analytics** - Viewer retention, peak times

---

## Accessibility (a11y)

### Current:
- [x] Semantic HTML
- [x] ARIA labels on interactive elements

### Pending:
- [ ] **Keyboard Navigation** - Full keyboard support
- [ ] **Screen Reader Testing** - NVDA/VoiceOver
- [ ] **Focus Management** - Visible focus indicators
- [ ] **Color Contrast Audit** - WCAG 2.1 AA compliance
- [ ] **Reduced Motion** - Respect prefers-reduced-motion

---

## Future Features (Nice to Have)

- [ ] **Virtual Gifts** - Monetization through donations
- [ ] **Subscriptions** - Follow streamers with benefits
- [ ] **Clip Creation** - Save highlights from streams
- [ ] **Polls/Quizzes** - Interactive stream elements
- [ ] **Multi-stream Viewing** - Watch multiple rooms
- [ ] **Stream Scheduling** - Schedule upcoming streams
- [ ] **Discord Integration** - Sync roles, notifications
- [ ] **API for Developers** - Third-party integrations

---

## Current Blockers

1. **WebSocket Room Management** - Needed for real-time features
2. **WebRTC Integration** - Needed for actual streaming
3. **Video Infrastructure** - Storage, CDN, encoding

---

## Development Priorities (Next 30 Days)

### Recently Completed ✅
1. **Create Room Backend** - Allow users to create rooms
2. **Room Join/Leave Tracking** - Track participants in real-time
3. **Streamer Transfer** - Automatic and manual ownership transfer with null streamer support
4. **Room Lifecycle** - 5-min grace period, 3-hour past stream visibility
5. **Discord OAuth** - Authentication via Discord (sole auth method)
6. **Discord Profile Sync** - Auto-sync username, email, avatar on every login
7. **Room Status System** - Four-state status (waiting, preparing, active, ended)
8. **Community Stats Caching** - Reduced to 2-minute refresh for better UX
9. **Database Schema Update** - Made streamerId nullable with proper cascade handling
10. **Combined Docker Service** - Web app and WebSocket server in single container
11. **Removed Excessive Logging** - Cleaned up unnecessary console logs
12. **Comprehensive Test Suite** - 59 tests covering database queries, components, and integration
    - Unit tests for UI components (RoomCard, CreateRoomModal, CommunityStatsCard)
    - Integration tests for database queries and stats calculations
    - PostgreSQL test database with proper isolation
    - 90%+ code coverage threshold configured
13. **Social Media Meta Tags** - Open Graph and Twitter Card tags for social sharing
    - Dynamic og:title, og:description, og:image, og:url per room
    - Twitter Card support (twitter:title, twitter:description, twitter:image, twitter:url)
14. **Production URL** - Site configured for https://cast.bhayanak.net

### Up Next 🚀
1. **Basic Chat System** - Text chat in rooms
2. **Edit Profile** - Allow users to update their profile
3. **Additional OAuth** - Google/GitHub authentication
4. **Rate Limiting** - Prevent abuse on room creation/joining

---

## Notes

- All mock data should be replaced with real implementations
- Database queries use 30-minute caching for most data, 2-minute for community stats
- WebSocket implementation needs scalability testing
- Room cleanup runs every 5 minutes via cron job
- Room status system supports 4 states: waiting, preparing, active, ended
- Streamer can be null (room enters "waiting" status)
- Consider implementing rate limiting before public launch
- WebRTC integration pending for actual "active" streaming status

---

**Document Maintainer:** Update this file after each major feature completion
