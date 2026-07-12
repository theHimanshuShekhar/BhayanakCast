# BhayanakCast Rewrite Context

## Product

BhayanakCast is a public discovery platform for small social screen-sharing rooms. The rewrite preserves the documented V1 functional contract from `main`.

## Confirmed domain language

**Account**
: A Discord-authenticated identity used for room participation, profiles, moderation, reports, and platform enforcement. Its Discord-mirrored display name and avatar refresh on every sign-in; V1 has no local profile edit.

**Account session**
: Better Auth owns a seven-day rolling PostgreSQL-backed session whose expiry refreshes at most daily while active. Sign-out, approved account deletion, all-access restriction, or credential invalidation revokes access immediately. A Discord Account without provider email uses a non-routable internal placeholder derived from its stable Discord ID; it is never a public/profile/search field, contact address, or verified email.

**Account connection policy**
: A newly accepted authenticated WebSocket becomes the Account's sole active connection across the app. It immediately displaces all older Account WebSockets; displaced clients stop local media/state and must not auto-reconnect to displace the new connection.

**Account preferences**
: Private preferences for persistent chat mutes and the theme override live in a Preferences section on the authenticated `/profile` page. They never appear on public `/users/:userId` profiles.

**Anonymous visitor**
: A person without a BhayanakCast session. They may browse public discovery and public profiles, but cannot join or create rooms, interact with room media/chat, moderate, or request account deletion. A Join-initiated Discord sign-in returns to the same room's pre-admission view without auto-joining or carrying a private password through OAuth.

**Discovery**
: The publicly browseable list of live rooms. It ranks rooms by current Room Member count descending, then active Stream count descending, then most recent meaningful room activity. The home page shows the ten most recently ended Past Streams below Live Rooms, even when none are active; Past Streams are not searchable, paginated, or replayable.

**Home composition**
: Home uses three responsive stages while preserving search/filters, Live Rooms, then Past Streams. Wide (≥1280px) has persistent left identity/action and right statistics/action rails. Medium (768–1279px) keeps a compact left rail, removes the right rail, and collapses statistics with search utilities. Small (<768px) replaces both rails with a top brand bar containing `B`, connected-Account count, and avatar or Log in, plus bottom Home/Create/Profile navigation. Fixed small-stage bars honor safe areas, focus, and touch targets.

**Home scroll model**
: The document is the sole scroll container. Wide rails and the medium left rail stay sticky/viewport-height without nested scrolling, falling into document flow if they cannot fit. Search utilities are sticky only while any query/category/tag is active and sit below the small top bar; clearing all returns normal flow. Small bottom navigation remains fixed.

**Live Rooms presentation**
: Wide Home opens with rank 1 spanning two rows on the left and ranks 2–3 stacked on the right; rank 4 onward forms an equal-size two-column grid. Medium uses a full-width feature plus two-column grid; small uses one ranked column. Missing slots render no placeholders. Data updates live, but feature/order stay stable until reload, return navigation, search/filter context change, explicit refresh, or canonical refresh after realtime reconnection; ended rooms close cells without promotion. Search results are uniform.

**Home loading and realtime recovery**
: TanStack Query is the only Home domain fetching/cache boundary; Better Auth separately owns session state. Route SSR blocks on discovery/search and visible Past Streams, then hydrates without duplicate fetching; facets, statistics, and connected presence prefetch into independent skeleton/error boundaries. Balanced stale times are 15s rooms/presence, 30s facets/statistics, and 60s profiles/Past Streams with 10-minute garbage collection. Stale queries refetch on mount/focus/network reconnect, URL-key change, or Retry—never by polling. Realtime loss marks cached values stale; reconnect invalidates/refetches active Home keys, recomputes rank once, then clears status.

**Room card presence**
: Every Live Room card combines room metadata/state/presence with a one-to-four-tile Stream Preview mosaic. More than four active Streams use the four freshest previews; public tiles are unblurred and private tiles blurred. The featured card gives both mosaic and metadata more area. No-Stream cards use real presence/state/metadata, never fake media.

**Room card navigation**
: A Live Room card is one accessible link to the room's pre-admission page; its chips are descriptive, not nested controls. Pre-admission exposes only permitted summary/state and explicit Join, completing all auth/admission checks before the admitted room layout, chat, media, membership, or peer state appears.

**Past Streams presentation**
: The ten most recently ended Past Streams appear as a compact two-column metadata list on desktop and one column on mobile, ordered newest first. Items show name, end time, visibility, optional category/tags, participation/Stream summary, and Open summary action; they have no image, fake thumbnail, carousel, pagination, or table treatment.

**Empty Live Rooms invitation**
: With no live rooms outside search/filter results, the center shows “The clubhouse is quiet,” concise public/private-room context, and Create Room without illustration or onboarding. Past Streams remain below when available; without history, the invitation adds one short first-community cue. Anonymous activation signs in and returns Home with a blank Create dialog reopened; it never auto-creates.

**In-app discovery search**
: Search finds Active Room names, categories, and tags plus public-profile identity. Wide/medium use searchable Category single-select and Tags multi-select comboboxes; small uses a Filters bottom sheet. Options are normalized distinct values on current Active Rooms with counts; active filters are removable chips. Category matches normalized exact value and multiple tags use AND. Text ranks exact/prefix/substring before conservative fuzzy matches for queries of at least three characters. A query replaces normal Home with separate uniform Active Rooms and Public Profiles groups; filters affect rooms only. Clearing restores Home. Search never returns Past Streams as results, chat, reports, media, private transcripts/preferences, sanctions, or live hidden participant identities.

**Home search navigation**
: Text search uses TanStack Pacer `useDebouncer`, trailing after 250 ms or flushing on Enter; filters apply immediately. Canonical query/category/tag URL parameters form TanStack Query keys and restore share/reload/return state, while edits replace the current history entry. Query functions forward their `AbortSignal`; TanStack Query v5 uses `placeholderData: keepPreviousData` and `isPlaceholderData` to preserve prior results while the next key loads. Localized announcements do not move focus.

**Public Profile search result**
: One accessible link showing Discord avatar/name, compact aggregate usage statistics, three most recent Past Streams, and top three co-users. Excerpts are non-interactive and missing rows collapse. The grouped search projection supplies this bounded public data without per-card requests or any private/live-hidden content.

**Active Room search result**
: A one-column compact horizontal card with a small one-to-four Preview mosaic and allowed room metadata/state/presence; it stacks only when small-screen readability requires. Direct precedes fuzzy relevance, then ties use normal social rank. The whole result links to pre-admission.

**Public URL contract**
: Every documented public page and API path remains stable, including room/profile/admin pages and auth, health, thumbnail, and transcript endpoints. Room and user URLs retain opaque identifiers.

**Search indexing**
: Search engines may index the public home/discovery page and full public profiles. Individual room URLs, including ended/Past Stream views, are noindex; crawler and direct-visitor profiles use the same content.

**Participant eligibility**
: Any Discord-authenticated account may join or create rooms at launch. Safety relies on the documented rate limits, reports, sanctions, and host controls rather than a pre-approval gate.

**Abuse limits**
: V1 retains deterministic limits for room creation, chat, reports, stream commands/thumbnails, and private-password attempts. Rate-limit failures are visible and recoverable; WebRTC signaling is not blanket-rate-limited.

**Room**
: A small, public or private social screen-sharing space with a hard capacity of 10 Room Members in V1. Create Room defaults to Public visibility; a creator may switch to Private and provide the required password.

**Room metadata**
: Create Room requires only a trimmed name of 3–80 user-visible characters. Names need not be unique; opaque room IDs remain authoritative. Category is optional freeform text up to 32 characters, as are up to five optional freeform tags of up to 24 characters each; V1 has no long-form description or predefined taxonomy. The current Host may update this metadata later.

**Create Room flow**
: All Home Create affordances use one form: centered modal on wide/medium and full-screen safe-area/keyboard-aware dialog on small. Anonymous activation carries only an opaque OAuth create intent and reopens a blank authenticated dialog; no fields/password cross OAuth. Submit is explicit. Success atomically enters the creator as Host; current membership closes only after target validation. Failure keeps the dialog/current membership and creates no room.

**Live room admission**
: A live-room URL boundary. Signed-in visitors remain pre-admission until an explicit Join succeeds; private admission includes password validation. Membership, chat, authorized media signaling, media controls, and full live participant details begin only after admission succeeds.

**Room Membership**
: An Account can hold one live Room Membership at a time. The server validates a target room's admission before closing current membership; failed target admission leaves the current room unchanged. A successful switch stops current media/subscription and performs prior-room lifecycle effects before entering the target. Ordinary non-streaming, non-Host leave is immediate; leaving as Host or active streamer requires a confirmation.

**Reconnect grace**
: An unexpected disconnect reserves the Room Member's capacity and membership for 45 seconds. A reconnecting same Account automatically reclaims it without repeated admission; the Stream remains stopped and requires explicit restart. Intentional leave, kick, ban, connection displacement, room end, and admission loss have no grace.

**Empty-room grace**
: After the final Room Member leaves, the room stays discoverable and joinable for five minutes under its current public/private gates. The first eligible new member revives it and becomes Host; otherwise it becomes a Past Stream. Revival begins a new membership interval and never restores stopped Streams or prior live-only state.

**Room lifetime**
: A room expires 12 hours after original creation; no Host transfer, revival, reconnect, or update resets or extends it. Members see persistent countdown state and Activity warnings at 30, 10, and 1 minute. Expiry stops media, closes memberships, and creates the normal Past Stream without grace.

**Live room settings**
: The current Host may change a live room's name, category, tags, and visibility. Public-to-Private changes save with a valid new password and retain current members; Private-to-Public requires confirmation, clears its password, and retains current members. Future admission always uses the current visibility and normal gates.

**Full Room**
: A Room at its 10-Member cap. It remains discoverable with an explicit Full state, but admission is disabled until capacity opens. V1 has no waitlist, reservation, notification, or Host approval queue.

**Private Room**
: A room publicly listed with a lock state. It requires a shared per-room password of at least eight characters before admission and hides participant names and avatars in live discovery. The Host may rotate—but never retrieve—its password without evicting current members; future/rejoining members use the new password. After the room becomes a Past Stream, participation may appear in public profiles and top co-user data.

**Stream**
: A Room Member's direct peer-to-peer screen or application share, with only browser-picker-approved captured audio when available. V1 has no app-level audio setting, microphone capture, synthesized audio, or shared voice channel. A member may have one active Stream per room. To change source, they stop it then start a new browser-picked Stream; browser capture end uses the same stop path. Each Room Member explicitly chooses one active remote Stream to watch; selecting another stops the prior subscription. A Stream end always clears the subscription, and a later Stream needs explicit reselection.

**Capture failure**
: Own Stream uses one bottom-shelf state slot: Start Stream opens the native picker, usable tracks move it to `Starting…` with Cancel during local media/startup work, canonical start acknowledgement moves it to Stop Stream, and Cancel/failure returns it to Start with specific inline guidance. The authorized start command is submitted only after usable tracks and local setup are ready; pre-submit cancellation releases tracks and creates no Stream, Preview, peer connection, or Activity start event. Room/chat/current remote watch remain unchanged, and the picker never reopens automatically.

**Watch recovery**
: Each explicit watch or manual Retry creates one TanStack Pacer `AsyncRetryer` for four total attempts with retries after 1, 2, and 4 seconds. Exhaustion returns to Preview with manual Retry and guidance; Stream end/change, another selection, leave, or cancellation aborts the native WebRTC attempt, closes its peer connection, and discards that single-use retryer.

**Stream Preview**
: A non-subscribed indication that a Stream is live. Public-room previews use an unblurred thumbnail; private-room previews use a blurred thumbnail. TanStack Pacer `useAsyncThrottler` allows an immediate first upload then latest-value trailing uploads at most every two minutes; stop/leave/unmount cancels pending work and aborts in-flight upload. Preview state is live-only and may be frozen as report evidence.

**Admitted Stream Room shell**
: A fixed-viewport media workspace. Desktop uses a 72px icon app rail, two-line room state header, scrollable dark media canvas, integrated control shelf, and a collapsible 360px Chat/People/Activity dock at ≥1280px. Medium uses a non-modal right workspace drawer without scrim, focus trap, media pause, or grid reflow; Close/Escape restores focus and uncovered media controls remain usable. The media surface stays midnight-dark in both themes while surrounding chrome honors theme.

**Room mosaic**
: Stable tiles ordered You, initial current Host when different, then continuous join order. New members append; Host/Stream state never reorders. Before subscription, a streaming tile's thumbnail is a non-interactive Preview with a persistent footer for Streamer identity, Live/freshness, watcher stack/count, explicit Watch, and compact Report/authorized-Host menu. Watch replaces the Preview with the viewer's sole muted live subscription and enlarges that tile in place; desktop/medium uses a stable two-column-by-two-row feature span while uniform remaining tiles fill row-major. A normal cell stays at least 240px wide with a 16:9 visual region plus footer, and the bounded mosaic scrolls before crossing that minimum. Selecting another stops the former watch first. Own sharing appears as a muted local Preview; Start/Stop remains in the shelf. A non-streamer has a real-avatar presence tile with name, Host/You/reconnecting/compatibility state, and contextual menu—not a camera-off video placeholder. A room-session checkbox may hide non-streamers from only that viewer's mosaic.

**Stream watcher stack**
: An admitted-room informational stack on each streaming tile showing up to three watcher avatars plus total watcher count. It has no popover or focus target and orders visible avatars by watch start. It is never exposed in discovery.

**Room control shelf**
: The non-floating desktop surface below the mosaic for the viewer's own Start/Stop Stream, compatibility state, and Leave. Publishing controls never move into the viewer's tile or follow selection. All watched-media controls remain in a persistent footer below—not over—the watched Streamer's contained media: identity/status, watcher count, connection/retry state, Mute/Unmute, Stop Watching, and native Fullscreen. The footer uses one row when space permits and two responsive rows when narrow; it neither scrolls horizontally nor hides controls in More.

**Room companion dock**
: Chat-default desktop tabs for Chat, People, and Activity. The dock may collapse while preserving room-session draft/tab/scroll state. People orders Host, You, active streamers, then continuous join order. Tile/member menus duplicate Report and authorized Host actions; Header Settings manages Metadata, Privacy, and Bans.

**Mobile admitted room**
: Replaces global bottom navigation with a safe-area room bar for Stream, Chat, People, Activity, and Leave/More. The compact header shows Back/name/privacy/countdown and opens Details. Without a watch, the mosaic is two columns; a watched Stream becomes the stage above a horizontal member strip. Companions use explicit 55%/90% sheets. Stream remains visibly disabled as `Desktop only`.

**Media boundary**
: V1 carries media directly between browsers with native `RTCPeerConnection` and public STUN. Authenticated Socket.IO carries application realtime plus authorized WebRTC offers, answers, and ICE candidates, but never captured audio/video. There is no shared voice channel or TURN relay fallback at launch.

**Signaling authorization**
: Every client signaling command is authorized against its authenticated Account connection, admitted Room Membership, current Stream, and sole remote Stream Subscription. Signaling uses opaque application Stream/session IDs rather than a separate peer identity. Displacement, leave, admission loss, Stream stop, Room end, sanction, or watch cancellation blocks further signaling and closes affected peer connections on conforming clients.

**Supported watch clients**
: Stream creation is Chromium-family desktop only. Direct watching is supported on the inherited major desktop browsers, current and previous iOS Safari, and current and previous Chrome on Android after the compatibility gate passes; a failed gate still permits room chat and presence.

**Compatibility Gate**
: A direct-media check. A failed Account joins chat-only, sees clear retry/recovery guidance, and cannot start or watch peer media until it passes. A later success enables media without leaving the room; no relay fallback is introduced.

**Operational boundary**
: V1 runs as one production-operated application/signaling node. It must prove 25 simultaneously full rooms (250 active Room Members) before launch and provide dependency health checks, backup/restore verification, and operational monitoring. Scheduled interruptions may drop live connections and require advance warning where practical; V1 does not promise horizontal scale.

**Observability and analytics**
: V1 keeps structured operational logs and self-hosts PostHog in the homelab for every non-content interaction, including admin/moderation actions, without an in-product opt-in. Signed-in analytics use raw Discord IDs and retain data for one year; approved Account deletion removes that person association while anonymized aggregate events remain. Except for the approved raw Discord ID, identity/profile fields, private-room passwords, room names, chat, reports, and media are excluded; categories/tags and enumerated non-sensitive UI labels may be tracked.

**Technical boundary**
: V1 retains TypeScript, React, TanStack Start with Rsbuild and a custom Node HTTP host, TanStack Query for Home domain fetching/cache/SSR hydration, Socket.IO for application realtime and authenticated native-WebRTC signaling, Better Auth with Discord and sole session ownership, Drizzle/PostgreSQL, Valkey for authoritative application rate limiting, TanStack Pacer for explicit browser execution-control contracts, Node.js, pnpm, and one public HTTP origin. ADR 0105 pins the reviewed baseline; neither Query nor Pacer replaces server timers, lifecycle, or policy.

**Data cutover**
: The rewrite launches with a fresh PostgreSQL schema and data store. No prior Accounts, rooms, history, moderation records, aggregates, or analytics associations are migrated.

**Realtime protocol**
: Socket.IO is an internal implementation protocol. The rewrite may change its events, payloads, acknowledgements, and error mechanics without a legacy shim, while preserving all confirmed behavior and user-visible recovery states.

**Deployment boundary**
: V1 runs the TanStack Start app and Socket.IO on one custom Node HTTP server with PostgreSQL and Valkey on one Docker Compose host in the operator's homelab. Only the app origin is exposed through a Cloudflare Tunnel; backing services are internal to the Compose network.

**Recovery boundary**
: PostgreSQL is backed up daily to encrypted same-site NAS storage for 30 days, with a documented restore exercised monthly. V1 accepts up to 24 hours of persisted-data loss and no recovery guarantee for home/site-wide loss; live-only realtime/media state is not recoverable.

**Launch criteria**
: A representative usability cohort must complete the core room journey unaided at least 90% of the time. At the tested 25-room capacity, 99% of compatibility-supported watch attempts on consumer Wi-Fi/residential broadband or normal cellular must establish direct P2P media without a manual retry. Restrictive enterprise, school, and captive networks use the compatibility/recovery path and are outside that reliability measure. Engagement is observed qualitatively, not as a numeric launch gate.

**Past Stream**
: A non-replayable historical room record. Its metadata remains until account deletion; it never contains stream media. Its stable, noindex room URL renders a summary with public metadata and an end state, never a Join control, public transcript, or replay.

**Room Transcript**
: Retained room chat visible after room end to every historical Host and Platform Admins. It is retained for 30 days after the end and redacted when an Account is deleted.

**Account deletion**
: A self-service request with irreversible confirmation that immediately hides the Account's public profile/activity and restricts it to read-only browsing. A Platform Admin manually verifies it on a best-effort basis with no processing-time commitment; the pending Account can cancel it, and cancellation or rejection restores normal visibility/participation. Approval removes credentials, anonymizes public history, and redacts chat.

**Host**
: The current room owner. A Host can stop active streams, ban or clear bans, kick a Room Member without a persistent ban, and—after confirming the selected current member—transfer authority immediately; a Host cannot end a populated room. Kicked members may immediately rejoin if normal admission gates allow it and receive a generic system message; Hosts cannot attach kick reasons. When a Host permanently leaves, the longest continuously present remaining Room Member becomes Host.

**Room Ban**
: A Host-issued room-scoped restriction that, after confirmation names its target and re-entry effect, immediately removes the target and stops their Stream, then blocks re-entry until a current Host clears it or the room ends. A Host manages active bans through a simple list; V1 has no ban reason or timed ban.

**Host Stream Stop**
: A Host action that immediately ends a current Stream for everyone without preventing the former streamer from starting another. V1 has no Host-written stop reason, temporary stream mute, or per-member stream restriction.

**Platform Admin**
: A trusted operator selected through a static deployment allowlist of Discord account IDs. Platform Admin authority is separate from Host authority; all Platform Admin moderation work is best effort with no response-time commitment. Ending a live room immediately stops media, closes memberships, and creates the normal Past Stream/history records with generic member messaging.

**Platform Sanction**
: A Platform Admin restriction on an Account's streaming, chat, room creation, or all access. New sanctions default to seven days; an Admin may explicitly choose another expiry or an indefinite duration and may lift one early. An all-access sanction immediately removes the Account from live rooms, stops its Streams, and triggers ordinary Host/room lifecycle effects. A streaming sanction stops current Streams; a chat sanction blocks new sends without altering stored chat; neither narrow sanction alone removes membership.

**Public Profile**
: A web-visible account projection with Discord-mirrored identity, aggregate usage statistics, public and private Past Stream history, and top co-users. It never reveals live hidden participant data, private transcripts, reports, or sanctions. Active Accounts have no profile privacy control; deletion is the only removal/anonymization path.

**Top co-users**
: The Accounts with the greatest total duration of concurrent Room Membership with a profile owner. Stream and chat activity do not affect this ranking.

**Report**
: A private safety signal about an account, room, stream, or chat message. It uses a structured reason taxonomy and goes to an internal Platform Admin queue reviewed on a best-effort basis; V1 has no response-time commitment, reporter-facing status, notification, or appeal flow.

**Room Activity**
: A separate live feed of canonical join/leave/reconnect, Host, Stream, room metadata/visibility, and generic forced-departure events received after the member's admission. It begins empty, has no prior-event loading or pagination, and disappears when membership/room ends. Chat remains member-authored; Activity is not part of the retained Room Transcript and never reveals passwords, reports, sanctions, moderation text, or unauthorized private-room identities.

**Chat**
: A normalized Unicode plain-text room message limited to 500 user-visible characters. Emoji remain text; only `http` and `https` URLs are safely linkified. V1 has no Markdown, media, embeds, files, or link previews. Sent messages are immutable: neither authors nor Hosts can edit or delete them.

**Live chat window**
: On first admission, a Room Member receives at most the 50 most recent persisted messages in canonical order, then realtime messages. V1 has no older-message pagination; reconnect-grace recovery does not backfill messages missed during disconnection. Chat mutes apply to both sources.

**Pending chat message**
: A sender-local bubble shown before persistence acknowledgement. Success replaces it with the canonical message/order; failure remains local with Retry/Discard and never reaches another member or the Transcript.

**Typing presence**
: Named Socket.IO-only state above the composer: up to two display names plus `and N others`. TanStack Pacer limits refresh signals to one every two seconds; server state expires after five seconds and stops on empty/blur/send/leave/disconnect. It is never persisted, backfilled, added to Activity/Transcript/analytics, or shown from an Account the viewer muted.

**Room UI recovery**
: Compatibility failure is an inline chat-only banner. Reconnect grace stops own and watched peer media and requires explicit Start/Watch after reclaim. Forced departure clears admitted state into same-URL pre-admission; room end transitions the stable URL in place to its generic Past Stream summary.

**Chat mute**
: A private account-level preference that hides another Account's chat in every room until manually removed. It does not affect room presence, streams, discovery, profiles, or the muted Account's experience.

**Content boundary**
: BhayanakCast is a general-audience community. Sexual/explicit content and graphic or illegal content are prohibited; no separate age gate exists beyond Discord authentication.

**Policy acceptance**
: Discord sign-in alone permits room participation. V1 displays relevant terms only in the account-deletion flow's irreversible confirmation; community rules remain discoverable and enforceable without an acceptance gate.

**Language**
: V1 product copy, moderation taxonomy, and user flows are English only. User-provided names, room metadata, and chat remain Unicode-safe and are not limited to English.

**Design direction**
: The UI is a redesigned community clubhouse: welcoming, lively, and easy to scan as people browse and move between rooms. It does not inherit the former dark operational-console aesthetic, but it retains the product's state-legibility and accessibility requirements.

**Theme**
: V1 provides intentional light and dark themes, each with the same state clarity, accessible contrast, focus treatment, and reduced-motion behavior.

**Visual system**
: Source Sans 3 uses a fixed 13/14/16/18/24/30/36px scale. Porcelain light (`#F6F8FC` canvas, `#2457D6` cobalt) and midnight dark (`#0D1422` canvas, `#82A5FF` cobalt) themes use distinct live, host, warning, danger, and private semantics. Cards/panels use 12px radii, controls 8px, pills only for tags/status. Motion uses 120/180/240ms eased tokens and becomes immediate under reduced motion. Wide Home centers within 1600px using 216px/640–1040px/280px columns; medium uses a 72px icon rail; small uses 16px gutters and labeled 56px/64px fixed bars.

## Decision records

- [`docs/adr/0001-rewrite-product-baseline.md`](docs/adr/0001-rewrite-product-baseline.md) — preserves the documented V1 functional contract.
- [`docs/adr/0002-p2p-v1-media-boundary.md`](docs/adr/0002-p2p-v1-media-boundary.md) — retains the V1 capacity and direct-media constraints.
- [`docs/adr/0003-private-room-discovery.md`](docs/adr/0003-private-room-discovery.md) — keeps private-room discovery and admission boundaries.
- [`docs/adr/0004-data-lifecycle-and-account-deletion.md`](docs/adr/0004-data-lifecycle-and-account-deletion.md) — defines launch retention and anonymization requirements.
- [`docs/adr/0005-platform-admin-allowlist.md`](docs/adr/0005-platform-admin-allowlist.md) — keeps platform authority in deployment configuration.
- [`docs/adr/0006-public-web-profiles.md`](docs/adr/0006-public-web-profiles.md) — opens public-profile reads to anonymous visitors.
- [`docs/adr/0007-private-room-history-visibility.md`](docs/adr/0007-private-room-history-visibility.md) — applies public-profile history rules to private rooms.
- [`docs/adr/0008-structured-report-intake.md`](docs/adr/0008-structured-report-intake.md) — defines report reasons and the internal review workflow.
- [`docs/adr/0009-host-kick-without-ban.md`](docs/adr/0009-host-kick-without-ban.md) — adds a non-banning forced-leave action for Hosts.
- [`docs/adr/0010-co-user-ranking.md`](docs/adr/0010-co-user-ranking.md) — ranks co-users by concurrent room-membership time.
- [`docs/adr/0011-anonymous-discovery.md`](docs/adr/0011-anonymous-discovery.md) — defines the pre-sign-in discovery boundary.
- [`docs/adr/0012-single-node-production.md`](docs/adr/0012-single-node-production.md) — sets the production launch topology and operational gate.
- [`docs/adr/0013-launch-success-criteria.md`](docs/adr/0013-launch-success-criteria.md) — defines usability and realtime-media launch criteria.
- [`docs/adr/0014-mobile-watch-support.md`](docs/adr/0014-mobile-watch-support.md) — expands the supported watch population to mobile clients.
- [`docs/adr/0015-redesign-product-ui.md`](docs/adr/0015-redesign-product-ui.md) — replaces the inherited visual system.
- [`docs/adr/0016-community-clubhouse-design.md`](docs/adr/0016-community-clubhouse-design.md) — establishes the new interface scene.
- [`docs/adr/0017-adaptive-light-and-dark-theme.md`](docs/adr/0017-adaptive-light-and-dark-theme.md) — requires equal-quality light and dark themes.
- [`docs/adr/0018-general-audience-content-policy.md`](docs/adr/0018-general-audience-content-policy.md) — defines the V1 audience and prohibited-content boundary.
- [`docs/adr/0019-persistent-chat-mute.md`](docs/adr/0019-persistent-chat-mute.md) — adds a private account-level chat-only mute.
- [`docs/adr/0020-discovery-ordering.md`](docs/adr/0020-discovery-ordering.md) — ranks rooms by current social presence.
- [`docs/adr/0022-compose-cloudflare-tunnel-deployment.md`](docs/adr/0022-compose-cloudflare-tunnel-deployment.md) — defines the single-node production deployment boundary.
- [`docs/adr/0023-postgres-backup-and-restore.md`](docs/adr/0023-postgres-backup-and-restore.md) — sets backup retention and recovery expectations.
- [`docs/adr/0024-sync-discord-identity-on-sign-in.md`](docs/adr/0024-sync-discord-identity-on-sign-in.md) — refreshes public Discord identity at authentication.
- [`docs/adr/0025-best-effort-admin-moderation.md`](docs/adr/0025-best-effort-admin-moderation.md) — makes every Platform Admin moderation task best effort.
- [`docs/adr/0026-english-only-v1.md`](docs/adr/0026-english-only-v1.md) — limits V1 product localization to English.
- [`docs/adr/0027-seven-day-sanction-default.md`](docs/adr/0027-seven-day-sanction-default.md) — makes seven days the explicit default sanction duration.
- [`docs/adr/0028-structured-logs-and-posthog.md`](docs/adr/0028-structured-logs-and-posthog.md) — adds PostHog alongside structured operational logging.
- [`docs/adr/0029-preserve-public-url-contract.md`](docs/adr/0029-preserve-public-url-contract.md) — preserves every documented public page and API path.
- [`docs/adr/0030-realtime-protocol-is-internal.md`](docs/adr/0030-realtime-protocol-is-internal.md) — permits a clean realtime-protocol cutover.
- [`docs/adr/0031-fresh-postgres-database.md`](docs/adr/0031-fresh-postgres-database.md) — starts the rewrite with a clean data store.
- [`docs/adr/0032-private-room-password-rotation.md`](docs/adr/0032-private-room-password-rotation.md) — allows Hosts to rotate a live private-room password.
- [`docs/adr/0033-search-engine-indexing.md`](docs/adr/0033-search-engine-indexing.md) — indexes home/profiles while excluding individual rooms.
- [`docs/adr/0034-retain-v1-rate-limits.md`](docs/adr/0034-retain-v1-rate-limits.md) — retains all documented V1 abuse-rate limits.
- [`docs/adr/0035-visibility-aware-stream-previews.md`](docs/adr/0035-visibility-aware-stream-previews.md) — makes preview blur depend on room visibility.
- [`docs/adr/0036-terms-at-account-deletion-only.md`](docs/adr/0036-terms-at-account-deletion-only.md) — keeps participation ungated by a terms acknowledgement.
- [`docs/adr/0037-profile-preferences.md`](docs/adr/0037-profile-preferences.md) — keeps private preference management on `/profile`.
- [`docs/adr/0038-historical-host-transcript-access.md`](docs/adr/0038-historical-host-transcript-access.md) — preserves transcript access for every historical Host.
- [`docs/adr/0039-one-active-watch-subscription.md`](docs/adr/0039-one-active-watch-subscription.md) — limits every Account to one current watched Stream.
- [`docs/adr/0040-one-websocket-connection-per-account.md`](docs/adr/0040-one-websocket-connection-per-account.md) — makes a newly accepted WebSocket globally replace older Account connections.
- [`docs/adr/0043-empty-discovery-onboarding.md`](docs/adr/0043-empty-discovery-onboarding.md) — combines Past Streams with a Create Room empty state.
- [`docs/adr/0044-public-room-default.md`](docs/adr/0044-public-room-default.md) — makes Public the Create Room default.

- [`docs/adr/0045-live-room-settings.md`](docs/adr/0045-live-room-settings.md) — permits current Hosts to change live metadata and visibility safely.
- [`docs/adr/0046-full-room-no-waitlist.md`](docs/adr/0046-full-room-no-waitlist.md) — keeps full rooms visible without queue semantics.
- [`docs/adr/0047-forty-five-second-reconnect-grace.md`](docs/adr/0047-forty-five-second-reconnect-grace.md) — reserves unexpected-disconnect membership for 45 seconds.
- [`docs/adr/0048-earliest-member-host-handoff.md`](docs/adr/0048-earliest-member-host-handoff.md) — hands Host authority to the earliest remaining member.
- [`docs/adr/0049-plain-text-chat-safe-links.md`](docs/adr/0049-plain-text-chat-safe-links.md) — limits room chat to plain text and safe links.
- [`docs/adr/0050-immutable-room-chat.md`](docs/adr/0050-immutable-room-chat.md) — keeps sent room chat immutable.
- [`docs/adr/0051-any-member-empty-room-revival.md`](docs/adr/0051-any-member-empty-room-revival.md) — lets any eligible Account revive an empty-grace room.
- [`docs/adr/0052-room-and-profile-discovery-search.md`](docs/adr/0052-room-and-profile-discovery-search.md) — scopes in-app search to Active Rooms and public profiles.
- [`docs/adr/0053-ten-recent-past-streams-home-section.md`](docs/adr/0053-ten-recent-past-streams-home-section.md) — shows ten recent Past Streams below Live Rooms.
- [`docs/adr/0054-single-room-membership-safe-switch.md`](docs/adr/0054-single-room-membership-safe-switch.md) — limits Accounts to one live room with safe target-first switching.
- [`docs/adr/0055-host-cannot-end-populated-room.md`](docs/adr/0055-host-cannot-end-populated-room.md) — keeps early room ending Platform Admin-only.
- [`docs/adr/0056-voluntary-host-transfer.md`](docs/adr/0056-voluntary-host-transfer.md) — lets Hosts transfer authority to a selected current member.
- [`docs/adr/0057-immediate-room-ban-manual-unban.md`](docs/adr/0057-immediate-room-ban-manual-unban.md) — makes Room Bans immediate and Host-cleared.
- [`docs/adr/0058-host-stop-current-stream-only.md`](docs/adr/0058-host-stop-current-stream-only.md) — limits Host stream stops to current Streams.
- [`docs/adr/0059-chat-only-media-compatibility-path.md`](docs/adr/0059-chat-only-media-compatibility-path.md) — admits media-incompatible members as chat-only.
- [`docs/adr/0060-name-only-room-creation.md`](docs/adr/0060-name-only-room-creation.md) — requires only a room name at creation.
- [`docs/adr/0061-all-access-sanction-forces-live-leave.md`](docs/adr/0061-all-access-sanction-forces-live-leave.md) — applies all-access sanctions to live rooms immediately.
- [`docs/adr/0062-immediate-stream-and-chat-sanctions.md`](docs/adr/0062-immediate-stream-and-chat-sanctions.md) — immediately enforces narrow stream and chat sanctions.
- [`docs/adr/0063-past-stream-summary-direct-view.md`](docs/adr/0063-past-stream-summary-direct-view.md) — keeps ended room URLs as non-replayable summaries.
- [`docs/adr/0064-create-enters-room-as-host.md`](docs/adr/0064-create-enters-room-as-host.md) — enters a successful creator directly as Host.
- [`docs/adr/0065-public-room-avatar-stack.md`](docs/adr/0065-public-room-avatar-stack.md) — shows public-room avatar stacks without names.
- [`docs/adr/0066-stop-before-new-stream-source.md`](docs/adr/0066-stop-before-new-stream-source.md) — requires stopping before choosing a new Stream source.
- [`docs/adr/0067-explicit-watch-after-stream-restart.md`](docs/adr/0067-explicit-watch-after-stream-restart.md) — requires explicit watch selection after a Stream ends.
- [`docs/adr/0068-browser-picker-capture-audio.md`](docs/adr/0068-browser-picker-capture-audio.md) — uses only browser-picker-approved captured audio.
- [`docs/adr/0069-confirm-host-or-streaming-leave.md`](docs/adr/0069-confirm-host-or-streaming-leave.md) — confirms leave only when it stops media or transfers Host authority.
- [`docs/adr/0070-explicit-live-room-join.md`](docs/adr/0070-explicit-live-room-join.md) — requires an explicit Join action before live membership.
- [`docs/adr/0071-fifty-message-live-chat-window.md`](docs/adr/0071-fifty-message-live-chat-window.md) — loads a bounded 50-message live chat window.
- [`docs/adr/0072-separate-room-activity-feed.md`](docs/adr/0072-separate-room-activity-feed.md) — keeps canonical room events out of human-authored chat.
- [`docs/adr/0073-admin-end-creates-past-stream.md`](docs/adr/0073-admin-end-creates-past-stream.md) — transitions Admin-ended rooms directly to Past Streams.
- [`docs/adr/0074-return-to-room-after-signin.md`](docs/adr/0074-return-to-room-after-signin.md) — returns OAuth room intent to explicit pre-admission.
- [`docs/adr/0075-twelve-hour-room-lifetime.md`](docs/adr/0075-twelve-hour-room-lifetime.md) — caps live rooms at twelve hours with staged warnings.
- [`docs/adr/0076-duplicate-live-room-names.md`](docs/adr/0076-duplicate-live-room-names.md) — allows duplicate names while opaque room IDs remain authoritative.
- [`docs/adr/0077-three-direct-watch-retries.md`](docs/adr/0077-three-direct-watch-retries.md) — bounds direct-watch recovery to three automatic retries.
- [`docs/adr/0078-failed-capture-creates-no-stream.md`](docs/adr/0078-failed-capture-creates-no-stream.md) — keeps failed capture attempts out of live Stream state.
- [`docs/adr/0079-search-first-homepage-header.md`](docs/adr/0079-search-first-homepage-header.md) — leads Home with search and discovery controls.
- [`docs/adr/0080-stable-featured-live-room.md`](docs/adr/0080-stable-featured-live-room.md) — features the leading Live Room without live layout churn.
- [`docs/adr/0081-homepage-sidebar-and-stats-rail.md`](docs/adr/0081-homepage-sidebar-and-stats-rail.md) — frames desktop Home with identity and statistics rails.
- [`docs/adr/0082-mobile-home-brand-bar-and-nav.md`](docs/adr/0082-mobile-home-brand-bar-and-nav.md) — adapts Home to a top brand bar and bottom navigation.
- [`docs/adr/0083-home-search-replaces-sections.md`](docs/adr/0083-home-search-replaces-sections.md) — replaces normal Home sections with uniform search result groups.
- [`docs/adr/0084-four-stream-room-card-mosaic.md`](docs/adr/0084-four-stream-room-card-mosaic.md) — shows up to four fresh Stream Previews on every Live Room card.
- [`docs/adr/0085-two-column-past-stream-list.md`](docs/adr/0085-two-column-past-stream-list.md) — presents recent Past Streams as a compact metadata list.
- [`docs/adr/0086-open-invitation-empty-home.md`](docs/adr/0086-open-invitation-empty-home.md) — uses a text-led Create Room invitation when no rooms are live.
- [`docs/adr/0087-three-stage-home-shell.md`](docs/adr/0087-three-stage-home-shell.md) — adapts Home across wide, medium, and small composition stages.
- [`docs/adr/0088-room-card-opens-pre-admission.md`](docs/adr/0088-room-card-opens-pre-admission.md) — makes the full card navigate to the room's pre-admission boundary.
- [`docs/adr/0089-editorial-live-room-grid.md`](docs/adr/0089-editorial-live-room-grid.md) — arranges ranked Live Rooms in an editorial responsive grid.
- [`docs/adr/0090-adaptive-filters-and-fuzzy-search.md`](docs/adr/0090-adaptive-filters-and-fuzzy-search.md) — defines responsive category/tag controls and direct-first fuzzy matching.
- [`docs/adr/0091-url-backed-debounced-home-search.md`](docs/adr/0091-url-backed-debounced-home-search.md) — makes Home search responsive, shareable, and navigation-safe.
- [`docs/adr/0092-tanstack-pacer-execution-control.md`](docs/adr/0092-tanstack-pacer-execution-control.md) — applies Pacer to browser debounce, retry, and throttle contracts without replacing server policy.
- [`docs/adr/0093-rich-profile-search-results.md`](docs/adr/0093-rich-profile-search-results.md) — makes profile search results rich, bounded, and single-action.
- [`docs/adr/0094-compact-room-search-results.md`](docs/adr/0094-compact-room-search-results.md) — renders room matches as compact relevance-first rows.
- [`docs/adr/0095-home-scroll-and-search-stickiness.md`](docs/adr/0095-home-scroll-and-search-stickiness.md) — uses one page scroll and pins search only while active.
- [`docs/adr/0096-homepage-visual-system.md`](docs/adr/0096-homepage-visual-system.md) — fixes Home typography, themes, geometry, navigation, and motion.
- [`docs/adr/0097-responsive-create-room-dialog.md`](docs/adr/0097-responsive-create-room-dialog.md) — uses one responsive form and safely restores anonymous create intent.
- [`docs/adr/0098-server-first-resilient-home.md`](docs/adr/0098-server-first-resilient-home.md) — keeps Home usable through section failures and realtime recovery.
- [`docs/adr/0099-tanstack-query-home-data.md`](docs/adr/0099-tanstack-query-home-data.md) — makes Query the sole cached Home domain-data boundary with SSR and realtime synchronization.
- [`docs/adr/0100-media-canvas-room-shell.md`](docs/adr/0100-media-canvas-room-shell.md) — defines the fixed media workspace and responsive companion dock.
- [`docs/adr/0101-single-watch-adaptive-mosaic.md`](docs/adr/0101-single-watch-adaptive-mosaic.md) — keeps one explicit watched Stream in a stable adaptive member mosaic.
- [`docs/adr/0102-room-companions-and-chat-feedback.md`](docs/adr/0102-room-companions-and-chat-feedback.md) — defines companion, chat pending/unread, typing, and contextual safety behavior.
- [`docs/adr/0103-responsive-room-controls-and-recovery.md`](docs/adr/0103-responsive-room-controls-and-recovery.md) — defines mobile controls, sheets, compatibility, reconnect, departure, and room-end transitions.
- [`docs/adr/0104-native-webrtc-over-socket-io.md`](docs/adr/0104-native-webrtc-over-socket-io.md) — uses native WebRTC with authenticated Socket.IO signaling.
- [`docs/adr/0105-validated-v1-technology-baseline.md`](docs/adr/0105-validated-v1-technology-baseline.md) — pins the reviewed runtime, build, auth, data, and execution-control baseline.
- [`docs/adr/0106-layered-testing-and-release-evidence.md`](docs/adr/0106-layered-testing-and-release-evidence.md) — separates deterministic domain/integration coverage, representative multi-user browser tests, and production qualification evidence.