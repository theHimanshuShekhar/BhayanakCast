# ADR 0039: Allow one active watch subscription per Account

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

The inherited V1 allowed a Room Member to subscribe to multiple Streams. Supporting mobile watch clients and direct P2P media makes concurrent subscriptions costly in bandwidth, CPU, battery, and interaction complexity.

## Decision

A Room Member may hold at most one active Stream Subscription at a time on every supported client. Choosing a different Stream stops the prior subscription before starting the new one.

## Consequences

- The mosaic still represents multiple active Streams, but Watch controls express a single current choice rather than an accumulating set.
- Direct-media fan-out and recovery behavior are simpler and more predictable across desktop and mobile.
- The current user's own Stream remains a local preview and never counts as a self-subscription.
