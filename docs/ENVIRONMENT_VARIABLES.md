# Environment Variables

## Required

### Database
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
```

### Authentication (Better Auth)
```bash
BETTER_AUTH_URL=http://localhost:3000        # Production: https://yourdomain.com
BETTER_AUTH_SECRET=<generate-with-cli>       # pnpm dlx @better-auth/cli secret
```

### Discord OAuth
```bash
DISCORD_CLIENT_ID=<your-discord-app-id>
DISCORD_CLIENT_SECRET=<your-discord-client-secret>
```

Setup: [discord.com/developers/applications](https://discord.com/developers/applications)
- Create app → OAuth2 → copy Client ID and Secret
- Add redirect: `http://localhost:3000/api/auth/callback/discord`

### WebSocket
```bash
VITE_WS_URL=http://localhost:3001    # Production: https://ws.yourdomain.com
CLIENT_URL=http://localhost:3000     # CORS origin for WS server
```

## Optional
```bash
VITE_BETTER_AUTH_URL=http://localhost:3000   # Client-side auth URL (same as BETTER_AUTH_URL)
VITE_POSTHOG_KEY=<your-posthog-key>          # Analytics (PostHog)
VITE_POSTHOG_HOST=https://eu.i.posthog.com
```

## Development `.env.local`
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
BETTER_AUTH_URL=http://localhost:3000
VITE_BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<generate-with-cli>
DISCORD_CLIENT_ID=<your-app-id>
DISCORD_CLIENT_SECRET=<your-secret>
VITE_WS_URL=http://localhost:3001
CLIENT_URL=http://localhost:3000
```

## Production
```bash
DATABASE_URL="postgresql://user:pass@host:5432/dbname"
BETTER_AUTH_URL=https://cast.bhayanak.net
VITE_BETTER_AUTH_URL=https://cast.bhayanak.net
BETTER_AUTH_SECRET=<strong-random-secret>
DISCORD_CLIENT_ID=<production-app-id>
DISCORD_CLIENT_SECRET=<production-secret>
VITE_WS_URL=https://cast.bhayanak.net
CLIENT_URL=https://cast.bhayanak.net
```

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| "Invalid client" | Wrong `DISCORD_CLIENT_ID` or redirect URI mismatch | Check Discord app settings |
| "Database connection failed" | `DATABASE_URL` wrong or Postgres not running | `docker compose up -d postgres` |
| "WebSocket connection failed" | `VITE_WS_URL` wrong or port mismatch | Verify both servers running |
| "Auth not working" | `BETTER_AUTH_SECRET` not set | Generate and set the secret |

## Security
- Never commit `.env.local` or `.env.production`
- `BETTER_AUTH_SECRET` and `DISCORD_CLIENT_SECRET` must stay private
- Production requires HTTPS for all URLs
