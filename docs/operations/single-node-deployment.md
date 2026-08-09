# Single-node deployment and recovery

This runbook operates the accepted one-node topology. It does not add a second application origin, horizontal application replicas, TURN, or public access to backing services.

## Topology and failure boundaries

- `app` joins the host-facing `edge` network and the internal `data` network. The `APP_PORT` host port publishes to the app's container port 3000. PostgreSQL and Valkey publish no host ports.
- `cloudflared`, when operated as a separate tunnel, should join `edge` and send the public hostname to `http://app:3000`; the same Node listener owns HTTP and `/socket.io/` upgrades.
- PostHog runs separately from this stack. The application sends analytics to the configured `POSTHOG_HOST` URL and does not join a PostHog Docker network.
- PostHog is non-critical: an analytics outage must not change application readiness or block product requests. Valkey is disposable, but mutations whose abuse limits require it fail closed; durable reads and PostgreSQL data remain available. PostgreSQL unavailability makes application readiness fail.

The production Compose file publishes only the application host port. `compose.dev.yml` is only for local dependency development and binds PostgreSQL and Valkey to loopback.

## Host prerequisites

1. A single Linux host with Docker Engine and Docker Compose v2, systemd, OpenSSL, util-linux (`mountpoint`), and enough resources for the application plus the official PostHog hobby requirements.
2. A NAS filesystem mounted at `/mnt/nas`. Configure and prove the host's NAS mount before enabling backups; the backup command refuses to write to an unmounted local directory.
3. A Cloudflare zone, one remotely managed Tunnel, one public application hostname, and its token. The host firewall/router must have no inbound forwarding for 3000, 5432, 6379, 8000, 8123, or 9000.
4. A separately checked-out official PostHog repository at an operator-recorded immutable commit and reviewed release image tags. Upstream PostHog is external software and is intentionally not copied into this repository.
5. DNS, Cloudflare, public-network, and NAS access. Local checks cannot substitute evidence from those systems.

## Initial configuration

Copy `.env.example` to `.env`, keep it mode `0600`, and replace every required placeholder. For production:

- set `BETTER_AUTH_URL` and `CLOUDFLARED_PUBLIC_URL` to the identical HTTPS application origin;
- set `TRUSTED_PROXY_IPS=172.30.0.3`, the fixed `cloudflared` address on `edge`;
- set a reviewed immutable `CLOUDFLARED_IMAGE`, the Tunnel token, Discord credentials, a random Better Auth secret, and the PostgreSQL password;
- to enable PostHog, set `POSTHOG_HOST`, `POSTHOG_PROJECT_API_KEY`, `POSTHOG_PROJECT_ID`, and `POSTHOG_PERSONAL_API_KEY`; the host must be reachable from the application container, and the personal key needs person read/delete access so Account approval can remove the Discord-ID person association with `delete_events=false` before local anonymization;
- leave all four PostHog values empty to disable analytics;
- verify `172.30.0.0/24` does not overlap a host/LAN route before starting. If it overlaps, change both the `edge` subnet and fixed `cloudflared` address, then update `TRUSTED_PROXY_IPS`.

Run PostHog separately and keep its operator UI and ingestion endpoint private. Confirm
`POSTHOG_HOST` is reachable from the application container, then configure PostHog event
retention to 365 days.

In Cloudflare Zero Trust, configure exactly one public hostname. Its service is `http://app:3000`; the final ingress rule must return `http_status:404`. Do not create public routes for PostHog or any data service. WebSockets must remain enabled. Store the Tunnel token only in `.env` or the host's secret manager.

Start the application topology:

```sh
cd /opt/bhayanakcast
docker compose pull
docker compose build app
docker compose up -d
```

`app` waits for healthy PostgreSQL and Valkey, migrates before listening, and becomes healthy only when `/health/ready` can query both. `cloudflared` starts only after `app` is healthy. Inspect status with `docker compose ps`; inspect the Tunnel's active Cloudflare connection from inside the application container with:

```sh
docker compose exec -e TUNNEL_READY_URL=http://cloudflared:2000/ready app \
  node scripts/production-smoke.mjs http://127.0.0.1:3000
```

## Release smoke and exposure evidence

Run the following from the host after every deployment:

```sh
node scripts/check-compose-exposure.mjs
docker compose exec app node scripts/production-smoke.mjs http://127.0.0.1:3000
```

From a machine outside the home LAN, run:

```sh
node scripts/production-smoke.mjs https://PUBLIC_APPLICATION_HOSTNAME
node scripts/check-public-exposure.mjs https://PUBLIC_APPLICATION_HOSTNAME
```

Record the JSON output, Compose image digests, PostHog commit/release tags, Tunnel identifier, and UTC time in the release evidence store. Also scan the residential WAN address from that external machine or verify the router/firewall rule set: the Cloudflare hostname port probe cannot prove that an unrelated origin IP has no forwarding rule.

The smoke command proves application HTTP, same-origin routing, Socket.IO polling, and an actual WebSocket upgrade. The Compose check proves that only the application publishes a host port and that PostgreSQL and Valkey remain on the internal data network. Only the off-LAN run and Cloudflare dashboard/firewall inspection prove the real public boundary.

## Scheduled interruption and dependency recovery

For planned host work, warn active users when practical, then stop ingress before the listener and dependencies:

```sh
docker compose stop -t 30 cloudflared app
docker compose stop -t 30 valkey postgres
```

A process or host restart ends live Socket.IO and direct WebRTC state. Durable room/database state returns after startup; active media does not resume automatically. Valkey rate-limit windows may reset. Start with `docker compose up -d`, wait for healthy services, and run both host smoke commands before restoring normal operation.

Failure drills:

- Stop PostHog `web`, perform a normal HTTP and room mutation, and confirm the application stays ready. Restore PostHog and confirm capture resumes; do not replay or fabricate dropped analytics.
- Stop Valkey, confirm `/health/ready` becomes unavailable and a rate-limited mutation fails closed rather than bypassing policy. Start Valkey, wait for health, and repeat the mutation.
- Stop PostgreSQL, confirm application readiness fails. Start PostgreSQL and confirm migrations/readiness recover before the tunnel is treated as serviceable.
- Restart `cloudflared`, verify `/ready`, then repeat the off-LAN HTTP and WebSocket smoke.

Keep the captured UTC commands/results as release evidence. Do not perform a dependency drill during active rooms without an announced interruption.

## Encrypted daily PostgreSQL backups

Generate a dedicated high-entropy passphrase file outside the repository:

```sh
sudo install -d -m 0750 -o root -g bhayanakcast /etc/bhayanakcast
openssl rand -base64 48 | sudo tee /etc/bhayanakcast/backup.key >/dev/null
sudo chown root:bhayanakcast /etc/bhayanakcast/backup.key
sudo chmod 0640 /etc/bhayanakcast/backup.key
```

Create `/etc/bhayanakcast/backup.env` (mode `0640`, group `bhayanakcast`) containing `BACKUP_NAS_MOUNT`, `BACKUP_DIRECTORY`, `BACKUP_KEY_FILE`, `RECOVERY_EVIDENCE_DIRECTORY`, `POSTGRES_DB`, and `POSTGRES_USER`. Keep the encryption key in the host secret store and a separate operator-controlled recovery copy; never place it on the NAS beside the backups.

Schedule `scripts/backup-postgres.sh` with the host scheduler as the `bhayanakcast` user.
Run it daily at 03:15 with persistent missed-run handling, a randomized delay of up to 15
minutes, `/opt/bhayanakcast` as the working directory, and
`/etc/bhayanakcast/backup.env` loaded into the environment.

The script creates a custom-format dump, encrypts it with AES-256-CBC/PBKDF2 before its atomic final name appears, writes an encrypted-file checksum, and deletes backup/checksum files older than 30 days only after a new non-empty backup succeeds. Alert on a failed run and on the absence of a backup newer than 26 hours.

## Daily data retention

Schedule `docker compose exec -T app node scripts/run-retention.mjs` with the host scheduler
as the `bhayanakcast` user. Run it daily at 04:00 with persistent missed-run handling, a
randomized delay of up to 15 minutes, and `/opt/bhayanakcast` as the working directory.
The command runs inside the application container, so it uses the same private PostgreSQL
connection and schema as the application. Alert on a failed run or the absence of a
`retention_run_completed` journal entry for more than 26 hours.


## Monthly clean restore drill

Run this at least monthly while PostgreSQL and the NAS are healthy:

```sh
set -a
. /etc/bhayanakcast/backup.env
set +a
cd /opt/bhayanakcast
scripts/recovery-drill.sh
```

The drill inserts a unique timestamped operational marker, creates a fresh encrypted backup, verifies its checksum, creates a clean database with a guarded `_restore_` name, restores through `pg_restore --exit-on-error`, and proves the marker exists in the restored database. It then removes the source marker, drops the drill database, and writes JSON evidence containing the recovery data point and elapsed seconds. A failed restore database is dropped automatically. For manual investigation, use `scripts/restore-postgres.sh BACKUP_FILE bhayanakcast_restore_CASE`, inspect it, then drop it explicitly.

Review each evidence JSON, the matching systemd journal, and the backup checksum. This proves the exercised backup only; it does not prove NAS durability, key escrow, Cloudflare routing, or recovery after a site-wide loss.

## External prerequisites still requiring real infrastructure

Repository checks cannot supply or fake:

- a mounted, writable, failure-alerted same-site NAS and retained 30-day files;
- encryption-key escrow that survives loss of the Compose host;
- a real monthly restore evidence file produced against running PostgreSQL and that NAS;
- a Cloudflare account, Tunnel token, public DNS/HTTPS hostname, WebSocket passage, and dashboard ingress/catch-all configuration;
- off-LAN proof that the public hostname and residential WAN address expose no backing-service ports;
- an immutable, operator-reviewed PostHog checkout/release, its one-year retention setting, resource sizing, and health on the deployment host.
