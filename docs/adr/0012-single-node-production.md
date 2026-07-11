# ADR 0012: Launch as a production-operated single-node service

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The direct P2P media boundary does not itself determine signaling, discovery, and persistence topology. The rewrite needs an explicit launch-scale commitment.

## Decision

Launch with one application and signaling node. This is production-operated rather than a demo: dependency health checks, backups and restore verification, structured operational monitoring, and a pre-launch load test proving 25 simultaneously full rooms (250 active Room Members) are launch requirements. Horizontal scale is out of scope for V1.

## Consequences

- A node restart interrupts its live Socket.IO state and active room connections. Scheduled interruptions are allowed; users must be warned in advance where practical and recovery behavior must be documented.
- The product must document the tested capacity rather than implying unlimited scale.
- Multiple app/signaling nodes require a new coordination and shared-state decision.
