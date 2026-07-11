# ADR 0023: Use daily same-site NAS PostgreSQL backups

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The production service stores accounts, rooms, transcripts, reports, sanctions, and aggregate data on a single Compose host. Production operation needs a bounded recovery expectation.

## Decision

Create encrypted PostgreSQL backups daily to the operator's same-site NAS, retain them for 30 days, and exercise a documented restore at least monthly. V1 accepts a recovery point objective of up to 24 hours of PostgreSQL data loss.

## Consequences

- The NAS destination, encryption-key handling, and restore runbook are required homelab deployment artifacts.
- Same-site NAS backups protect against Compose-host failure but do not provide recovery from a home/site-wide loss.
- Daily retention jobs and account-data retention policies do not replace backup retention.
- Live-only Socket.IO/WebRTC state and non-persisted preview thumbnails are outside database recovery guarantees.
