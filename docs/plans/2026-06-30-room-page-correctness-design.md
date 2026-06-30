# Room Page Correctness Design

## Context

BhayanakCast is a product-register UI for Discord-authenticated small social streaming rooms. The room page must align with the existing product contract: users join rooms through authoritative Socket.IO admission, private rooms preserve privacy before admission, rooms contain multiple member streams, and live controls must not render until the current client is actually admitted.

Primary outcome: correctness first, with full room-page coverage for admission, active-client takeover, leave cleanup, and connection retry/error behavior.

Primary acceptance criterion: protocol alignment. The UI must mirror server authority exactly, even when that requires explicit waiting and blocker states.

Chosen approach: server-authoritative room-state machine.

## Architecture and State Model

Room correctness centers on a single client-side `roomJoinState` machine owned by `src/routes/rooms/$roomId.tsx` or a colocated room controller hook. Loader data remains useful, but only as pre-admission context: room existence hints, current user/session, ended/not-found coarse outcomes, and enough metadata to explain why a gate is showing. It must not be treated as authority to render the live mosaic.

The authoritative path begins after three prerequisites are ready: authenticated session, socket connection, and route params. Then the client sends `room:join`. Until the server responds, the route renders an explicit gate state such as `joining`. If the server returns `joined`, the route stores the canonical room snapshot and renders the live room shell: header, member mosaic, right panel, bottom dock, stream controls, chat/feed. If the server returns a blocker, the route renders that blocker as its own focused state: `authRequired`, `passwordRequired`, `passwordRejected`, `roomFull`, `roomBanned`, `roomEnded`, `notFound`, `duplicateClient`, `connectionFailed`.

Duplicate-client takeover is part of the same machine, not a separate modal bolted onto the live UI. The first join response returns `duplicateClient`; the user chooses cancel or take over. Confirming sends a second join command with takeover intent. Only the second authoritative `joined` response can render live UI. Cancel navigates home or returns to discovery.

Invariant: no live room controls render until the server has admitted this client and returned canonical state.

## UI States and Components

The route should expose a small set of explicit gate components instead of one vague error screen. Each gate is a focused product state with a single primary action and clear protocol meaning.

`AuthRequiredGate` appears before any socket join attempt when there is no authenticated account. It explains that rooms require Discord authentication and offers “Continue with Discord.”

`JoiningGate` is the neutral waiting state after session/socket readiness but before server authority. It should use the existing Live Signal Deck language: compact panel, subdued spinner/skeleton, copy like “Requesting room admission…”

`PrivatePasswordGate` asks for the room password before `room:join` or as a retry branch after `INVALID_PASSWORD`. It must not show hidden participant identities for private rooms. Failed attempts stay in the same gate with inline error copy; no route navigation.

`DuplicateClientGate` is a decision screen, not a toast. It explains that this account is already active in the room elsewhere. Primary action: “Take over this room session.” Secondary: “Cancel.” Confirm sends takeover intent and returns to `joining`; cancel navigates home.

`RoomFullGate`, `RoomBannedGate`, `RoomEndedGate`, and `NotFoundGate` are terminal blockers. Each offers a safe exit to Active Rooms. `RoomEndedGate` may show Past Stream metadata if the loader/server provides a safe public projection, but never live controls.

`ConnectionFailedGate` appears only after retry exhaustion, keeping recovery explicit with “Retry join” and “Back to Active Rooms.”

After `joined`, the `LiveRoomShell` receives only canonical server snapshot state. The shell should not know how to interpret admission errors; it only renders admitted-room interaction.

## Data Flow and Protocol Boundaries

The room route separates loader facts, socket authority, and local media state.

The loader handles route bootstrapping only. It may return current session hints, room existence, ended-room metadata, and safe private-room discovery fields. It should not create room membership, infer admission, or decide that a user is live in the room. For private rooms, the loader must keep the same privacy boundary as discovery cards: private room existence can be known, but participant identities and live internals are hidden until admission.

Socket.IO owns admission and canonical room hydration. `room:join` returns one of a discriminated set: `joined`, `passwordRequired`, `invalidPassword`, `roomFull`, `roomBanned`, `roomEnded`, `duplicateClient`, `notFound`, or a transport/protocol error. `joined` includes canonical room, members, active streams, recent messages, current host, capacity, and the current client’s member identity. Every server update after admission mutates this canonical room store, not the loader snapshot.

Duplicate takeover is a two-step exchange. First response blocks with `duplicateClient`. Confirming sends `room:join` with takeover intent or a separate `room:takeover` command, depending on the existing protocol. The previous client receives a server event instructing it to stop local stream/subscriptions, clear room state, and navigate home. The new client renders live UI only after server-confirmed `joined`.

Local media state is downstream of admission. Stream capture, local preview, peer subscriptions, and stop-stream cleanup only run after `joined`. Leaving while streaming should call stop-stream cleanup first, then send authoritative `room:leave`; if cleanup fails, leave still proceeds with a visible warning path.

## Error Handling and Recovery

Error handling is explicit because the room page is stateful, realtime, and safety-sensitive. Each failure needs a protocol category, user copy, and recovery action.

Authentication failure is not an error dialog. It is a pre-join route state with a Discord sign-in action.

Missing or rejected private passwords stay in the password gate: empty password shows “Enter the room password”; rejected password shows “That password didn’t open the room.” The user can retry without losing route context.

Full, banned, not-found, and ended are terminal admission outcomes. They should not retry automatically because the server has made an authoritative decision. Each screen explains the state in product language and exits to Active Rooms. `RoomBannedGate` should avoid implying platform-wide punishment unless the server actually returned a platform sanction. Room bans are room-scoped.

Connection failure is separate from admission rejection. The client retries join up to the existing contract: 3 attempts over 15 seconds. During retries, keep the user in a `joining`/`reconnecting` gate with attempt-aware copy. After exhaustion, show `ConnectionFailedGate` with “Retry join” and “Back to Active Rooms.” Manual retry resets the attempt counter.

Leave cleanup has a safety-first rule: user intent to leave should not be blocked by local media cleanup failure. If the user is streaming, the client attempts to stop the stream first, releases local tracks/subscriptions, then sends `room:leave`. If stream stop fails, still send `room:leave`, clear local state, navigate home, and surface a non-blocking warning/log path rather than trapping the user in the room.

Any unexpected protocol payload should fail closed: do not render `LiveRoomShell`; show a recoverable protocol error gate.

## Testing Strategy

Testing should prove the protocol contract, not just snapshots of UI text. The main unit under test is the room state machine/controller, with route/component tests around visible gates.

State-machine tests should cover every admission result: unauthenticated, joining, joined, password required, invalid password retry, room full, room banned, ended, not found, duplicate client, connection retry, connection exhaustion, protocol error. Each test should assert the rendered state and allowed actions. Tests must assert that `LiveRoomShell` is not rendered before `joined`.

Duplicate-client tests need the strongest coverage. First `room:join` returns `duplicateClient`; the route must show `DuplicateClientGate`. Cancel navigates home and does not render live UI. Confirm sends takeover intent and returns to `joining`. Only a second `joined` response renders the shell. A server “client displaced” event on the old client clears local room state, stops local stream/subscriptions, and navigates home.

Private-room tests should verify privacy boundaries: before admission, hidden participant identities stay hidden; invalid password does not enter a Socket.IO room; successful password join renders canonical server state. Full/banned/ended/not-found tests should verify terminal gates and safe exit actions.

Leave cleanup tests should simulate streaming and non-streaming users. For streaming users, assert stop-stream cleanup is attempted before `room:leave`. Then add the failure branch: stop-stream rejects, but `room:leave` still sends and navigation still occurs. Connection tests should simulate 3 attempts over 15 seconds, then verify manual retry resets the counter.

End-to-end coverage can stay narrow: one happy public join, one private password failure/success, one duplicate takeover, one leave-while-streaming path.
