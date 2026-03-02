# BhayanakCast Knowledge Base

## Project Overview

**BhayanakCast** is a TanStack Start application with a Discord-inspired dark theme, featuring user authentication, streaming rooms, and user relationship tracking.

## Architecture

### Framework Stack
- **Framework**: TanStack Start (React + SSR)
- **Router**: TanStack Router (file-based routing)
- **Query**: TanStack Query v5
- **Auth**: Better Auth v1.4.12 with email/password
- **Database**: PostgreSQL 15 + Drizzle ORM
- **Styling**: Tailwind CSS v4 with custom theme
- **UI Components**: shadcn/ui + better-auth-ui

### File Structure
```
src/
├── components/          # Reusable UI components
├── db/                  # Database layer
│   ├── index.ts         # Database connection (Pool)
│   ├── schema.ts        # Drizzle ORM schema
│   └── queries.ts       # Database query utilities
├── integrations/        # Third-party integrations
│   ├── better-auth/    # Auth providers
│   ├── posthog/        # Analytics
│   └── tanstack-query/ # Query provider
├── lib/                # Utilities and core logic
│   ├── auth.ts         # Better-auth server config
│   ├── auth-client.ts  # Better-auth client
│   ├── auth-guard.ts   # Route protection utilities
│   └── db.ts           # (Removed - use db/index.ts)
├── routes/             # TanStack Router file-based routes
│   ├── __root.tsx      # Root layout
│   ├── index.tsx       # Home page (public)
│   ├── profile.$userId.tsx  # Profile page (public)
│   └── auth/$authView.tsx   # Auth pages
└── styles.css          # Global styles with theme
```

## Key Implementation Details

### Database Setup

**Connection**: Use `Pool` from `pg` for connection pooling:
```typescript
// src/db/index.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

**Important**: The non-null assertion `!` is forbidden by Biome. Always validate env vars:
```typescript
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}
```

### Better Auth Configuration

**Critical**: Must use `usePlural: true` with Drizzle adapter:
```typescript
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,  // REQUIRED - looks for "users" not "user"
    schema,
  }),
  emailAndPassword: { enabled: true },
});
```

### Route Protection

Use `beforeLoad` for auth protection in route definitions:

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { requireAuth, publicRoute } from "#/lib/auth-guard";

// Protected route
export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
  beforeLoad: requireAuth,  // Redirects to sign-in if not authenticated
});

// Public route (explicit)
export const Route = createFileRoute("/")({
  component: HomePage,
  beforeLoad: publicRoute,  // Explicitly public
});
```

**Current Public Routes**:
- `/` - Home page
- `/profile/$userId` - User profiles (viewable by anyone)
- `/auth/$authView` - Sign in/up pages

### Server Functions

Always use `inputValidator` (not `validator`):
```typescript
import { createServerFn } from "@tanstack/react-start";

const myServerFn = createServerFn({ method: "GET" })
  .inputValidator((data: { userId: string }) => data)
  .handler(async ({ data }) => {
    // Server-side logic
    return result;
  });
```

### UserButton Customization

```tsx
import { UserButton } from "@daveyplate/better-auth-ui";
import { User } from "lucide-react";

<UserButton
  size="sm"
  disableDefaultLinks  // Remove default settings/sign out links
  additionalLinks={[   // Add custom links
    {
      label: "Profile",
      href: `/profile/${userId}`,
      icon: <User className="h-4 w-4" />,
    },
  ]}
/>
```

### Theme System

Custom Discord-inspired dark theme with depth levels:
- `bg-depth-0` - Deepest background (#1a1b1e)
- `bg-depth-1` to `bg-depth-4` - Increasing elevation
- Never use arbitrary Tailwind values

### Environment Variables

Required in `.env.local`:
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<generate with pnpm dlx @better-auth/cli secret>
VITE_POSTHOG_KEY=<optional>
```

## Common Issues & Solutions

### 422 Error on Sign-up
**Cause**: Missing database adapter configuration
**Solution**: Ensure `drizzleAdapter` is properly configured with `usePlural: true`

### "Model 'user' not found" Error
**Cause**: Better Auth looking for singular table names
**Solution**: Add `usePlural: true` to adapter config

### Type Errors with Server Functions
**Cause**: Using `.validator()` instead of `.inputValidator()`
**Solution**: Use `.inputValidator()` method

### Database Import Errors
**Cause**: Using wrong import path
**Solution**: Import from `#/db/index` not `#/lib/db`

## Development Commands

```bash
# Development server
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test

# Lint and format
pnpm check
pnpm format
pnpm lint

# Database operations
pnpm db:generate    # Generate drizzle migrations
pnpm db:migrate     # Run migrations
pnpm db:push        # Push schema changes
pnpm db:studio      # Open drizzle studio
```

## Database Schema

### Better Auth Tables (Auto-managed)
- `users` - User accounts
- `sessions` - Active sessions
- `accounts` - OAuth accounts
- `verifications` - Email verification codes

### Application Tables
- `streaming_rooms` - Active/past streaming sessions
- `room_participants` - User participation in rooms
- `user_relationships` - Aggregated time between users
- `user_room_overlaps` - Detailed overlap logs

## Code Style Guidelines

### Formatting
- **Indentation**: Tabs (configured in biome.json)
- **Quotes**: Double quotes for strings
- **Formatter**: Biome (not Prettier)
- **No non-null assertions**: Use proper validation instead of `!`

### Imports
- Use path alias `#/` for src imports
- Organize imports automatically (Biome handles this)
- Group: React/External → Internal modules → Types

### TypeScript
- Strict mode enabled
- No unused locals or parameters (enforced)
- Prefer interfaces for object shapes
- Use `type` for type imports when possible

## Future Enhancements

Potential features to implement:
- [ ] Room creation and management
- [ ] Real-time streaming integration
- [ ] User search functionality
- [ ] Friend request system
- [ ] Notifications
- [ ] User settings page
- [ ] Admin dashboard

## Important Notes

1. **Never commit secrets** - `.env.local` contains sensitive data
2. **Route files** - Must match TanStack Router's file-based routing conventions
3. **Server functions** - Always validate input data
4. **Theme** - Hardcoded to dark mode in `__root.tsx` (THEME_INIT_SCRIPT)
5. **Auth redirects** - Use `beforeLoad` for SSR-safe redirects

## References

- [Better Auth UI Docs](https://better-auth-ui.com)
- [TanStack Router Docs](https://tanstack.com/router/latest)
- [TanStack Start Docs](https://tanstack.com/start/latest)
- [Drizzle ORM Docs](https://orm.drizzle.team)
- [Better Auth Docs](https://www.better-auth.com)
