# syntax=docker/dockerfile:1

# Backup sidecar (ADR 9 addendum): nightly pg_dump, rsynced to the NAS share. See docs/deploy.md.
# Same major as the db service, so pg_dump always matches the server.
FROM postgres:17-alpine
RUN apk add --no-cache rsync supercronic
COPY --chmod=755 backup.sh entrypoint.sh /usr/local/bin/
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
