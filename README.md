# 🎭 BhayanakCast

> *Where streamers become legends and viewers become friends*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![TanStack](https://img.shields.io/badge/TanStack-Start-FF4154.svg)](https://tanstack.com/start)
[![Tailwind](https://img.shields.io/badge/Tailwind-v4-38B2AC.svg)](https://tailwindcss.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org/)

**BhayanakCast** is a real-time streaming platform with a Discord-inspired dark aesthetic, built for creators who want to connect with their audience in a more intimate, community-focused way.

![BhayanakCast Preview](https://via.placeholder.com/800x400/1a1b1e/5865f2?text=BhayanakCast+Preview)

## ✨ Features

### 🎥 **WebRTC Screen Sharing**
- **P2P Screen Sharing** with 3 audio modes:
  - System audio + Microphone
  - System audio only
  - No audio
- **Browser "Stop Sharing" Detection** - Automatic transfer when clicked
- **Mobile Restrictions** - Mobile users can view but cannot stream
- **Connection Recovery** - ICE restart on connection failure
- **Audio Toggle** - Mute/unmute during streaming
- **Graceful Transfers** - Automatic streamer handoff with cooldown

### 📺 **Smart Room System**
- **4-State Room Lifecycle**: `waiting` → `preparing` → `active` → `ended`
- Automatic streamer transfer when hosts leave
- Rooms persist without streamers (enters "waiting" state)
- 5-minute grace period before cleanup
- Mobile users excluded from streamer eligibility

### 👥 **Community First**
- Track time spent with other users automatically
- Discover your top connections
- Community stats with live participant counts
- Anonymous browsing for non-logged-in users

### 🎨 **Discord-Inspired Design**
- 4 beautiful themes: Purple-Blue, Misty-Blue, Onyx-Black, Blue-Gray
- Depth-based elevation system
- JetBrains Mono monospace font
- Smooth transitions and animations

### ⚡ **WebSocket-First Architecture**
- **In-Memory State** - WebSocket server is primary source of truth
- **Synchronous DB Persistence** - All operations wait for DB confirmation
- **Auto-Rejoin** - Automatic recovery after server restart
- **Real-Time Updates** - No polling, instant state sync
- Live user count via WebSocket
- Real-time chat with profanity filtering
- Comprehensive rate limiting (9 action types)

### 🔐 **Secure Authentication**
- Discord OAuth (production ready)
- Email/Password (development only)
- Session management with Better Auth
- Protected routes

### 🐳 **Docker Support**
- Multi-stage Dockerfile for optimized builds
- Combined web app + WebSocket server in single container
- Automatic CI/CD deployment to GitHub Container Registry

## 🚀 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | TanStack Start (React + SSR) |
| **Router** | TanStack Router (File-based) |
| **State** | TanStack Query v5 |
| **Auth** | Better Auth |
| **Database** | PostgreSQL 16 + Drizzle ORM |
| **Real-time** | Socket.io + WebRTC |
| **Streaming** | WebRTC P2P |
| **Styling** | Tailwind CSS v4 |
| **UI Components** | shadcn/ui |
| **Container** | Docker + GitHub Container Registry |

## 🛠️ Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 15+ (or Docker)
- pnpm

### 1. Clone & Install

```bash
git clone https://github.com/yourusername/bhayanak-cast.git
cd bhayanak-cast
pnpm install
```

### 2. Environment Setup

```bash
cp .env.example .env.local
# Edit .env.local with your Discord OAuth credentials
```

Required environment variables:
- `DATABASE_URL` - PostgreSQL connection string
- `BETTER_AUTH_SECRET` - Generate with `pnpm dlx @better-auth/cli secret`
- `DISCORD_CLIENT_ID` & `DISCORD_CLIENT_SECRET` - From Discord Developer Portal

See [Environment Variables](docs/ENVIRONMENT_VARIABLES.md) for complete configuration.

### 3. Start PostgreSQL (Docker)

```bash
docker compose up -d postgres
```

### 4. Database Setup

```bash
pnpm db:push
```

### 5. Run Development Server

```bash
pnpm dev
```

This starts both the web app (port 3000) and WebSocket server (port 3001).

## 🐳 Docker Deployment

### Build and Run Locally

```bash
# Build the Docker image
docker compose build

# Run with Docker Compose (includes PostgreSQL)
docker compose up -d
```

The app will be available at:
- Web App: http://localhost:3000
- WebSocket: http://localhost:3001

### Production Deployment

The Docker image is automatically built and pushed to GitHub Container Registry on pushes to `main` and version tags.

```bash
# Pull from GHCR
docker pull ghcr.io/yourusername/bhayanak-cast:latest

# Run with environment variables
docker run -p 3000:3000 -p 3001:3001 \
  -e DATABASE_URL=postgresql://... \
  -e BETTER_AUTH_SECRET=... \
  -e DISCORD_CLIENT_ID=... \
  -e DISCORD_CLIENT_SECRET=... \
  ghcr.io/yourusername/bhayanak-cast:latest
```

## 📖 Room Status Guide

| Status | Meaning | Badge | When it happens |
|--------|---------|-------|-----------------|
| 🔘 **Waiting** | Room active, no streamer | Gray | Streamer leaves with no viewers |
| 🟡 **Preparing** | Streamer present, not streaming | Yellow | Streamer stops stream OR new streamer assigned |
| 🟢 **Active** | Live streaming in progress | Green | 2+ participants with streamer |
| ⚫ **Ended** | Room closed permanently | History icon | Empty for 5+ minutes |

**Important:** Rooms do NOT end when the stream ends. They only end after being empty for 5+ minutes.

## 🎯 Usage

### Creating a Room
1. Click "Create Room" on the home page
2. Enter room name and optional description
3. You're automatically set as the streamer
4. Share the room link with friends!

### Joining a Room
1. Browse active rooms on the home page
2. Click any room card to enter
3. Automatically join as a participant
4. Your watch time is tracked!

### Streamer Features
- **Start/Stop Streaming**: Toggle streaming without leaving room
- **Transfer Stream**: Hand over hosting to any eligible viewer
- **Leave Room**: 
  - If viewers exist → automatic transfer to oldest viewer
  - If no viewers → room enters "waiting" state (NOT ended)
- **Room Stats**: See who's watching and for how long

**Note:** When you stop streaming, the room stays in "preparing" status. The room only ends after being empty for 5+ minutes.

## 🧪 Testing

```bash
# Unit and integration tests (204 tests, 90%+ coverage)
pnpm test:unit      # Run Vitest tests
pnpm test:watch     # Watch mode
pnpm test:coverage  # With coverage report

# E2E tests (23 tests) - Run locally only, requires dev server
pnpm test:e2e       # Playwright E2E tests
```

**Note:** E2E tests are NOT run in CI (GitHub Actions) as they require the development server running. They should be run locally before major releases.

## 🗺️ Roadmap

### Completed ✅
- [x] **WebSocket-First Architecture** - In-memory state with DB persistence
- [x] **WebRTC Screen Sharing** - P2P streaming with audio configuration
- [x] **265 tests** (204 unit/integration + 23 E2E + 38 skipped) with 90%+ coverage
- [x] **Playwright E2E test suite** (23 tests)
- [x] Real-time chat system with profanity filtering
- [x] Comprehensive rate limiting (9 action types)
- [x] Automatic streamer transfer with cooldown
- [x] Complete documentation (14 docs + WebRTC docs)
- [x] Docker containerization with GHCR deployment
- [x] CI/CD with GitHub Actions

### Planned 📋
- [ ] Room categories/tags
- [ ] User profiles & following
- [ ] Notifications system
- [ ] Stream recording/replay
- [ ] Mobile app (PWA)
- [ ] Virtual gifts & donations

## 📚 Documentation

Comprehensive documentation is available in the `/docs` directory:

- **[AGENTS.md](AGENTS.md)** - Developer guide and coding standards
- **[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)** - Detailed setup instructions
- **[docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md)** - Directory organization
- **[docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md)** - Table definitions
- **[docs/ROOM_SYSTEM.md](docs/ROOM_SYSTEM.md)** - Room lifecycle and business logic
- **[docs/WEBSOCKET_EVENTS.md](docs/WEBSOCKET_EVENTS.md)** - Socket.io events reference
- **[docs/TESTING.md](docs/TESTING.md)** - Testing guide
- **[docs/RATE_LIMITING.md](docs/RATE_LIMITING.md)** - Rate limit configuration
- **[docs/webrtc/README.md](docs/webrtc/README.md)** - WebRTC streaming documentation
- **[PLAN.md](PLAN.md)** - Roadmap and features

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [TanStack](https://tanstack.com) for the amazing ecosystem (Start, Router, Query)
- [Better Auth](https://better-auth.com) for authentication
- [Drizzle ORM](https://orm.drizzle.team) for type-safe database operations
- [Socket.io](https://socket.io) for real-time communication
- [shadcn/ui](https://ui.shadcn.com) for UI components
- The Discord design team for inspiration

---

<p align="center">
  <b>BhayanakCast</b> - Made with ❤️ for streamers and viewers alike
  <br>
  <sub><em>"Bhayanak" means awesome/scary in Hindi - and that's exactly what we are!</em></sub>
  <br><br>
  <sub>👩‍💻 New developer? Start with <a href="./AGENTS.md">AGENTS.md</a></sub>
</p>