# 🎭 BhayanakCast

> A real-time streaming and chat platform that enables users to create rooms, join conversations, and interact in a seamless virtual environment.

![Project Status](https://img.shields.io/badge/status-in%20development-yellow)
![License](https://img.shields.io/badge/license-MIT-blue)

## ✨ Features

- **🔴 Live Streaming**: Create and host streaming rooms with real-time video sharing
- **💬 Live Chat**: Real-time messaging between room participants
- **👥 Room Management**: Create, join, and leave rooms with real-time participant updates
- **🔒 User Authentication**: Secure account creation and authentication flow
- **📱 Responsive Design**: Seamless experience across desktop and mobile devices

## 🏗️ Architecture

BhayanakCast uses a WebSocket-based architecture for real-time communication:

```
┌─────────────┐       ┌───────────────┐       ┌──────────────┐
│  React UI   │◄─────►│   WebSocket   │◄─────►│  PostgreSQL  │
│  Components │       │    Server     │       │   Database   │
└─────────────┘       └───────────────┘       └──────────────┘
                             │
                      ┌──────┴──────┐
                      │ Room & User │
                      │ Management  │
                      └─────────────┘
```

- **WebSocket Server**: Handles all real-time events using crossws
- **Room System**: Manages rooms, participants, and messages
- **Authentication**: Secure user identity verification
- **Database**: Stores user data, room information, and message history

## 🛠️ Technology Stack

- [React 19](https://react.dev) with [React Compiler](https://react.dev/learn/react-compiler)
- TanStack [Start](https://tanstack.com/start/latest), [Router](https://tanstack.com/router/latest), and [Query](https://tanstack.com/query/latest)
- [Tailwind CSS v4](https://tailwindcss.com/) with [shadcn/ui](https://ui.shadcn.com/) components
- [Drizzle ORM](https://orm.drizzle.team/) with PostgreSQL for data persistence
- [Better Auth](https://www.better-auth.com/) for authentication
- [crossws](https://github.com/crossws) for WebSocket implementation

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ and pnpm/npm
- PostgreSQL database

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/theHimanshuShekhar/BhayanakCast.git
   cd BhayanakCast
   ```

2. **Install dependencies:**

   ```bash
   pnpm install
   ```

3. **Set up environment variables:**

   Create a `.env` file based on [`.env.example`](./.env.example).

4. **Initialize the database:**

   ```bash
   pnpm db push
   ```

5. **Start the development server:**

   ```bash
   pnpm dev
   ```

   Your application will be available at [http://localhost:3000](http://localhost:3000)

## 🚢 Docker Setup

### Requirements

- Docker
- Docker Compose

### Build and Run

```bash
docker-compose up --build
```

This command builds the Docker image and starts the services for the application and the PostgreSQL database.

## 🎮 Usage

1. Open [http://localhost:3000](http://localhost:3000) in your browser.
2. Sign in via Discord authentication.
3. Create a new room or join an existing room using its link.
4. Start streaming and chatting in real-time.

## 🔧 Development Notes

### Authentication

BhayanakCast uses Better Auth with Discord OAuth, which can be customized to use other providers:

- To modify authentication providers, update the [auth config](./src/lib/server/auth.ts)
- For custom sign-in UI, modify the [signin page](./src/routes/signin.tsx)
- Available UI resources: [shadcn/ui login blocks](https://ui.shadcn.com/blocks/login) or [@daveyplate/better-auth-ui](https://better-auth-ui.com/)

### Useful Commands

- **`pnpm auth:generate`** - Regenerate auth database schema
- **`pnpm db`** - Run drizzle-kit commands (e.g. `pnpm db generate`)
- **`pnpm ui`** - Run the shadcn/ui CLI
- **`pnpm format`** - Format code with Prettier
- **`pnpm lint`** - Lint code with ESLint

## 📝 License

[MIT](./LICENSE)

---

Made with ❤️ by the BhayanakCast Team
