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

### 🎥 **WebRTC Screen Sharing** ⭐ NEW
- **P2P Screen Sharing** with 3 audio modes:
  - System audio + Microphone
  - Microphone only
  - No audio
- **Browser "Stop Sharing" Detection** - Automatic transfer when clicked
- **Mobile Restrictions** - Mobile users can view but cannot stream
- **Adaptive Quality** - Simulcast for best viewing experience
- **Graceful Transfers** - 8-15 second handoff between streamers

### 📺 **Smart Room System**
- **4-State Room Lifecycle**: `waiting` → `preparing` → `active` → `ended`
- Automatic streamer transfer when hosts leave
- Rooms persist without streamers (enters "waiting" state)
- 5-minute grace period before cleanup

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

### ⚡ **Real-Time Everything**
- **WebRTC P2P Streaming** - Peer-to-peer screen sharing
- Live user count via WebSocket
- Instant room updates with Socket.io
- Real-time chat with profanity filtering
- Comprehensive rate limiting (8 action types)

### 🔐 **Secure Authentication**
- Discord OAuth (production ready)
- Email/Password (development only)
- Session management with Better Auth
- Protected routes

## 🚀 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | TanStack Start (React + SSR) |
| **Router** | TanStack Router (File-based) |
| **State** | TanStack Query v5 |
| **Auth** | Better Auth |
| **Database** | PostgreSQL 16 + Drizzle ORM |
| **Real-time** | Socket.io + WebRTC |
| **Streaming** | WebRTC P2P (Simple-Peer pattern) |
| **Styling** | Tailwind CSS v4 |
| **UI Components** | shadcn/ui |

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

## 📖 Room Status Guide

| Status | Meaning | Badge |
|--------|---------|-------|
| 🔘 **Waiting** | No streamer or viewers | Gray |
| 🟡 **Preparing** | Streamer present, not streaming | Yellow |
| 🟢 **Active** | Live streaming in progress | Green |
| ⚫ **Ended** | Room cleaned up | History icon |

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
- **Transfer Stream**: Hand over hosting to any viewer
- **Leave Room**: Automatic transfer or enters "waiting" state
- **Room Stats**: See who's watching and for how long

## 🧪 Development

```bash
# Testing (238 tests, 90%+ coverage)
pnpm test:setup     # One-time test DB setup
pnpm test           # Run all tests
pnpm test:watch     # Watch mode
pnpm test:coverage  # With coverage report

# Code quality
pnpm lint           # Check code style
pnpm format         # Format code
pnpm check          # Run all checks

# Database operations
pnpm db:push        # Push schema changes
pnpm db:generate    # Generate migrations
pnpm db:migrate     # Run migrations
pnpm db:studio      # Open Drizzle Studio

# Individual servers
pnpm dev:web        # Web app only (port 3000)
pnpm dev:ws         # WebSocket only (port 3001)
```

## 🗺️ Roadmap

### Completed ✅
- [x] **WebRTC Screen Sharing** - P2P streaming with audio configuration
- [x] Real-time chat system with profanity filtering
- [x] Comprehensive rate limiting (8 action types)
- [x] Automatic streamer transfer with cooldown
- [x] **238 tests** (191 + 47 WebRTC) with 90%+ coverage
- [x] Complete documentation (11 docs + WebRTC docs)
- [x] Playwright E2E test configuration

### In Progress 🚧
- [ ] E2E tests with Playwright (configuration ready)

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

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

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
