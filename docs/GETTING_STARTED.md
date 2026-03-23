# Getting Started

Quick start guide for BhayanakCast development.

## Prerequisites

- Node.js 20+ with pnpm
- PostgreSQL 16+
- Discord OAuth app (for authentication)

## Installation

```bash
# Clone and install dependencies
git clone <repo-url>
cd BhayanakCast
pnpm install

# Copy environment variables
cp .env.example .env.local
# Edit .env.local with your Discord OAuth credentials
```

## Development Commands

### Start Development Servers

```bash
# Run both web and WebSocket servers
pnpm dev

# Run individually
pnpm dev:web    # Web server on port 3000
pnpm dev:ws     # WebSocket server on port 3001
```

### Database Setup

```bash
# Start PostgreSQL (requires Docker)
docker compose up -d postgres

# Push schema changes
pnpm db:push

# Open Drizzle Studio
pnpm db:studio
```

### Testing

```bash
# Run unit and integration tests (204 tests)
pnpm test:unit

# Run specific test file
pnpm vitest run tests/unit/rate-limiter.test.ts

# Watch mode
pnpm test:watch

# With coverage
pnpm test:coverage

# Run E2E tests (requires dev server, run locally only)
pnpm test:e2e
```

**Note:** E2E tests are NOT run in CI. Run them locally before major releases.

### Code Quality

```bash
pnpm lint        # Check code style
pnpm format      # Format code
pnpm check       # Run all checks (lint + format)
```

## Docker Build

### Build and Run Locally

```bash
# Build the Docker image
docker compose build

# Run with Docker Compose (includes PostgreSQL)
docker compose up -d

# View logs
docker compose logs -f

# Stop services
docker compose down
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

### Testing Production Build Locally

```bash
# Build production image
docker build -t bhayanak-cast:test .

# Run with test environment
docker run -p 3000:3000 -p 3001:3001 \
  --env-file .env.local \
  bhayanak-cast:test
```

## First Time Setup

1. **Create Discord OAuth App:**
   - Go to https://discord.com/developers/applications
   - Create new application
   - Add OAuth2 redirect: `http://localhost:3000/api/auth/callback/discord`
   - Copy Client ID and Secret to `.env.local`

2. **Generate Auth Secret:**
   ```bash
   pnpm dlx @better-auth/cli secret
   # Copy output to BETTER_AUTH_SECRET in .env.local
   ```

3. **Start the application:**
   ```bash
   pnpm dev
   # Open http://localhost:3000
   ```

## Common Issues

### PostgreSQL Connection Failed
- Ensure Docker is running: `docker ps`
- Check DATABASE_URL in `.env.local` matches your setup
- Default: `postgresql://postgres:postgres@localhost:5432/postgres`

### WebSocket Connection Failed
- Check VITE_WS_URL in `.env.local`
- Ensure port 3001 is not in use
- Verify both `pnpm dev:web` and `pnpm dev:ws` are running

### Database Schema Out of Sync
```bash
pnpm db:push        # Push local schema changes
# OR
pnpm db:pull        # Pull remote schema changes
```

## Development Workflow

1. Create feature branch
2. Make changes
3. Run tests: `pnpm test`
4. Check code quality: `pnpm check`
5. Commit and push

## See Also

- [Project Structure](./PROJECT_STRUCTURE.md) - Directory layout
- [Coding Standards](./CODING_STANDARDS.md) - Code style and rules
- [Environment Variables](./ENVIRONMENT_VARIABLES.md) - Full configuration guide
