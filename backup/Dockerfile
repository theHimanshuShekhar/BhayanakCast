# syntax=docker/dockerfile:1

# Backup sidecar (ADR 9 addendum): nightly pg_dump, rsynced to the NAS share. See docs/deploy.md.
# Same major as the db service, so pg_dump always matches the server: keep the digest identical to
# the db image in ../docker-compose.yml, and never move off major 17 without moving both (and the
# data: a major bump needs a dump and restore, not a tag change).
# Reproducible build: the base is pinned by digest and the apk packages to the versions it resolves
# (Alpine 3.24: rsync 3.5.0-r0, supercronic 0.2.49-r0). Alpine's repo keeps only the current
# revision, so when it moves on, the build fails on the pin: re-check with
# `docker run --rm <image> apk policy rsync supercronic`. See docs/deploy.md ("Pinned images").
FROM postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24
RUN apk add --no-cache rsync=3.5.0-r0 supercronic=0.2.49-r0
COPY --chmod=755 backup.sh entrypoint.sh healthcheck.sh /usr/local/bin/
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
