# Facilitator card

One page for use during a session. The full rules are in
`docs/operations/usability-qualification.md`; this is the part you hold.

## Before the participant arrives

```bash
docker compose -f compose.yml -f compose.dev.yml down -v          # empty volume: no dev fixtures
docker compose -f compose.yml -f compose.dev.yml up -d postgres valkey
pnpm build && pnpm start                                          # production build, not pnpm dev
node --env-file-if-exists=.env scripts/usability-study-setup.mjs  # study Accounts + cookies
```

`pnpm dev` cannot stream: under the rsbuild dev server the server functions get their own
copy of `room-runtime`, so `startStream` answers `Stream service is not configured`. Run
the study against `pnpm start`, the same way Playwright does.

Then, in the confederate browser: sign in as **Study Host** with the printed cookie, open a
public room, and press **Start Stream**. In the rehearsal browser, sign in as **Study
Rehearsal**, join that room, press **Watch**, and send one message. If video plays and the
message appears, the environment is ready. Leave the room with the confederate still
streaming and close the rehearsal browser.

Confirm the room shows no leftover members or stale Streams from earlier development; a
stranger in the roster changes what the participant sees.

## Setup checklist

- [ ] Production server up; home page loads at the participant's viewport stage
- [ ] Confederate Host streaming in a public room
- [ ] Rehearsal watch played video and rehearsal chat posted
- [ ] Rehearsal browser closed, its Account signed out
- [ ] `/` lists **only** the confederate's room — no `TEST` or demo fixtures
- [ ] Participant browser: fresh profile, signed out, at `/`
- [ ] `study/usability-results.json` open, `study/evidence/` ready for screenshots
- [ ] Observer present, stopwatch ready, and **not** the facilitator
- [ ] Recording started

## Consent

Read §2 verbatim. Get a recorded verbal "yes". Log the timestamp. Do not proceed without it.

## The five prompts — say these and nothing else

| Step | Say |
| --- | --- |
| `sign_in` | "Get yourself signed in." |
| `find_room` | "Find a room you'd want to be in, or make your own." |
| `stream_or_watch` | Chromium desktop: "Share something on your screen with the room." Everyone else: "Get the stream playing for yourself." |
| `chat` | "Say something to the room." |
| `leave` | "You're done — get out of the room." |

## The only other things you may say

1. Once per step, after 45s of silence: **"What are you thinking?"**
2. Once per step: **"What would you do if I weren't here?"**
3. At step end: **"On a scale of 1 to 5, how hard was that?"**
4. Any time: **"We can stop whenever you like."**

Everything else is aid. Naming a control, confirming a guess, or answering a product
question fails the step. If you slip, the observer marks it `aided` — say so out loud.

## Stop the step when

- Success, or
- **240 seconds**, or
- they say they would give up in real life.

Then record: `pass`/`fail`, seconds, difficulty 1–5. On a failure also record the obstacle
code, a one-sentence observation with no product content, and a screenshot.

Also note, per step, which of loading / empty / error / overflow the participant actually
hit — `not_reached` is a valid answer. Never manufacture a state mid-session.

`not_found` · `wrong_mental_model` · `blocked_by_permission` · `blocked_by_latency` ·
`blocked_by_defect` · `abandoned` · `aided`

A failed step does not end the session. Put them at the next step's starting state
yourself — that setup is not scored — and carry on.

## Never write down

Chat message bodies · private-room passwords · credentials · real names, emails, or
Discord handles · shared media frames. Review screenshots before keeping them; discard and
retake rather than redact a chat body.

## After

1. Three open questions: what was confusing, what was missing, would you come back.
2. Offer Account deletion. Stop recording.
3. Replay the journey yourself on the same client and viewport with devtools open; record
   console errors and a11y-tree findings as `replay_console_a11y` (`none` if clean). This
   is diagnostic only — it never changes a step's pass/fail.
4. On the keyboard-only session, record `keyboard_findings`: focus order, focus visibility,
   and whether every needed control was reachable.
5. Append the row to `study/usability-results.json`.
6. `node scripts/usability-acceptance.mjs study/usability-results.json`

`unproven` means the cohort does not yet satisfy §1 — expected until recruitment finishes.
`failed` means the cohort is representative and the rate is below 90%. Record it as a
failed gate; do not relabel it.
