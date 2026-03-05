# 🎭 BhayanakCast

> *Where streamers become legends and viewers become friends*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![TanStack](https://img.shields.io/badge/TanStack-Start-FF4154.svg)](https://tanstack.com/start)
[![Tailwind](https://img.shields.io/badge/Tailwind-v4-38B2AC.svg)](https://tailwindcss.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-336791.svg)](https://www.postgresql.org/)

**BhayanakCast** is a real-time streaming platform with a Discord-inspired dark aesthetic, built for creators who want to connect with their audience in a more intimate, community-focused way.

![BhayanakCast Preview](https://via.placeholder.com/800x400/1a1b1e/5865f2?text=BhayanakCast+Preview)

## ✨ Features

### 🎥 **Smart Room System**
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
- Live user count via WebSocket
- Instant room updates
- Real-time participant tracking
- 5-second refresh intervals

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
| **Database** | PostgreSQL 15 + Drizzle ORM |
| **Real-time** | Socket.io |
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
```

Edit `.env.local`:

```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"

# Better Auth
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<generate with: pnpm dlx @better-auth/cli secret>

# OAuth (optional but recommended)
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret

# WebSocket
WS_PORT=3001
CLIENT_URL=http://localhost:3000
VITE_WS_URL=http://localhost:3001
```

### 3. Start PostgreSQL (Docker)

```bash
pnpm docker:up
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
# Run tests
pnpm test

# Lint & format
pnpm check

# Database operations
pnpm db:generate    # Generate migrations
pnpm db:migrate     # Run migrations
pnpm db:studio      # Open Drizzle Studio

# Individual servers
pnpm dev:web        # Web app only (port 3000)
pnpm dev:ws         # WebSocket only (port 3001)
```

## 🗺️ Roadmap

- [ ] Real-time chat system
- [ ] WebRTC video/audio streaming
- [ ] Screen sharing
- [ ] Room categories/tags
- [ ] User profiles & following
- [ ] Notifications system
- [ ] Mobile app (PWA)
- [ ] Virtual gifts & donations

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [TanStack](https://tanstack.com) for the amazing ecosystem
- [Better Auth](https://better-auth.com) for authentication
- [shadcn/ui](https://ui.shadcn.com) for UI components
- The Discord design team for inspiration

---

<p align="center">
  <b>BhayanakCast</b> - Made with ❤️ for streamers and viewers alike
  <br>
  <sub><em>"Bhayanak" means awesome/scary in Hindi - and that's exactly what we are!</em></sub>
</p>
