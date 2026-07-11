# ADR 0022: Deploy the single-node service with Docker Compose and Cloudflare Tunnel

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

V1 retains a single application/signaling node and needs one public HTTP and Socket.IO origin without exposing backing services.

## Decision

Run the application, PostgreSQL, and Valkey on one Docker Compose host in the operator's homelab. Expose only the application through a Cloudflare Tunnel; PostgreSQL and Valkey remain reachable only on the internal Compose network.

## Consequences

- Better Auth and Discord OAuth configuration must use the tunnel's public origin.
- The tunnel, Compose host, database volume, and backup/restore procedure are production dependencies.
- A later multi-node deployment requires a new topology decision rather than expanding this Compose deployment implicitly.
