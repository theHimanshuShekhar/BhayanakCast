# ADR 0067: Require an explicit watch choice after every stream end

- **Status:** Accepted
- **Date:** 2026-07-10

## Context

A Stream ending may reflect a source change, Host action, browser failure, or deliberate content change. Automatically reconnecting a viewer to a later Stream would weaken the product's explicit one-active-watch choice.

## Decision

When a watched Stream ends, the viewer's remote subscription clears. If the same Room Member later starts a new Stream, it appears as a new selectable Stream/Preview; the viewer must explicitly select it to watch.

## Consequences

- No peer connection, Stream session, or watch intent is inherited across a Stream end/start boundary.
- Viewer UI must make the stopped state clear and retain other available Streams/Previews for deliberate selection.
- This rule applies equally to normal stop, browser capture end, Host stop, disconnect, sanction, and source switching.
