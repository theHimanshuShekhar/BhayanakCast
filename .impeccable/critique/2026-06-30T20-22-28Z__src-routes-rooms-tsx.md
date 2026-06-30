---
target: src/routes/rooms/$roomId.tsx
total_score: 17
p0_count: 2
p1_count: 2
timestamp: 2026-06-30T20-22-28Z
slug: src-routes-rooms-tsx
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | `status` changes to raw join/chat codes, but admission progress and blocker states are not distinct UI states. |
| 2 | Match System / Real World | 2 | Uses room/member language in places, but conflates unavailable/not-found/ended and exposes protocol-ish codes like `JOIN_FAILED`. |
| 3 | User Control and Freedom | 2 | Leave exists, but auth/no-room states have no action, private password/takeover exits are absent, and leave cleanup is incomplete. |
| 4 | Consistency and Standards | 2 | Dark mono shell is consistent, but route gates, tile controls, status copy, and side tabs use uneven patterns and raw utility one-offs. |
| 5 | Error Prevention | 1 | Live controls render before authoritative join; invalid private password/full/banned/duplicate branches are not prevented or guided. |
| 6 | Recognition Rather Than Recall | 2 | Main labels are visible, but icon rail/gear glyphs/status codes require interpretation; no contextual help for room admission blockers. |
| 7 | Flexibility and Efficiency | 2 | Core controls are direct, but no keyboard accelerators or power paths are visible for stream/watch/chat flows. |
| 8 | Aesthetic and Minimalist Design | 2 | Strong Live Signal Deck direction, but oversized radii/shadows and placeholder/fallback tiles add noise before real room state exists. |
| 9 | Error Recovery | 1 | Watch retry exists; join recovery, private password retry UI, duplicate takeover, and protocol-error recovery are missing. |
| 10 | Help and Documentation | 1 | Tooltip-like affordances exist in the shell, but room-specific blockers provide almost no guidance or next step. |
| **Total** | | **17/40** | **Poor — the visual identity is promising, but correctness UX is not shippable.** |

#### Anti-Patterns Verdict

**Does this look AI-generated?** Not at the brand-system level; the dark mono shell, narrow rail, and live-room vocabulary have a real product point of view. It does show Codex/AI tells in the room surface: repeated `rounded-3xl` stream tiles, border-plus-wide-shadow card treatment, gradient avatars, high-chroma utility accents, and placeholder fallback content that exists because the component wants something to render rather than because the protocol says the user should see it.

**LLM assessment**: The biggest problem is not cosmetic. The interface presents a live room shell from loader/local state before server-authoritative admission has succeeded. That breaks the product promise captured in the design plan: no live controls before `joined`. The second problem is gate poverty: auth and unavailable states exist, but private password, duplicate client, full, banned, ended, connection failure, and protocol error are all collapsed into raw status or generic unavailable copy.

**Deterministic scan**: `detect.mjs --json src/routes/rooms/$roomId.tsx` returned 1 warning: `gray-on-color` at `src/routes/rooms/$roomId.tsx:325`, reporting `text-slate-500 on bg-violet-500` in the side tab class string. This is likely a partial false positive because active and inactive classes are mutually exclusive in the template string; still, inactive tab text at `text-slate-500` is visually faint and should be checked against the dark rail.

**Visual overlays**: Browser mutation and detector injection succeeded in the `[Human]` tab, but the app rendered a 500 error page: `{"status":500,"unhandled":true,"message":"HTTPError"}` at `/rooms/00000000-0000-4000-8000-000000000000`. The overlay reported no anti-patterns on that error shell, which is not useful evidence for the actual room UI. The fallback signal is source review plus CLI detector.

#### Overall Impression

The room page has a credible visual direction and several correct product nouns, but it is architecturally ahead of its safety model. It wants to be a live operations deck; today it behaves like a prototype shell that tries to render something while waiting for the room protocol to catch up. The single biggest opportunity is to replace implicit loader/local rendering with an explicit admission state machine and gate components.

#### What's Working

1. **Live Signal Deck identity is present.** The fixed dark shell, compact mono type, violet/coral state language, and side panel structure match `DESIGN.md`.
2. **The mosaic model is product-aligned in broad strokes.** The component distinguishes local preview, watched stream, preview targets, and non-streaming members.
3. **Some realtime state ownership exists.** Socket listeners update members, streams, chat, and feed, which gives the implementation a usable foundation once admission is made authoritative.

#### Priority Issues

**[P0] Live room UI can render before authoritative admission**
- **Why it matters**: Users may see controls, fallback members, and stream actions even though `room:join` has not returned `joined`. This violates the room correctness invariant and risks private/full/banned/duplicate-client leaks.
- **Fix**: Introduce a discriminated `roomJoinState`; render `LiveRoomShell` and `RoomStreamPanel` only for `state: 'joined'` with canonical snapshot data.
- **Suggested command**: `$impeccable harden src/routes/rooms/$roomId.tsx`

**[P0] Missing admission blocker states**
- **Why it matters**: Private password, invalid password, full room, room ban, ended room, duplicate client, and protocol error all need different user decisions and privacy behavior. Current code mostly sets `status` or shows `Room unavailable`.
- **Fix**: Add explicit gate components: `PrivatePasswordGate`, `DuplicateClientGate`, `RoomFullGate`, `RoomBannedGate`, `RoomEndedGate`, `ConnectionFailedGate`, `ProtocolErrorGate`.
- **Suggested command**: `$impeccable harden src/routes/rooms/$roomId.tsx`

**[P1] Leave does not coordinate with local streaming cleanup**
- **Why it matters**: `leaveCurrentRoom` emits `room:leave` and closes the socket, but does not ask `RoomStreamPanel` to stop local stream, thumbnails, peer connections, or active watch subscriptions first.
- **Fix**: Hoist room media controller or expose a cleanup callback/ref from the stream panel. On leave: attempt stop-stream/stop-watch cleanup, always emit `room:leave`, clear local state, then navigate home.
- **Suggested command**: `$impeccable harden src/components/room-stream-panel.tsx`

**[P1] Error copy is protocol-shaped instead of user-shaped**
- **Why it matters**: Raw strings like `JOIN_FAILED`, `CHAT_FAILED`, and `CONNECTION_FAILED` tell the user the system failed, not what to do next. They also make moderation/private-room states feel untrustworthy.
- **Fix**: Map protocol codes to product copy and recovery actions. Example: `INVALID_PASSWORD` -> “That password didn’t open the room. Try again or return to Active Rooms.”
- **Suggested command**: `$impeccable clarify src/routes/rooms/$roomId.tsx`

**[P2] Visual treatment overuses prototype-card tells in the highest-stakes surface**
- **Why it matters**: `rounded-3xl`, wide shadows, gradient avatars, and glow-heavy tiles make blocker/stream states feel less precise. Product correctness needs sharper visual hierarchy.
- **Fix**: Bring room tiles back inside the documented `12px–16px` radius and state-glow rules; reserve heavy shadows for active overlays or live state, not every tile.
- **Suggested command**: `$impeccable polish src/components/room-stream-panel.tsx`

#### Persona Red Flags

**Alex (Power User)**: The room shell has direct stream/watch/chat controls, but Alex cannot tell whether the room has actually admitted them. A disabled `Start stream` button plus status text is slower than a clear gate. Duplicate-tab takeover is absent, so Alex opening the same room in another tab gets no explicit efficient path.

**Sam (Accessibility-Dependent User)**: Gate states are underdeveloped, status changes are raw text instead of announced structured state, and several visual indicators depend on color/glow. The side tab detector warning around `text-slate-500` on active/inactive state needs contrast validation. Auth/unavailable states have no actionable controls, so keyboard users hit dead ends.

**Riley (Stress Tester)**: Riley will break the flow immediately: invalid private password has no visible gate, duplicate room client has no route state, stop-stream failure during leave has no recovery path, and unexpected join payloads can leave live controls visible with `status` set to a code.

**Host Morgan (Project-specific)**: A host moderating a small room needs confidence that room membership and stream controls are canonical. Seeing fallback `Host`, placeholder members, or controls before admission undermines trust in moderation and host ownership.

#### Minor Observations

- `AuthRequiredState` explains sign-in but has no Discord action.
- `RoomNotFoundState` conflates not found, ended, unauthorizable, and no longer live.
- `people.length ? people : ['Host']` invents a host before canonical member data exists.
- The gear glyph `⚙︎ ⌁` in the People tab looks like controls but is not interactive.
- Chat placeholder `say something...` is casual and lowercase; acceptable tone, but should be contrast-checked and disabled until joined.
- Browser route currently returns a generic TanStack 500 error in the tested environment; the app needs a product-styled route/server error boundary for room load failures.

#### Questions to Consider

- What if the room route rendered only three things before admission: auth gate, admission gate, or terminal blocker — never the room shell?
- Should private rooms show any room metadata before admission beyond name/category, or should they stay deliberately opaque?
- Is duplicate-client takeover a modal decision, or important enough to be a full route gate?
- What should the old tab see when the new tab takes over: a hard redirect, a displaced-session gate, or a toast plus redirect?
