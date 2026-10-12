# Which self-hosted log stack fits the homelab for 90 days of searchable logs?

Research for #108 (map #107, "Record what we need to diagnose future bugs"). Written 2026-10-12 against the current published docs of each project and a set of throwaway local measurements. Claims are cited inline. **UNVERIFIED** marks a claim no primary source backs and that I did not test. *Measured* marks a number I produced myself (see "How I measured"); it is evidence for this setup, not a vendor claim. *Inference* marks a conclusion drawn from cited text but not stated in it.

Source shorthand:

- **VL** = https://docs.victoriametrics.com/victorialogs/
- **LOKI** = https://grafana.com/docs/loki/latest/
- **ALLOY** = https://grafana.com/docs/alloy/latest/
- **GRAFANA** = https://grafana.com/docs/grafana/latest/
- **DOZZLE** = https://dozzle.dev/
- **VECTOR** = https://vector.dev/docs/reference/configuration/
- **DOCKER** = https://docs.docker.com/engine/logging/
- **CF** = https://developers.cloudflare.com/cloudflare-one/

## Answer in brief

**Recommendation: VictoriaLogs (single container, built-in UI) fed by Vector's `docker_logs` source, with the app writing one JSON object per line to stdout.**

- **Why it fits.** One small binary stores everything. Retention is one flag (`-retentionPeriod=90d`). Every field is indexed by default, so `roomId`, `userId` and `level` need no label design. The built-in UI (`/select/vmui/`) should be enough for "room X around 22:00", so Grafana is not needed. I tested the queries through the HTTP API, not in a browser, so the UI itself is **UNVERIFIED**. Basic auth is one pair of flags.
- **Footprint.** The stack is two extra containers (VictoriaLogs and Vector), against three for Loki (Loki, Alloy, Grafana). *Measured*, VictoriaLogs ran 500,000 JSON lines in about 114 MiB of RAM when fed at a steady pace under a 256 MiB limit, and Vector sat at about 18-20 MiB.
- **Retention in practice.** 500,000 synthetic lines (99.7 MB raw) took 4.0 MB on disk. That ratio is optimistic because my data is repetitive, but even a 10x worse ratio is small.
- **The trade-offs you accept** (details below):
  1. Vector reads the Docker socket, which is root-equivalent on the host.
  2. *Measured:* lines written while Vector is down, or before it first attaches, are not backfilled. A Vector restart costs the seconds it was down.
  3. Its Docker ingestion path is a third-party collector (Vector), not a Docker driver and not a VictoriaMetrics-built agent. LogsQL is also a different language from Loki's LogQL, so Loki/Grafana experience does not carry over (my judgment; unsourced).
  4. A bulk burst can OOM VictoriaLogs under a tight memory limit (*measured*, below). Do not put a hard memory limit under 512 MiB on it without testing, and do not backfill bulk history into a small LXC.
  5. A POST with the wrong `Content-Type` is accepted with HTTP 200 and silently dropped (*measured*). This matters only for hand-rolled ingestion; Vector's sink works.
- **Rejected.** Loki is a credible runner-up but needs more moving parts for this scale (Section "Grafana Loki"). Dozzle alone cannot satisfy 90 days or surviving a redeploy (Section "Dozzle"). The journald route is the weakest on field search (Section "journald").

## What the stack looks like today

From `docker-compose.yml`, `docs/deploy.md` and ADR 9:

- One Compose stack, deployed by Dockhand from git: `app`, `db`, `backup`. All three use the `json-file` driver with `max-size: 10m`, `max-file: 3`. `docker logs` is the only way to read them, and a recreate deletes the files.
- The app is published on the LAN IP only (`${HOST_BIND}:${HOST_PORT}`, default `10.1.1.160:3000`). The homelab's shared cloudflared publishes `cast.bhayanak.net`. This stack has no tunnel of its own. A new service published on the LAN IP is therefore **not public** unless someone adds a public hostname for it on the tunnel.
- Persistent data lives in local Docker volumes. Postgres is never on the NAS CIFS share (ADR 9 addendum). The `backup` service dumps Postgres only.
- Images are pinned by digest, and Dependabot opens weekly PRs for Dockerfiles and the compose file (`docs/deploy.md`, "Pinned images"). A build context in the repo is already the pattern for custom config (`backup/`).
- The sizing brief is a 6-core, 8 GB dev box, with the LXC assumed similar or smaller. The measuring host actually reported 8 CPUs and 16 GiB, so absolute RAM below is *from a larger box*. Where a container was capped, the cap is stated.
- Traffic is small: one app, a few rooms a week, at most about 10 people. The synthetic data set used for measurement (500,000 lines over 90 days) is deliberately heavier than that.

## Comparison at a glance

| | VictoriaLogs + Vector | Loki + Alloy + Grafana | Dozzle alone | journald + `journalctl` |
|---|---|---|---|---|
| Extra containers | 2 | 3 | 1 | 0 (host journald) |
| Idle RAM, *measured* | VL 17 MiB, Vector 18-20 MiB | Loki 68, Alloy 37 (empty config), Grafana 46 MiB | 55 MiB | n/a |
| Stores logs itself | yes | yes | no ("no database") | yes (host) |
| 90-day retention | `-retentionPeriod=90d` | compactor + `retention_period: 2160h` + 24h index schema | no | journald settings, **UNVERIFIED** |
| Survives redeploy | yes | yes | no | yes |
| Field search | all fields indexed, LogsQL | labels indexed; others parsed at query time | JSON fields, in browser only | journal fields only; JSON message not parsed |
| Built-in viewer | yes (vmui) | no (Grafana) | yes | no |
| Built-in auth | basic auth flags | none in Loki; login in Grafana | simple / OIDC / forward proxy | n/a |

## VictoriaLogs

### Footprint

- Docs: a single zero-config executable that "adapts to the available CPU and RAM resources". The project claims "up to 30x less RAM and up to 15x less disk space" than Elasticsearch and Loki (VL home page), which is a vendor claim. The FAQ gives no fixed RAM figure and says light queries over recent logs need very little compute, and that a few CPU cores and a few GiB of RAM are fine for heavier ones (VL FAQ).
- *Measured* (VictoriaLogs v1.53.0, image 44.6 MB):
  - Fresh container with a trickle of logs: 16.8 MiB.
  - After a 500,000-line burst (99.7 MB raw) with no memory limit: about 533 MiB, settled. (The docs say it adapts to available RAM, so a larger host lets it use more.)
  - Under `--memory=512m`, the same burst: no OOM kill, 431 MiB used, all 100 batches accepted.
  - Under `--memory=256m`, the same burst, whether sent as one POST or as 100 batches of 5,000 lines in a tight loop: **OOM-killed** (in the batched run the container was dead at the end and 26 of the 100 requests had failed). Note that my data spans 90 daily partitions, so this is a backfill pattern, not live traffic.
  - Under `--memory=256m`, the same 100 batches **paced at one per 0.5 s**: no OOM kill, 114 MiB used, all 500,000 rows ingested.
  - *Inference:* steady, small traffic like this app's is fine in a small container; a bulk backfill is not. There is no documented memory-limiting flag (FAQ: "not covered"), so bound the container with Docker's limit only after testing at your real rate.
- Disk: 4.0 MB for the 500,000 lines (`vl_data_size_bytes{type="storage"}`). Synthetic and repetitive, so optimistic. The docs say logs typically compress "10x or more", repetitive ones up to 100x, random ones poorly (VL FAQ).
- Capacity planning in the docs asks for at least 20% free space at `-storageDataPath` (VL home page).

### Ingestion from a Compose service

VictoriaLogs has no Docker logging driver and no Docker-socket collector of its own. Its docs list these ways in (VL data-ingestion): Fluent Bit, Vector, Promtail/Alloy through the Loki endpoint, OpenTelemetry, Filebeat, Fluentd, Logstash, syslog, journald, and plain HTTP (`/insert/jsonline`, `/insert/loki/api/v1/push`, `/insert/elasticsearch/_bulk`). `vlagent` has no Docker socket integration; its docs describe only Kubernetes and file collection (VL vlagent). The Docker page of the data-ingestion docs does not mention Docker logging drivers at all, and the syslog page does not mention Docker's syslog driver, so those routes are **UNVERIFIED** against VictoriaLogs.

The route I tested: **Vector `docker_logs` source, `remap` transform, `http` sink to `/insert/jsonline`**, which is the sink shape the VictoriaLogs docs give (VL data-ingestion/vector: `type: http`, `codec: json`, `method: newline_delimited`, `uri: .../insert/jsonline?_stream_fields=...&_msg_field=...&_time_field=...`).

Vector's `docker_logs` source reads through the Docker API socket, supports `include_containers`, and re-joins Docker's split 16 KB messages by default (VECTOR sources/docker_logs: `auto_partial_merge: true`). Its `message` field is the raw line and the docs do not say it parses JSON, so a `remap` with `parse_json` is needed (the VictoriaLogs Vector page has no guidance on this either).

Working config, *tested* end to end (Vector 0.59.0, VictoriaLogs v1.53.0). The test used the emitter container `probe-emit` and the sink host `probe-vl2`; here they are replaced with names for this stack, so the names below are untested:

```yaml
data_dir: /var/lib/vector
sources:
  docker:
    type: docker_logs
    include_containers: ["bhayanakcast-app"]   # prefix match; use the real container name
transforms:
  parse:
    type: remap
    inputs: [docker]
    source: |
      o, err = parse_json(.message)
      if err == null && is_object(o) {
        . = merge(., object!(o))
        if exists(.msg) { .message = .msg; del(.msg) }
      }
sinks:
  vl:
    type: http
    inputs: [parse]
    uri: "http://victorialogs:9428/insert/jsonline?_stream_fields=container_name&_msg_field=message&_time_field=timestamp"
    method: post
    encoding: { codec: json }
    framing: { method: newline_delimited }
    compression: gzip
    healthcheck: { enabled: false }
    buffer: { type: disk, max_size: 268435488 }
```

What the test showed (*measured*):

- Docker's `json-file` lines became searchable fields: `roomId`, `userId`, `level`, `event`, `seq`, and nested `detail.outcome`, with `_stream` = `{container_name="..."}`.
- **Recreating the app container under the same name while Vector keeps running works.** The new container's first line (seq 1) was captured, and the old and new runs show as separate `container_id`s. This is the redeploy case.
- **Lines written while Vector was stopped for about 10 s were lost** (54 consecutive lines, the whole window), and **lines written before Vector first attached were not backfilled.** One line was delivered twice. The `docker_logs` docs say "best effort, no acknowledgements" and are silent on restarts and `since`, so this is observed behaviour, not documented behaviour. *Inference:* a deploy that recreates Vector (an image digest bump, a config change) loses the seconds it is down, and `docker logs` / `json-file` still holds those lines for as long as its 3 x 10 MB allows.
- The disk buffer on the sink is documented to protect against sink trouble, "less performant, but more durable" than memory (VECTOR sinks/http). **I did not test a VictoriaLogs outage.** UNVERIFIED that no lines are lost while VictoriaLogs is down.
- Vector's `docker_logs` source "requires that the running user be part of the `docker` group" (VECTOR). The socket mount is root-equivalent on the host. Dozzle's docs say the same of any `docker.sock` consumer and add that a `:ro` mount "does not limit the API" (DOZZLE guide/authentication). Whether a socket proxy such as `tecnativa/docker-socket-proxy` (named by Dozzle's docs) works with Vector is **UNVERIFIED**.

Ingestion gotcha, *measured*: `/insert/jsonline` answered HTTP 200 to a POST sent with curl's default `Content-Type: application/x-www-form-urlencoded` and **silently stored nothing**. The same line with `application/stream+json`, `application/x-ndjson`, `text/plain` or no `Content-Type` header was stored. Vector's sink worked. The docs' own example uses `application/stream+json` (VL data-ingestion). Watch `vl_rows_ingested_total` and `vl_rows_dropped_total` when wiring anything by hand.

### Retention configuration

- `-retentionPeriod=90d`. The default is `7d`; accepted range `1d` to `100y`; suffixes s, h, d, w, M, y; **a bare number means months** (VL home page). Use the `d` suffix. *Measured:* the flag is accepted as `-retentionPeriod="90d"` and logged at startup.
- Data is stored in per-day partitions under `<-storageDataPath>/partitions/YYYYMMDD` (VL home page). *Inference:* expiry therefore works in whole days; the docs read do not say so directly.
- Optional disk safety nets: `-retention.maxDiskSpaceUsageBytes` or `-retention.maxDiskUsagePercent`; they are mutually exclusive and the server will not start with both set (VL home page). What exactly is dropped first when the cap is hit is **UNVERIFIED**.
- Use an explicit absolute `-storageDataPath=/victoria-logs-data` and mount a named volume there. The docs' quickstart uses a relative path and does not say how it resolves against the mounted path (VL quickstart). I did not check where the image writes by default, so mount the volume only after confirming the path holds data (for example `vl_data_size_bytes` rising and files appearing in the volume).

### Field search: "room X around 22:00", userId, level

LogsQL (VL logsql; all *tested* on 500,000 synthetic lines):

```
roomId:="r042" _time:[2026-09-01T21:55:00+05:30, 2026-09-01T22:05:00+05:30]
userId:="u03" level:="warn" event:="bad_request" _time:90d
roomId:="r042" detail.outcome:="failed" _time:90d
_time:90d roomId:="r042" | stats by (event) count() n
```

- `field:="value"` is an exact match; `field:value` is a word match (VL logsql). Use `:=` for ids.
- The time filter accepts a `+hh:mm` offset inside the timestamp (docs), and *measured*: a row stored at 16:30:01Z matched a 21:55 to 22:05 `+05:30` window and did not match the 22:05 to 22:15 window. The `start` and `end` query arguments take the same offset when URL-encoded (the `+` must be encoded, otherwise it becomes a space and the parse fails; *measured*).
- A JSON object's nested keys are flattened with `.` (`detail.outcome`); numbers, booleans and arrays are stored as strings (VL keyconcepts).
- **Stream fields must stay low-cardinality.** The docs say `ip`, `user_id` and `trace_id` "must never be associated with log streams" and high-cardinality fields work fine as ordinary fields (VL keyconcepts). So `_stream_fields` is `container_name` only. `roomId` and `userId` are plain fields and are indexed anyway ("VictoriaLogs automatically indexes all the fields").
- If a line arrives as a JSON string in `_msg` (no parsing at ingest), `| unpack_json` expands it at query time (VL logsql). The docs say ingesting already-parsed JSON is better.
- Query surfaces: `/select/vmui/` with Group, Table, JSON and Live modes (VL querying); the HTTP API `/select/logsql/query` returns a JSON-lines stream; a Grafana plugin and `vlogscli` also exist. The Grafana data source uses `type: victoriametrics-logs-datasource` (VL integrations/grafana). Whether that plugin needs unsigned-plugin settings is **UNVERIFIED**.

### Auth for a viewer that must not be public

- The app's LAN-only publish pattern already keeps it off the tunnel. Bind the VictoriaLogs port to `${HOST_BIND}` the same way, or not at all and let only Vector reach it on the Compose network.
- `-httpAuth.username` and `-httpAuth.password` give basic auth for the HTTP API (VL home page). *Measured* with those flags on: `/select/vmui/`, `/insert/jsonline` and `/select/logsql/query` returned **401 without credentials and succeeded with them**, `/metrics` returned 401, and **`/health` stayed open (200)**. One flag pair covers inserts too, so Vector's sink needs matching credentials. How to give them to the Vector `http` sink was not read from the Vector docs, so that wiring is **UNVERIFIED**.
- Per-endpoint auth keys exist (`-metricsAuthKey`, `-deleteAuthKey` and others) and mTLS is supported (VL home page). VictoriaLogs "doesn't perform per-tenant authorization"; vmauth is the answer for that and is not needed here.
- If the viewer ever needs to be reachable off the LAN: add a tunnel public hostname **after** creating a Cloudflare Access application for it. Access is deny by default, and "if you do not have an Access application in place, the published application will be available to anyone on the Internet" (CF applications/configure-apps/self-hosted-public-app). Cloudflare's marketing pages and search snippets say Access is free for up to 50 users; I could not read that limit in the developer docs (CF account-limits lists no seat limit), so treat the figure as **UNVERIFIED** against Cloudflare's docs.

### Backup implications

- Nothing changes in the `backup` service. It dumps Postgres only (`docs/deploy.md` section 5), and the logs are not in the dump.
- Keep VictoriaLogs data in a **local named volume** (`vlogs`), mirroring Postgres, not the NAS CIFS share. Whether VictoriaLogs is safe on CIFS is **UNVERIFIED**; ADR 9 rules CIFS out for Postgres because it needs fsync, locking and Unix permissions.
- The documented backup path, if wanted: `POST /internal/partition/snapshot/create?partition_prefix=YYYYMMDD`, `rsync` the snapshot, delete it with `/internal/partition/snapshot/delete?path=...`; snapshots auto-expire after 3 days (`-snapshotsMaxAge`). Restore means detaching the partition (or stopping the instance), copying back, then attaching (VL home page).
- *Inference:* the logs are diagnostic and 90-day; losing them on a disk failure is acceptable, so the simplest choice is no backup of this volume. This is a decision for the operator and should be stated in the build ticket.
- **Deletion and privacy.** Logs will hold real user ids and room ids for 90 days, longer than the 30-day room data (ADR 11) and equal to the quality samples' 90 days (ADR 11 addendum). The map's standing decision allows this, admin-only. Chat content must not be logged (ADR 4). The 30-day room purge will not reach the log store, so a room's ids outlive its recap there.
- Secrets: the viewer password would be a stack variable, visible to anyone with Docker access on the host like the others (`docs/deploy.md`, "Who can see the secrets on the host").

### Maintenance burden

- One image to pin by digest (Dependabot already watches the compose file), one custom Vector config. Putting the Vector config in a small build context in the repo (for example `vector/` with `FROM timberio/vector@sha256:...` and `COPY vector.yaml`) follows the `backup/` pattern and avoids relying on a bind mount of a repo file under Dockhand. Whether Dockhand's git checkout supports relative bind mounts is **UNVERIFIED**.
- Upgrades: safe, including skipping versions and downgrading, "unless release notes say otherwise"; the documented procedure is to send `SIGINT`, wait for exit, then start the new binary (VL home page). Whether VictoriaLogs shuts down cleanly on the SIGTERM that a Compose redeploy sends was not checked, **UNVERIFIED**.
- The Vector image tested was 0.59.0 (`timberio/vector:latest-alpine` on 2026-10-12). Pin by digest.
- Alerts on the stack itself (VictoriaLogs down, Vector down) need a healthcheck. `/health` exists on VictoriaLogs (*measured*, returns 200). A Vector healthcheck is not designed here.

## Grafana Loki

### Footprint

- Loki indexes only labels, not log content, and keeps compressed chunks in object storage or, for dev and PoC use, on the local filesystem (LOKI get-started/overview).
- The sizing page gives nothing for this scale. The smallest tier it documents is under 3 TB/day and sums to roughly 38 CPU cores and 59 GiB of requests (my sum), and it covers microservices mode only (LOKI setup/size). So **there is no vendor number for a single small instance**.
- *Measured* idle only (no data ingested, so these understate loaded use): Loki 3.7.0 with the image's default local config 68 MiB; Alloy with an empty config 37 MiB; Grafana 46 MiB measured 40 s after start, before any login or query. Image sizes: Loki 209 MB, Alloy 946 MB, Grafana 1.94 GB (`latest`) against VictoriaLogs at 44.6 MB. I did not ingest or query on Loki, so there is no loaded comparison.

### Ingestion from a Compose service

- **Alloy** `loki.source.docker` reads from the Docker daemon socket (`host = "unix:///var/run/docker.sock"`), with targets from `discovery.docker`, and keeps a positions file so it resumes after a restart (ALLOY loki.source.docker). This also needs the socket.
- **Promtail is end of life as of 2026-03-02**: "Commercial support has ended. No future support or updates will be provided," and users "must migrate to Alloy or another supported client" (LOKI send-data/promtail). Do not start on Promtail.
- **Loki Docker driver**: a plugin installed once per Docker host (`docker plugin install grafana/loki-docker-driver:3.7.0-amd64 --alias loki --grant-all-permissions`), then `driver: loki` with `loki-url` in the service's `logging:` block (LOKI send-data/docker-driver, /configuration). The docs warn of a "Deadlocked Docker Daemon": the driver holds logs in memory and drops them when Loki is unreachable, `loki-retries: 0` retries forever and "the Docker daemon might wait forever if the container is stuck", with the mitigation `loki-retries=2`, `loki-max-backoff=800ms`, `loki-timeout=1s`, `keep-file=true`, or `mode=non-blocking` at the price of possible loss. The page recommends Alloy to avoid it, and says the driver "does not carry the same support commitment as Grafana Alloy". A compose file cannot install a host plugin, so a git-backed Dockhand stack needs a one-off host step; that is an *inference*, not stated by the docs.

### Retention configuration

```yaml
compactor:
  working_directory: /data/retention
  retention_enabled: true
  delete_request_store: filesystem   # required when retention is on
limits_config:
  retention_period: 2160h            # 90 days
schema_config:
  configs:
    - from: "2026-10-12"
      store: tsdb
      object_store: filesystem
      schema: v13
      index: { period: 24h, prefix: index_ }
```

- Retention is off by default and logs then stay forever; the compactor must have `retention_enabled: true`, and `delete_request_store` is "required when retention is enabled" (LOKI operations/storage/retention). "Retention is only available if the index period is 24h". `retention_period` has no minimum, per-stream rules need at least 24h. The 90-day value `2160h` is my arithmetic; the docs' own example is 672h (28 days).
- `delete_request_store: filesystem` and `object_store: filesystem` are my adaptation of the docs' `gcs` examples to local disk and are **UNVERIFIED** as a combination (I did not run Loki with data).
- With the filesystem chunk store, "Loki does not delete data based on disk usage or free-space conditions", so a full disk is an operational problem (LOKI configure/storage). The same page calls filesystem chunks "susceptible to data loss as it's unreplicated" and "common for single binary deployments", and marks only the cloud object stores as production-safe.
- The official Docker Compose install is described as for "evaluating, testing, or developing Loki"; "for production, Grafana recommends installing with Helm or Tanka" (LOKI setup/install/docker). A homelab on Compose is outside the vendor's production path, though a single binary is a documented deployment mode.

### Field search

- Labels are indexed; the content is not. Dynamic labels should have "single digits, or maybe 10's of values", and an unbounded id like a request id as a label is called "bad!!". The docs say to use a line filter instead (LOKI get-started/labels/bp-labels). So **`roomId` and `userId` must not be labels** (the page does not name them but names order and trace ids as the same case; *inference*).
- Query shape: `{service="app"} |= "r042" | json | roomId="r042" | userId="u03" | level="warn"` (LOKI query/log_queries). Line filters first are faster; `| json` runs at query time and a parse failure adds `__error__` rather than dropping the line.
- Structured metadata is the supported place for high-cardinality fields you do not want in the line, queried without a parser, but it needs schema v13, the `tsdb` index and `allow_structured_metadata: true` (LOKI get-started/labels/structured-metadata). The page does not say how to set it from the Docker driver; with Alloy it is the `stage.structured_metadata` block.
- Time range is chosen in Grafana's time picker (not checked in the docs I read).

### Auth

- "Grafana Loki does not come with any included authentication layer," except native mTLS, and the docs say "You must run an authenticating reverse proxy in front of your services" (LOKI operations/authentication). With `auth_enabled: true` (the default) every request needs an `X-Scope-OrgID` header; with it false there is a single tenant.
- Grafana has its own login, supports GitHub, Google, generic OAuth and others, and "currently do[es] not include built-in support for multi-factor authentication" (GRAFANA configure-authentication). Whether anonymous access is on by default was not stated on the pages I read, so **UNVERIFIED**.
- Cloudflare Access in front of Grafana has the same shape as for VictoriaLogs above.

### Backup implications

Same as VictoriaLogs for the `backup` service: no change. The Loki-side procedure (stopping or snapshotting the filesystem chunks and TSDB index, restore) was **not found in the pages I read**, so it is **UNVERIFIED**. Filesystem storage is documented as unreplicated.

### Maintenance burden

Three images (Loki, Alloy, Grafana) with three configs (Loki YAML with a schema block, Alloy's own configuration language, Grafana provisioning), a schema version to track, and retention that does nothing unless the compactor setting, the delete-request store and the 24h index period are all in place (LOKI operations/storage/retention). Alloy is the supported replacement for the end-of-life Promtail, so this is not a dead end; the cost is the number of parts.

## Dozzle

- A Go binary with a Vue UI, advertised as "Single binary, no database" that streams logs from Docker (DOZZLE home page, /guide/what-is-dozzle). The home page's install command mounts a `/data` volume without saying what it holds. The docs I read say nothing about log retention or history.
- Footprint, *measured*: v11.3.1, 55 MiB idle with the socket mounted, image 99.8 MB. The docs give no figure.
- Search and fields: it can search, filter by level or time range, and run SQL on JSON logs with an embedded DuckDB WASM engine in the browser; "only JSON logs can be queried using SQL" and the engine is capped at 4 GB of browser memory (DOZZLE, /guide/sql-engine). The page does not say whether the SQL dataset is only what the browser has loaded or the container's full history, so how far back it reaches is **UNVERIFIED**.
- *Inference:* a viewer that streams from Docker can show only what Docker still holds, which is the `json-file` 3 x 10 MB for the current container. It cannot meet "90 days" or "survives a redeploy". Its place, if any, is a live tail next to the real store. It is out of the running as the answer.
- Auth: simple (a `users.yml`), GitHub/OIDC, or a forward proxy such as Cloudflare Access. In forward-proxy mode Dozzle "trusts `Remote-User` on every request", so never publish its port directly (DOZZLE, /guide/authentication). It also needs the Docker socket, which the docs call root on the host.

## journald or syslog to a file, plus a viewer

- Docker's `journald` driver adds fields `CONTAINER_NAME`, `CONTAINER_ID`, `IMAGE_NAME` and `CONTAINER_TAG`, and logs are read with `journalctl CONTAINER_NAME=...` and `-o json`; `docker logs` keeps working (DOCKER drivers/journald). It requires the journald daemon on the host (DOCKER configure). The page does not show Compose syntax.
- *Inference:* journald matches on journal fields, and the app's own `roomId`/`userId` live inside the `MESSAGE` string, so "room X around 22:00" would be a text grep or an `-o json` pipe through a JSON tool, not a field query. I did not read the `journalctl` man page (freedesktop.org refused the fetch), so the exact `--since/--until` and match behaviour is **UNVERIFIED** here.
- Retention (`MaxRetentionSec`, `SystemMaxUse`), journald's rate limiting, and whether the LXC persists the journal at all could not be read (the man pages were unreachable), so these are **UNVERIFIED**. Rate limiting that drops bursts would be a risk for a diagnostic log.
- A "viewer" would still be needed; VictoriaLogs accepts journald and syslog directly (VL data-ingestion), which makes the host journal a source, not a competitor.
- Docker's syslog driver sends to `[tcp|udp|tcp+tls]://host:port`. The page does not say what happens if the server is unreachable at container start (DOCKER drivers/syslog), so that coupling is **UNVERIFIED**. For comparison, the `fluentd` driver is documented to stop the container immediately if it cannot connect unless `fluentd-async` is set (DOCKER drivers/fluentd). A remote driver also switches on Docker's "dual logging" cache of 5 files x 20 MB per container, and a network problem means no write to that cache (DOCKER dual-logging). Reading the socket with Vector avoids tying the app's start to the log stack.

## How the app should format logs

Output one JSON object per line on stdout, flat, never multi-line. This is what both candidates parse well: VictoriaLogs flattens nested keys with `.` and stringifies numbers (VL keyconcepts), and Loki's `| json` flattens with `_` (LOKI query/log_queries).

Suggested fields (names are a proposal for the build ticket, not a decision made here):

| Field | Meaning | Notes |
|---|---|---|
| `time` | ISO 8601 UTC with milliseconds, e.g. `2026-10-12T16:30:01.123Z` | Accepted by VictoriaLogs (`_time_field`); timestamps without a zone use the server's local zone (VL data-ingestion), so always include `Z`. |
| `level` | `debug`, `info`, `warn`, `error` | Use `level:="warn"` style exact matches. |
| `msg` | Short, stable text | Becomes `_msg`. |
| `event` | Dotted name, e.g. `socket.open`, `room.takeover` | The thing to count and filter on. |
| `roomId`, `userId` | Real ids, admin-only per the map | **Never put in stream fields or Loki labels.** |
| `commit` | Running git SHA | The map notes logs do not show which commit is running. |
| `err` | `{name, message, stack}` | The stack is a single JSON-escaped string, not extra lines. |

Rules:

- One event per line, terminated by `\n`. A stack trace stays inside one JSON string. Docker splits very long lines at 16 KB and Vector re-joins them by default, but keep lines small anyway (VictoriaLogs has `-insert.maxLineSizeBytes`, VL FAQ).
- Keep the keys stable and few. The same field names across events make LogsQL (`roomId:="X"`) and LogQL (`| json | roomId="X"`) both work with no mapping.
- No chat content (ADR 4), no tokens, no session ids. The ICE log line in `docs/deploy.md` is the model: candidate types and transports only.
- Start with a thin wrapper over `console.*` that writes JSON, and move the existing call sites over time; the `[ice]`, `[mesh]` and `[quality]` prefixes map onto `event`. (A grep for `console.log|info|warn|error` in `src/` and `server.prod.ts` on 2026-10-12 matched 39 lines, which includes tests and comments, so it overstates the real call sites.)
- A line that is not JSON still works: it lands in `_msg` and remains searchable as text. The `remap` above passes it through unchanged.

## Sketch of the compose additions (not run as a whole)

```yaml
  victorialogs:
    image: docker.io/victoriametrics/victoria-logs:v1.53.0   # pin by digest
    command:
      - -storageDataPath=/victoria-logs-data
      - -retentionPeriod=90d
      - -httpAuth.username=${LOGS_VIEWER_USER:-}
      - -httpAuth.password=${LOGS_VIEWER_PASSWORD:-}
    volumes: [vlogs:/victoria-logs-data]
    ports: ["${HOST_BIND:-10.1.1.160}:9428:9428"]   # LAN only, like the app
    restart: unless-stopped
  vector:
    build: ./vector                                  # FROM timberio/vector@sha256:..., COPY vector.yaml
    volumes: ["/var/run/docker.sock:/var/run/docker.sock"]
    depends_on: [victorialogs]
    restart: unless-stopped
```

Each flag and the Vector config were run separately on a dev box. The assembled stack, the interaction with Dockhand, and the Vector-to-VictoriaLogs credentials were not run.

## How I measured

All on one dev machine reporting 8 CPUs and 16 GiB, with throwaway containers I removed afterwards. Nothing here ran against the homelab LXC.

- **Data set:** 500,000 JSON lines (99.7 MB), timestamps spread evenly over 90 days, 150 rooms, 10 users, 9 event types, a nested `detail` object. Random choice from small sets, so it compresses better than real logs will.
- **VictoriaLogs:** v1.53.0, `-retentionPeriod=90d`. RAM from `docker stats`, disk from `vl_data_size_bytes`, query results printed.
- **Memory-limit runs:** `--memory` and `--memory-swap` set equal at 256m or 512m; "OOM-killed" is `State.OOMKilled`.
- **Other candidates:** images pulled and started with a minimal config, `docker stats` read after 40 s. Loki's number is its default local config at idle; Alloy's is an empty config; Grafana's was taken before any user activity; Dozzle had the socket mounted. None was loaded with data.
- **Vector end to end:** an Alpine container printed JSON lines every 0.2 s with an incrementing `seq`; Vector tailed it and wrote to VictoriaLogs. A stop of the Vector container for about 10 s and a remove-and-recreate of the emitter under the same name were run, then `seq` coverage was checked with `stats` and per-`container_id` queries.
- **Auth and Content-Type:** checked by hand with curl against fresh instances.

## Unverified, collected

- Loki loaded behaviour (RAM, disk, retention actually deleting) and its filesystem backup and restore procedure. I never ingested into Loki.
- Whether Loki's `delete_request_store: filesystem` works with `object_store: filesystem`.
- Whether Grafana allows anonymous access by default.
- Vector's behaviour when VictoriaLogs is down (disk buffer), and how to pass basic-auth credentials to Vector's `http` sink.
- Whether a Docker socket proxy works with Vector.
- Whether VictoriaLogs tolerates a CIFS data directory, and what its disk-cap flags drop first.
- Whether VictoriaLogs treats SIGTERM like the documented SIGINT.
- Whether Dockhand's checkout supports relative bind mounts, and whether it treats a failed `backup` as a failed deploy (docs/deploy.md already flags the second).
- Cloudflare Access's free-plan seat limit (found only in marketing pages and search snippets, not the developer docs).
- Docker's syslog driver behaviour when the server is unreachable at start, and whether VictoriaLogs' syslog listener works with it.
- journald retention, rate-limit defaults, whether the LXC persists the journal, and `journalctl --since/--until` and match behaviour.
- Whether the Grafana VictoriaLogs plugin needs unsigned-plugin settings.
- How vmui behaves in a browser (time picker, time zone display). Queries were run only through the HTTP API.
- Where the VictoriaLogs image writes by default, and whether `/victoria-logs-data` is the right volume path.
- Everything measured on an 8-CPU, 16 GiB box; the LXC may be smaller, and VictoriaLogs adapts its caches to available RAM.
