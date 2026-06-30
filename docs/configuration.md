# Configuration Contract

Implementation must ship a `.env.example` that mirrors this contract.

## Required environment variables

| Name                    | Purpose                                 | Notes                                                                                           |
| ----------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `PORT`                  | Public app/server port                  | TanStack Start and Socket.IO share this port.                                                   |
| `DATABASE_URL`          | PostgreSQL connection string            | Points to the Docker-internal Postgres service, not a public database endpoint.                 |
| `VALKEY_URL`            | Valkey connection string                | Points to the Docker-internal Valkey service for rate limiting.                                 |
| `BETTER_AUTH_URL`       | Public base URL for Better Auth         | Required so Discord OAuth callback URLs use the cloudflared/public origin instead of localhost. |
| `BETTER_AUTH_SECRET`    | Better Auth signing/encryption secret   | Generate per environment; never commit a real value.                                            |
| `DISCORD_CLIENT_ID`     | Discord OAuth application client ID     | Used by Better Auth Discord provider.                                                           |
| `DISCORD_CLIENT_SECRET` | Discord OAuth application client secret | Secret; never expose to the browser.                                                            |
| `ADMIN_DISCORD_IDS`     | Static Platform Admin allowlist         | Comma-separated Discord user IDs.                                                               |

## Optional environment variables

| Name                     | Purpose                        | Default                                                        |
| ------------------------ | ------------------------------ | -------------------------------------------------------------- |
| `NODE_ENV`               | Runtime mode                   | `development` outside production.                              |
| `LOG_LEVEL`              | Server log verbosity           | `info`.                                                        |
| `CLOUDFLARED_PUBLIC_URL` | Human-readable tunnel URL hint | Optional if `BETTER_AUTH_URL` already contains the public URL. |

## Boundaries

- Only the app port is exposed publicly.
- PostgreSQL and Valkey are reachable only from the app backend over Docker internal networking.
- Browser clients never receive database credentials, Valkey connection strings, Better Auth secrets, Discord client secrets, or admin allowlist internals.
