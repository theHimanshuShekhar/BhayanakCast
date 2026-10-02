# Deploying BhayanakCast

BhayanakCast runs on the homelab as a **git-backed Dockhand stack** built from this repo's
`docker-compose.yml` (ADR 9 and its addenda). The homelab's **shared cloudflared** publishes it as
`https://cast.bhayanak.net`. This stack has no tunnel of its own.

```
browser ──https/wss──▶ Cloudflare ──tunnel──▶ shared cloudflared ──http──▶ 10.1.1.160:3000 (app) ──▶ db
```

The stack has three services:

| Service | What it does |
|---|---|
| `app` | Built from the `Dockerfile` (Node 26, pnpm via corepack; the base image, corepack and pnpm are pinned, see Pinned images). On start it applies pending Drizzle migrations (`node src/db/migrate.ts`), then serves pages, `/api/*` and the realtime socket `/ws` from one port (`node server.prod.ts`). Published only on `${HOST_BIND}:${HOST_PORT}` (default `10.1.1.160:3000`). Healthcheck: `GET /api/auth/ok`. |
| `db` | `postgres:17-alpine`, pinned by digest, with a named local Docker volume (`pgdata`). Never put it on the NAS CIFS share (ADR 9 addendum). Not published on any host port. Healthcheck: `pg_isready`. |
| `backup` | Built from `backup/` (`postgres:17-alpine`, pinned by digest, plus pinned `rsync` and `supercronic`). Once at start, and then on `BACKUP_SCHEDULE` (nightly by default), it writes a compressed `pg_dump` to its `backups` volume, rsyncs it to the NAS share and prunes old dumps (section 5, Backups to the NAS). Healthcheck: the last run succeeded, recently. |

All services use `restart: unless-stopped` and json-file log rotation (3 files of 10 MB each).

## 1. Register the Discord OAuth app

1. Open the [Discord Developer Portal](https://discord.com/developers/applications). Click **New Application** and name it (for example "BhayanakCast").
2. Go to **OAuth2**:
   - Copy the **Client ID** into `DISCORD_CLIENT_ID`.
   - Click **Reset Secret** and copy the secret into `DISCORD_CLIENT_SECRET`. Discord shows it only once.
   - Under **Redirects**, add both of these URLs exactly:
     - `https://cast.bhayanak.net/api/auth/callback/discord` (production)
     - `http://localhost:3000/api/auth/callback/discord` (development)

   Better Auth builds the redirect URL as `${BETTER_AUTH_URL}/api/auth/callback/discord`. If you use another host or port, register that URL too.
3. You don't need a bot, and you don't need to pick scopes. The app requests only `identify` (no email).

A single app works for both environments. Development uses the same client id and secret in its local `.env`.

## 2. Add the public hostname on the shared tunnel

In the Cloudflare Zero Trust dashboard, go to **Networks → Tunnels**, open the homelab's existing tunnel, then **Public Hostname → Add a public hostname**:

| Field | Value |
|---|---|
| Subdomain / Domain | `cast` / `bhayanak.net` |
| Path | *(empty)*: one hostname carries the pages **and** `wss://cast.bhayanak.net/ws` |
| Service | `HTTP` → `10.1.1.160:3000` (your `HOST_BIND:HOST_PORT`) |
| Additional settings → HTTP Host Header | **Leave empty. Don't override it.** The socket's same-origin check compares the page's `Origin` with the `Host` it receives (ADR 9 addendum). |

WebSockets are on by default for the zone (**Network → WebSockets**). Leave them on.

### Which IP the tunnel connects from (`TRUSTED_PROXY_IPS`)

Every tunnelled request reaches the app from the cloudflared host, with the visitor's IP in the
`cf-connecting-ip` header. The app also listens on the LAN, where anyone could send that header.
So the app trusts `cf-connecting-ip` only when the direct peer is listed in `TRUSTED_PROXY_IPS`.
From any other peer it uses the socket address. This applies both to the per-IP limit on signed-out
sockets (ADR 20) and to Better Auth's rate limiter: `server.prod.ts` rewrites the header to the
resolved IP before Better Auth reads it.

Set `TRUSTED_PROXY_IPS` to the address the app sees cloudflared connecting from:

- **cloudflared on another LXC or host:** that machine's LAN IP, for example `10.1.1.150`.
- **cloudflared in a container on the dockhand LXC:** the container's Docker network address, which
  is not the LAN IP. A range such as `172.16.0.0/12` covers Docker's default networks.

If the value is wrong, the app logs `Ignoring cf-connecting-ip from <address>, which isn't in
TRUSTED_PROXY_IPS` once per peer. Add that address and redeploy. Until you do, every visitor shares
one rate-limit bucket.

## 3. Collect the environment variables

Dockhand stack variables (or a local `.env` for `docker compose`) feed compose interpolation.
`docker-compose.yml` passes each app variable through explicitly. An unset variable reaches the app
as an empty string, and the app treats that as unset. See `.env.example` for a template.

| Variable | Required | Where to get it |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | Generate one: `openssl rand -hex 24`. Keep it URL-safe, because it's embedded in the app's `DATABASE_URL`. It's applied only when the volume is first initialised; changing it later means running `ALTER USER` inside Postgres too. |
| `POSTGRES_USER`, `POSTGRES_DB` | no | Default `bhayanakcast`. |
| `BETTER_AUTH_SECRET` | yes | Generate one: `openssl rand -base64 32` (at least 32 chars). It signs sessions: rotating it signs everyone out. |
| `BETTER_AUTH_URL` | no | Defaults to `https://cast.bhayanak.net` in compose. It must be the public origin, because it builds the Discord redirect URL. |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | yes | Discord Developer Portal → your app → OAuth2 (step 1). |
| `ADMIN_DISCORD_IDS` | no | Comma-separated Discord user IDs granted the admin role at sign-in (ADR 6). In Discord, enable **Settings → Advanced → Developer Mode**, right-click a user and choose **Copy User ID**. |
| `TRUSTED_PROXY_IPS` | yes | Comma-separated IPs or CIDR ranges of the cloudflared host (step 2). |
| `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN` | no | Cloudflare dashboard → **Realtime → TURN Server → Create**. Copy the **Turn Token ID** and **API Token**. These are server-only and used to mint short-lived TURN credentials (ADR 3). Without them only STUN is available, so peers behind strict NAT or CGNAT may fail to connect. |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ANALYTICS_API_TOKEN` | no | For the admin dashboard's account-wide TURN usage panel (ADR 3 addendum). Account ID: Cloudflare dashboard → your account → **Copy account ID**. Token: **My Profile → API Tokens → Create Token**, custom, with only **Account → Account Analytics → Read** (not the TURN API token). Without them the panel says "not configured". |
| `HOST_BIND` | no | Host address the app is published on. Default `10.1.1.160` (the dockhand LXC's LAN IP). |
| `HOST_PORT` | no | Host port. Default `3000`. The tunnel's service URL must match it. |
| `REALTIME_ANONYMOUS_SOCKETS_PER_IP` | no | Open signed-out (lobby) sockets per client IP. Default `20` (ADR 20). |
| `PUBLIC_READ_LIMIT_SCALE` | no | Multiplies the per-IP budgets of public reads (profile 60, search 30, home 120 a minute). Default `1`; only e2e raises it (ADR 20 addendum). |
| `REALTIME_EMPTY_ROOM_TIMEOUT_MS` | no | How long an empty room waits before it ends. Default `300000` (5 minutes, ADR 14). Leave it unset in production. |
| `BACKUP_NAS_SHARE` | no | The NAS CIFS directory where dumps go, as `//host/share/path`. Default `//10.1.1.195/weyland/Services/backups/bhayanakcast`. It must exist and hold the `.bhayanakcast-backups` marker file. See section 5 (Backups to the NAS). |
| `BACKUP_NAS_USERNAME`, `BACKUP_NAS_PASSWORD` | yes, for backups | The NAS account that can write to `BACKUP_NAS_SHARE`. The password can't contain `,` or `$` (it goes into the mount options and through compose interpolation). Without them `backup` can't start; the app is unaffected. |
| `BACKUP_SCHEDULE` | no | Cron expression (5 fields) for the backup. Default `0 3 * * *`, nightly at 03:00. |
| `BACKUP_TZ` | no | Time zone for `BACKUP_SCHEDULE` and the dump's date, for example `Asia/Kolkata`. Default `UTC`. |
| `BACKUP_RETENTION_DAYS` | no | How many days of dumps to keep, today included, both locally and on the NAS. Older ones are deleted. Default `14`. A whole number of days, 1 to 9999; leading zeros are fine (`014` is 14). |
| `BACKUP_MAX_AGE_HOURS` | no | How old the last successful backup may be before `backup` turns unhealthy. Default `26`, for the nightly schedule. If `BACKUP_SCHEDULE` runs less often than daily, set it above the longest gap between runs. |

Compose sets `NODE_ENV=production`, `PORT=3000`, `HOST=0.0.0.0` and `DATABASE_URL` itself. Don't
set `E2E_AUTH`: compose doesn't pass it through, and the app refuses to start if it's set.

## 4. Create the Dockhand stack

1. In Dockhand, open the dockhand LXC's environment → **Stacks → Create stack → Git repository**.
2. Enter the repository `https://github.com/theHimanshuShekhar/BhayanakCast`, branch `main`, and compose file `docker-compose.yml`.
3. Add the variables from step 3 in the stack's environment variables, either one by one or by loading a filled-in `.env`.
4. Deploy. Dockhand builds the image on the LXC, starts `db`, waits for it to be healthy, then starts `app` and `backup`. The app applies migrations and serves. Set up the NAS share (section 5, Backups to the NAS) before the first deploy, or `backup` starts unhealthy.
5. Optional: to redeploy automatically on every push, add the stack's webhook URL (with its secret) to the GitHub repo's webhooks. Otherwise, redeploy from Dockhand after merging to `main`.

Known Dockhand quirks reported upstream, worth checking after the first deploy:

- Stack variables marked as secrets have been injected literally as `***` in some versions.
- Required-variable syntax (`${VAR:?}`) has blocked stop and redeploy. This compose file doesn't use it; the app validates its env itself.
- Variables that share a name with Dockhand's own container env have picked up Dockhand's values.

Check what the container actually got with `docker inspect <app container> --format '{{json .Config.Env}}'`. Treat the output as secret.

## 5. Backups to the NAS

The `backup` service writes `bhayanakcast-YYYY-MM-DD.sql.gz` (a plain-SQL `pg_dump`, gzipped)
to its local `backups` volume. It then rsyncs the dumps to the NAS (`BACKUP_NAS_SHARE`) and
keeps the last `BACKUP_RETENTION_DAYS` days of dumps (default 14: today and the 13 days before) in
both places, deleting older ones. A second run on the same day replaces that day's dump.
Only these dumps are copied, never the Postgres data directory (ADR 9 addendum). Other files in the
NAS directory are left alone.

Docker mounts the share itself, as the stack's `nas` volume (a `cifs` volume of the `local`
driver), whenever `backup` starts. Nothing is mounted on the host, so it survives reboots. If the
NAS is unreachable or the credentials are wrong, `backup` fails to start (its error names the
mount) instead of writing to local disk. The app doesn't depend on it (see "When the NAS is
unreachable" below). The volume is mounted root-only (`uid=0,gid=0,file_mode=0600,dir_mode=0700`), because the dumps hold user data
and session tokens.

1. On the NAS, create the backup directory, for example `Services/backups/bhayanakcast` on the
   `weyland` share. A CIFS mount of a directory that doesn't exist fails. On the NAS, limit the
   share to the account you use below.
2. Create the marker file in it, `.bhayanakcast-backups` (empty). The backup refuses to rsync
   anywhere without it, so a share that points at the wrong directory is never written to.
3. Set `BACKUP_NAS_USERNAME` and `BACKUP_NAS_PASSWORD` in the stack variables, and
   `BACKUP_NAS_SHARE` if the directory isn't the default.

Docker fixes a volume's options when it first creates it. After changing any `BACKUP_NAS_*`
variable, stop `backup`, remove the volume (`docker volume rm bhayanakcast_nas`; this unmounts it
and leaves the files on the NAS alone), then redeploy.

The backup runs once when the container starts, so a broken setup shows up at deploy time. After
that it runs on `BACKUP_SCHEDULE`. Every run is logged to the container log, ending in
`backup: done` or `backup: FAILED (exit N)`. The container is **healthy** only while its last run
succeeded and finished less than `BACKUP_MAX_AGE_HOURS` ago. A failed run makes it **unhealthy**
until the next run succeeds, and so does a last success that is too old (a schedule that stopped
firing). The status is the file `/tmp/backup-status` (`ok <epoch> <time>` or
`failed <time> exit N`); `docker exec <backup container> healthcheck.sh` shows why a check fails.
To run a backup now: `docker exec <backup container> backup.sh`.

A hung run can't block the ones after it: `pg_dump` and `rsync` each get 30 minutes
(`BACKUP_DUMP_TIMEOUT` and `BACKUP_RSYNC_TIMEOUT`, in seconds, set in the container's environment;
not stack variables), `pg_dump` gives up connecting after 30 seconds, and `rsync` stops after 5
minutes without data. A timeout fails the run (exit 143, or 137 if it had to be killed) and
releases the lock. Failed or interrupted runs leave no `*.partial` dump in `/backups` and no
`.bhayanakcast-*.sql.gz.XXXXXX` rsync temp file on the NAS; the next run clears any that remain.

### When the NAS is unreachable

Checked with the compose file here and a share that doesn't answer (`BACKUP_NAS_SHARE` pointing at
an address with no server):

- `docker compose up -d` (a normal stack deploy): `db` and `app` start and run. Only `backup`
  fails: Docker can't mount `nas`, so `backup` stays in the `created` state and the command exits
  with an error (`error while mounting volume ... operation now in progress`, after about 15
  seconds). A deploy tool that treats that exit code as a failed deploy shows red even though the
  app is up.
- `docker compose up -d app db` brings up just those two: no `nas` volume is created or mounted,
  and the command succeeds. This is the way to deploy the app alone while the NAS is down. Dockhand
  deploys the whole stack, and this was not tried against it: if it reports the deploy as failed
  because of `backup`, check that `app` is running.
- Once the NAS is back, redeploy (or `docker compose up -d backup`). The container isn't retried
  by itself, because it never started; its healthcheck can't report anything either, so watch for
  `backup` being `created` rather than `unhealthy`.
- If the share is up but the mount is stale or the directory was replaced, the marker check in
  `backup.sh` fails the run instead (`/nas/.bhayanakcast-backups is missing`) and the local dump
  stays in `/backups`.

### Restore

Restore into a **fresh** database, never over the live one. Pick a dump
(`docker exec <backup container> ls /nas`, or `/backups` for the local copies), then, as root on
the dockhand LXC, run this one command:

```sh
docker exec <db container> createdb -U bhayanakcast bhayanakcast_restore && docker exec <backup container> cat /nas/bhayanakcast-YYYY-MM-DD.sql.gz | gunzip | docker exec -i <db container> psql -q -o /dev/null -v ON_ERROR_STOP=1 --single-transaction -U bhayanakcast -d bhayanakcast_restore
```

It fails if `bhayanakcast_restore` already exists; drop it first (`dropdb`) to retry. The restore
either loads completely or not at all. To check it, compare row counts with the live
database (run this against both `-d bhayanakcast` and `-d bhayanakcast_restore`):

```sh
docker exec -i <db container> psql -At -U bhayanakcast -d bhayanakcast <<'SQL'
SELECT table_schema || '.' || table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::int
FROM information_schema.tables WHERE table_schema IN ('public', 'drizzle') AND table_type = 'BASE TABLE' ORDER BY 1;
SQL
```

To make the restored copy live, stop `app`, then drop the live database and rename the restored one:
`ALTER DATABASE bhayanakcast_restore RENAME TO bhayanakcast` (connect to the `postgres` database to
do this). Then start `app` again.

## Production guards

- `NODE_ENV=production` is set by both the image and compose. If it's ever missing the app still validates as production (only an explicit `development` or `test` relaxes the checks), so it fails to start rather than booting with development defaults.
- The app validates its environment at startup. If anything is missing or invalid, it exits and lists every problem (for example `BETTER_AUTH_SECRET: … at least 32 characters`). In the logs, a restart loop with that message means a variable needs fixing.
- `E2E_AUTH` (the test-only sign-in) is refused in production and isn't passed through by compose.
- `TRUSTED_PROXY_IPS` is required in production, so a spoofed `cf-connecting-ip` from the LAN is ignored.
- Postgres is reachable only on the stack's internal network. The app is published only on the LAN address.

## First-deploy checklist

- [ ] The Discord app has both redirect URIs (step 1).
- [ ] The tunnel's public hostname `cast.bhayanak.net` → `HTTP 10.1.1.160:3000`, with no Host header override (step 2).
- [ ] All required variables are set in Dockhand: `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `TRUSTED_PROXY_IPS`. `ADMIN_DISCORD_IDS` contains your own ID.
- [ ] The stack deploys, and both containers show **healthy**. The app log shows `Migrations applied`.
- [ ] From the LAN, `curl http://10.1.1.160:3000/api/auth/ok` returns `{"ok":true}`.
- [ ] `https://cast.bhayanak.net/api/auth/ok` returns `{"ok":true}`, and `https://cast.bhayanak.net` loads the home page.
- [ ] "Sign in with Discord" completes and returns to home. Your account has admin (`/admin` opens).
- [ ] The realtime socket connects through the tunnel: the lobby's online count updates, and a room opens.
- [ ] The app log has no `Ignoring cf-connecting-ip from …` warning. If it does, fix `TRUSTED_PROXY_IPS` (step 2).
- [ ] A two-person room works across two different networks (one on mobile data, if possible).
- [ ] If you set the TURN usage variables: the dashboard's TURN usage panel was built from Cloudflare's docs and never run against the real API, so check the query once by hand. Run `curl -s https://api.cloudflare.com/client/v4/graphql -H "Authorization: Bearer $CLOUDFLARE_ANALYTICS_API_TOKEN" -H "Content-Type: application/json" --data '{"query":"query { viewer { accounts(filter: {accountTag: \"<account id>\"}) { callsTurnUsageAdaptiveGroups(limit: 10000, filter: {date_geq: \"<YYYY-MM-01>\", date_leq: \"<today>\"}) { dimensions { datetimeHour } sum { egressBytes } } } } }"}'` (query text: `TURN_EGRESS_QUERY` in `src/server/turn-usage.ts`). It should return `data` with no `errors`. Then open `/admin`: the panel shows a number, not "usage unavailable" (the app log says `[turn-usage] Cloudflare analytics failed` with the reason).
- [ ] The `backup` container is **healthy**, and today's `bhayanakcast-YYYY-MM-DD.sql.gz` is on the NAS share: `docker exec <backup container> ls -l /nas` (section 5, Backups to the NAS).
- [ ] The latest dump restores into a scratch database, and its table counts match the live database (section 5, Restore).

## Operating

- **Updating:** merge to `main`, then redeploy (or let the webhook do it). Pending migrations run on
  start. Migrations only go forward, so rolling back to an older commit doesn't undo a schema change.
- **Pinned images:** see below.
- **Logs:** Dockhand's container logs, or `docker logs <container>`. They're rotated at 3 × 10 MB.
- **Restarts** drop live room state. Clients reconnect on their own (ADR 9).
- **TURN and NAT (ADR 3):** each signed-in user gets TURN credentials that last 4 hours. They're
  cached per user and minted again 30 minutes before they expire. If minting fails, the app logs
  `[ice] minting TURN credentials failed; STUN only` and pages get STUN only until the next try.
  A peer pair that relays through TURN, or fails even after an ICE restart, is logged as
  `[ice] {"outcome":"relayed"|"failed",…}`. The line has candidate types and transports only, with
  no addresses or user IDs. `docker logs <app container> 2>&1 | grep '\[ice\]'` shows how often
  double NAT bites.
- **Data** lives in the `pgdata` volume. Don't delete the stack's volumes when removing or re-creating it.
  Nightly dumps are on the NAS share (section 5, Backups to the NAS).

## Pinned images

Two builds of the same commit produce the same images. `Dockerfile` pins `node:26-alpine` by digest
(the tag stays in the line for readers) and corepack by exact version (`npm install -g corepack@x.y.z`);
pnpm is the exact version in `package.json` `packageManager`. `backup/Dockerfile` and the `db` service
in `docker-compose.yml` pin `postgres:17-alpine` by digest, and the backup image pins `rsync` and
`supercronic` to the versions that digest's Alpine ships.

To bump:

- **Digests:** `.github/dependabot.yml` opens weekly PRs for the Dockerfiles and the compose file. By hand,
  `docker buildx imagetools inspect node:26-alpine` (or `postgres:17-alpine`) prints the index digest;
  put it after the tag as `@sha256:...`. The `node` digest appears twice in `Dockerfile` (`base` and
  `runtime`); the `postgres` digest appears in `backup/Dockerfile` and `docker-compose.yml`. Keep each pair identical.
- **Major versions:** Dependabot ignores them. The `postgres` major must stay 17 on both `db` and
  `backup` so `pg_dump` matches the server; a major upgrade needs a dump and restore, not a tag change.
  The `node` major follows `.nvmrc` and `package.json` `engines`.
- **apk pins:** after a new `postgres` digest, run `docker run --rm <postgres image with the new digest> sh -c 'apk update && apk policy rsync supercronic'`
  and update the versions in `backup/Dockerfile`. Alpine's repository keeps only the current
  revision, so a stale pin fails the build with "no such package" rather than building silently.
- **corepack:** `npm view corepack version`, then edit `Dockerfile` (Dependabot can't see it).
- **pnpm:** bump `packageManager` in `package.json` (the Dockerfile follows it).

Then build both images and run `pnpm test:backup`.
