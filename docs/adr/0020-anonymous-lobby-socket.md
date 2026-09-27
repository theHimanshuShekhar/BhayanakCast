# 20. Anonymous read-only socket for visitors, upgraded on sign-in

Date: 2026-09-27 · Status: accepted · Amends ADR 7

## Context
Visitors (signed out) can browse home, profiles and recaps (ADR 6 addendum). The side rail shows a live count of **online users**, and room lists update live. ADR 7 rejected every unauthenticated WebSocket upgrade.

## Decision
- Unauthenticated upgrades are accepted into a **read-only lobby channel**. It carries only public, list-level events: online-user count and public room list changes. It never carries room signalling, presence details, chat, or anything about private rooms.
- The server ignores any client message on an anonymous socket except heartbeat, and applies per-IP connection limits.
- After sign-in the client reconnects with the session cookie and becomes an authenticated socket. Only authenticated sockets can join rooms or count towards **online users**.

## Consequences
- Visitors see live counts without polling.
- The anonymous surface is small but public, so rate and connection limits and strict message validation are required.
