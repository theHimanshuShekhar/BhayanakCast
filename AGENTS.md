# AGENTS.md - Coding Guidelines for BhayanakCast

## Build & Development Commands

```bash
# Development server
pnpm dev

# Build for production
pnpm build

# Run all tests
pnpm test

# Run a single test file
pnpm vitest run path/to/test.ts

# Run tests in watch mode
pnpm vitest

# Lint code
pnpm lint

# Format code
pnpm format

# Check format and lint
pnpm check

# Database operations
pnpm db:generate    # Generate drizzle migrations
pnpm db:migrate     # Run migrations
pnpm db:push        # Push schema changes
pnpm db:studio      # Open drizzle studio
```

## Code Style Guidelines

### Formatting
- **Indentation**: Tabs (configured in biome.json)
- **Quotes**: Double quotes for strings
- **Line endings**: LF
- **Formatter**: Biome (not Prettier)

### Imports
- Use path alias `#/` for src imports: `import { auth } from "#/lib/auth"`
- Organize imports automatically (Biome handles this)
- Group: React/External libs → Internal modules → Types

### Component Naming
- Components: PascalCase (e.g., `Header.tsx`, `UserButton`)
- Default exports for page components and shared components
- Function components with explicit return types when complex

### Types & TypeScript
- Strict TypeScript enabled
- No unused locals or parameters (enforced)
- Use `type` for type imports when possible
- Prefer interfaces for object shapes

### Error Handling
- Use Zod for runtime validation
- Handle async errors with try/catch
- Use `void` prefix for fire-and-forget async calls: `void authClient.signOut()`

### Styling
- **Tailwind CSS v4** with custom Discord-inspired dark theme
- Use theme CSS variables (e.g., `text-text-primary`, `bg-depth-2`)
- Components should use the depth system:
  - `bg-depth-0`: Deepest background (#1a1b1e)
  - `bg-depth-1` to `bg-depth-4`: Increasing elevation
- Never use arbitrary Tailwind values

### Testing
- Framework: Vitest with jsdom environment
- Test utilities: @testing-library/react
- Place tests alongside source files or in `__tests__` folders

## Project Structure

```
src/
├── components/          # Reusable UI components
├── integrations/        # Third-party service integrations
│   ├── better-auth/    # Auth providers and UI
│   ├── posthog/        # Analytics
│   └── tanstack-query/ # Query provider
├── lib/                # Utilities and core logic
│   ├── auth.ts         # Better-auth server config
│   ├── auth-client.ts  # Better-auth client
│   └── utils.ts        # Helper functions
├── routes/             # TanStack Router file-based routes
│   ├── __root.tsx      # Root layout
│   ├── index.tsx       # Home page
│   └── auth/           # Auth pages
└── styles.css          # Global styles with theme
```

## Key Dependencies

- **Framework**: TanStack Start (React + SSR)
- **Router**: TanStack Router (file-based routing)
- **Query**: TanStack Query v5
- **Auth**: Better Auth with better-auth-ui
- **DB**: Drizzle ORM with PostgreSQL
- **Styling**: Tailwind CSS v4 with custom theme
- **Icons**: Lucide React

## Cursor Rules

From `.cursorrules`:
- Use latest shadcn CLI for adding components: `pnpm dlx shadcn@latest add <component>`

## Database

- PostgreSQL running in Docker (see docker-compose.yml)
- Connection: `postgresql://postgres:postgres@localhost:5432/postgres`
- Use drizzle-kit for schema management

## Environment Variables

Required in `.env.local`:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<generate with pnpm dlx @better-auth/cli secret>
VITE_POSTHOG_KEY=<optional>
```
