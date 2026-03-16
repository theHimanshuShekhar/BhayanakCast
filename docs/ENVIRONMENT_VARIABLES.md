# Environment Variables

Configuration guide for BhayanakCast.

## Required Variables

These must be set for the application to run:

### DATABASE_URL
PostgreSQL connection string.

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
```

**Format:** `postgresql://user:password@host:port/database`

**Docker Compose:**
```bash
# When using docker compose postgres service
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
```

### BETTER_AUTH_URL
Base URL for authentication callbacks.

```bash
# Development
BETTER_AUTH_URL=http://localhost:3000

# Production
BETTER_AUTH_URL=https://yourdomain.com
```

### BETTER_AUTH_SECRET
Random secret for JWT signing.

```bash
# Generate with:
pnpm dlx @better-auth/cli secret

# Copy output to .env.local:
BETTER_AUTH_SECRET=36fd9da9de379a11f885695ce91633bddbecd5a43926b305315b9bfca408d65c
```

**Security:** Never commit this value. Keep it secret.

### DISCORD_CLIENT_ID
From Discord Developer Portal.

```bash
DISCORD_CLIENT_ID=1473347347168624874
```

**Setup:**
1. Go to https://discord.com/developers/applications
2. Create New Application
3. Copy Application ID

### DISCORD_CLIENT_SECRET
From Discord Developer Portal.

```bash
DISCORD_CLIENT_SECRET=jkspf5ntHLCtuGKSfXGYIn3wU6Gu4C83
```

**Setup:**
1. In your Discord app, go to OAuth2 section
2. Reset Client Secret
3. Copy the secret (shown only once!)

**Security:** Never commit this value.

### OAuth Redirect URIs

Configure in Discord Developer Portal → OAuth2 → Redirects:

```
# Development
http://localhost:3000/api/auth/callback/discord

# Production
https://yourdomain.com/api/auth/callback/discord
```

## WebSocket Configuration

### VITE_WS_URL
WebSocket server URL (used by client).

```bash
# Development
VITE_WS_URL=http://localhost:3001

# Production with SSL
VITE_WS_URL=https://ws.yourdomain.com
```

**Note:** Port is automatically parsed from this URL.

### CLIENT_URL
Allowed origin for CORS.

```bash
# Development
CLIENT_URL=http://localhost:3000

# Production
CLIENT_URL=https://yourdomain.com
```

## Optional Variables

### VITE_BETTER_AUTH_URL
Client-side auth URL (usually same as BETTER_AUTH_URL).

```bash
VITE_BETTER_AUTH_URL=http://localhost:3000
```

### VITE_POSTHOG_KEY
PostHog analytics key (optional).

```bash
VITE_POSTHOG_KEY=phc_64r944TQrfCLEldgz4GicWrXUrImdMEqeINAdsLxVMN
```

### VITE_POSTHOG_HOST
PostHog host (optional, defaults to EU).

```bash
VITE_POSTHOG_HOST=https://eu.i.posthog.com
```

## Environment-Specific Configurations

### Development (.env.local)

```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"

# Auth
BETTER_AUTH_URL=http://localhost:3000
VITE_BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=<generate-with-cli>

# Discord OAuth
DISCORD_CLIENT_ID=<your-app-id>
DISCORD_CLIENT_SECRET=<your-secret>

# WebSocket
VITE_WS_URL=http://localhost:3001
CLIENT_URL=http://localhost:3000

# Analytics (optional)
VITE_POSTHOG_KEY=<optional>
VITE_POSTHOG_HOST=https://eu.i.posthog.com
```

### Production (.env.production)

```bash
# Database (use connection pooler for serverless)
DATABASE_URL="postgresql://user:pass@pooler.supabase.com:6543/postgres"

# Auth (HTTPS required)
BETTER_AUTH_URL=https://bhayanakcast.com
VITE_BETTER_AUTH_URL=https://bhayanakcast.com
BETTER_AUTH_SECRET=<strong-random-secret>

# Discord OAuth
DISCORD_CLIENT_ID=<production-app-id>
DISCORD_CLIENT_SECRET=<production-secret>

# WebSocket (can be same domain with different path)
VITE_WS_URL=https://bhayanakcast.com
CLIENT_URL=https://bhayanakcast.com

# Analytics
VITE_POSTHOG_KEY=<production-key>
```

### Docker Deployment

```bash
# docker-compose.yml environment
environment:
  DATABASE_URL: postgresql://postgres:postgres@postgres:5432/postgres
  BETTER_AUTH_URL: ${BETTER_AUTH_URL}
  BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
  VITE_WS_URL: ${VITE_WS_URL}
  CLIENT_URL: ${CLIENT_URL}
```

## Security Best Practices

1. **Never commit secrets:**
   ```bash
   # Add to .gitignore
   .env.local
   .env.production
   ```

2. **Use strong secrets:**
   ```bash
   # Generate cryptographically secure secret
   openssl rand -hex 32
   ```

3. **Rotate secrets regularly:**
   - BETTER_AUTH_SECRET: Rotate monthly
   - DISCORD_CLIENT_SECRET: Rotate if compromised

4. **Production checklist:**
   - [ ] HTTPS for all URLs
   - [ ] Strong random BETTER_AUTH_SECRET
   - [ ] Production Discord app (not dev)
   - [ ] CORS configured correctly
   - [ ] Database credentials secured

## Troubleshooting

### "Invalid client" error
- Check DISCORD_CLIENT_ID is correct
- Verify redirect URI matches exactly (including http/https)

### "Database connection failed"
- Check DATABASE_URL format
- Ensure PostgreSQL is running
- Verify user/password

### "WebSocket connection failed"
- Check VITE_WS_URL matches WebSocket server port
- Ensure port is not blocked by firewall
- Verify CLIENT_URL for CORS

### Auth not working
- Verify BETTER_AUTH_SECRET is set
- Check BETTER_AUTH_URL matches your domain
- Ensure cookies are not blocked

## Validation

Run this to check your environment:

```bash
# Check required vars are set
node -e "
const required = ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 
                  'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'VITE_WS_URL'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error('Missing:', missing.join(', '));
  process.exit(1);
}
console.log('All required variables set!');
"
```

## See Also

- [Getting Started](./GETTING_STARTED.md) - Setup instructions
- [Docker Deployment](#) - Production deployment guide
