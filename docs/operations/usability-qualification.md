# Usability qualification protocol

Qualifies the ADR 0013 launch criterion: **at least 90% of a representative usability
cohort completes the core journey unaided**. ADR 0013 also requires that the cohort be
representative rather than internal implementers alone.

This document is the protocol. It is authored and dry-run by the implementation team;
the qualifying study itself is run by a facilitator against a real external cohort. No
agent, Playwright run, or synthetic browser session substitutes for cohort results
(ADR 0106 §3 — Playwright proves browser-observable journeys, not launch usability).

## 1. Cohort definition

### Eligible

A participant is eligible when all of the following hold.

- Uses Discord at least weekly and can sign in with an existing Discord account.
- Has watched or hosted a live stream (any platform) in the last 90 days.
- Comfortable reading English (ADR 0026 — V1 is English only).
- Arrives on a compatibility-supported client (ADR 0014):
  - **Desktop** — current or previous major Chrome, Edge, Firefox, or Safari.
  - **Mobile** — current or previous major iOS Safari, or Chrome on Android.

### Excluded

- Anyone who wrote, reviewed, specified, ticketed, or designed BhayanakCast code or docs.
- Anyone who has seen a BhayanakCast design mock, PRD, or internal demo.
- Anyone who has used the product before this session, including prior study rounds.
- Anyone reporting to, or living with, a project contributor.

Exclusion is self-declared on the screener and confirmed verbally at session start.
A participant who discloses exclusion mid-session is stopped and struck from the
denominator, and the slot is refilled.

### Composition

Minimum **n = 10** completed sessions. The gate is `unaided completions / completed
sessions >= 0.90`; with n = 10 exactly one failure is tolerable, so recruit 12 to absorb
strikes without falling below 10.

Required spread across the cohort:

| Dimension | Requirement |
| --- | --- |
| Client | ≥ 3 mobile (iOS Safari and Android Chrome both present), ≥ 5 desktop |
| Viewport stage | ≥ 3 at 390px, ≥ 2 at 768–1279px, ≥ 4 at ≥ 1280px |
| Browser engine | ≥ 2 non-Chromium (Firefox, Safari, or iOS Safari) |
| Stream branch | ≥ 3 on Chromium desktop, so the capture branch of Step 3 is exercised |
| Streaming role | ≥ 4 who host/produce, ≥ 4 who only watch |
| Prior Discord-adjacent tools | ≤ 60% heavy power users |

Step 3 branches on **capture capability, not device**. Stream creation is
Chromium-family desktop only (ADR 0014), so Chromium-desktop participants take the
capture branch and everyone else — mobile *and* non-Chromium desktop — takes the watch
branch. Asking a Firefox or Safari participant to share their screen would score a
documented product limit as a usability failure.

`scripts/usability-acceptance.mjs` enforces the n, client, engine, and viewport minima
in this table and reports `gate: "unproven"` for a cohort that misses any of them. A
small or lopsided cohort therefore cannot certify the criterion by accident.

## 2. Consent

Read verbatim, obtain a recorded verbal "yes", and log the timestamp. Do not proceed
without it.

> Thanks for helping test BhayanakCast. This session takes about 30 minutes. We are
> testing the product, not you — if something is confusing, that is a finding, not a
> mistake.
>
> You will sign in with your own Discord account. We will see your Discord display name
> and avatar because the product shows them. We will not ask for your password and we
> will never ask you to share your screen contents beyond this product.
>
> We record: which steps you complete, where you get stuck, what you say out loud, and
> screenshots of the product. We do **not** record or keep: your Discord password, any
> private-room password you type, the contents of your chat messages, or the video you
> share. Chat and shared video are noted only as "sent" or "not sent".
>
> Your results are stored under a participant code, not your name. You can stop at any
> time, skip any task, and ask us to delete your session afterwards. Do you consent to
> take part and be recorded on these terms?

Post-session, the facilitator deletes the participant's test Account via the in-product
deletion flow if the participant asks (ADR 0004).

### Data we must not capture

Aligned with the ADR 0028 sensitive-data boundary. The results file schema below has no
field that can hold any of these; do not add one in freeform notes either.

- Discord credentials, OAuth or session material.
- Private-room passwords or hashes.
- Chat message bodies.
- Shared screen/audio media, thumbnails, or report-snapshot bytes.
- Participant real name, email, or Discord handle in any retained artifact.

Screenshots taken during a session must be reviewed before retention and discarded if
they contain chat bodies or shared media frames. Redaction is not sufficient for chat
bodies — discard the shot and retake the state.

## 3. The journey

One journey, five steps, matching the ADR 0013 Decision bullet: "sign in; discover,
create, or join a room; start or watch a stream; chat; and leave". The facilitator gives
the prompt verbatim and then says nothing until the step ends.

| Step | Prompt | Success |
| --- | --- | --- |
| `sign_in` | "Get yourself signed in." | Reaches an authenticated state; header shows their own Discord identity. |
| `find_room` | "Find a room you'd want to be in, or make your own." | Enters a live room via `/` discovery, search, or create. Any of discover / create / join counts. |
| `stream_or_watch` | Chromium desktop: "Share something on your screen with the room." Everyone else: "Get the stream playing for yourself." | Capture branch: a Stream exists and is attributed to them. Watch branch: they explicitly start watching one Stream and see media or the documented compatibility path. |
| `chat` | "Say something to the room." | A message of theirs appears in the room chat. Body is not recorded. |
| `leave` | "You're done — get out of the room." | Leaves via a product control, confirming if prompted, and lands outside the room. |

Full journey = all five steps unaided, in order, in one session.

## 4. Unaided — the only definition that counts

A step is **unaided** when the participant reaches success using only:

- the verbatim prompt above,
- the product UI, and
- one neutral re-prompt (see below).

A step is **aided**, and therefore failed, the moment any of these occurs:

- The facilitator names a control, region, page, or term not in the prompt.
- The facilitator confirms or denies a participant's guess ("is it this one?" → aided).
- The facilitator answers a product question beyond "what would you do if I weren't here?".
- The participant asks to be shown and is shown.
- **240 seconds** elapse in the step without success.
- The participant states they are stuck and would give up in real life.
- A product defect blocks success (still a failure — see §6 attribution).

### The only permitted facilitator utterances

1. The verbatim step prompt.
2. Once per step, after ≥ 45s of silence: "What are you thinking?"
3. Once per step: "What would you do if I weren't here?" — this is the neutral
   re-prompt and does **not** make the step aided.
4. At step end: "On a scale of 1 to 5, how hard was that?"
5. Session control: "We can stop whenever you like."

Anything else is aid. If the facilitator slips, mark the step `aided` honestly. An
observer who is not the facilitator marks the step outcome, so the facilitator is not
grading their own slip.

### Roles

- **Facilitator** — reads prompts, runs the clock, says nothing else.
- **Observer** — records outcomes, timings, obstacle codes, screenshots. Does not speak.

A single person may not hold both roles. Sessions with only a facilitator are struck.

## 5. Session procedure

1. Screen and schedule. Confirm client, browser, and viewport stage; record them.
2. Assign participant code `P##`. Never write the real identity into study artifacts.
3. Start recording. Read the consent script. Log consent timestamp.
4. Open a fresh browser profile at the study origin, signed out, at `/`.
   - Watch-branch sessions need something to watch. Before the participant arrives, a
     confederate Host on a Chromium desktop opens a public room and starts a Stream, and
     keeps it running for the session. This setup is the study's, not the participant's,
     and is never scored.
5. Run the five steps in order. Observer starts a stopwatch per step.
6. After each step: difficulty rating 1–5, then move on. A failed step does **not** end
   the session — set the participant up at the next step's starting state manually
   (this setup is not scored) and continue, so later steps still yield data.
7. Post-session: three open questions — what was confusing, what was missing, would you
   come back. Free-text, no product content.
8. Offer Account deletion. Stop recording. Write the result row.
9. Discard the recording within 7 days; the result row and screenshots are the retained
   evidence.

## 6. Failure categorization

Every failed step gets exactly one obstacle code plus the step, viewport stage, and
client. Codes:

| Code | Meaning |
| --- | --- |
| `not_found` | Could not locate the control or entry point. |
| `wrong_mental_model` | Found a control but expected different behavior from it. |
| `blocked_by_permission` | Stopped by an OS/browser permission prompt they could not resolve. |
| `blocked_by_defect` | Product bug or error state prevented success. |
| `blocked_by_latency` | Correct action taken; the product did not respond in time. |
| `abandoned` | Gave up or timed out with no single identifiable obstacle. |
| `aided` | Facilitator supplied information beyond the permitted utterances. |

`blocked_by_defect` still counts against the gate. A defect that only a study
participant hits is still a usability failure at launch; fix it and re-run, do not
discount it.

Attribution recorded per failure: `step`, `viewport_stage`, `client`, `obstacle`, and a
one-sentence observation with no product content.

## 7. Result capture

Each session appends one object to a results file — see
`docs/operations/usability-results.template.json` for the shape and a worked example.

Acceptance is computed, never estimated:

```
node scripts/usability-acceptance.mjs <results-file.json>
```

The script validates every row before it computes anything, then prints the rate, the
cohort shortfalls, and the failure breakdown by step, viewport stage, client, and
obstacle. It exits non-zero unless the gate is `met`. Its output is the acceptance
evidence — do not hand-calculate the rate into the ticket.

Three gate values, and only one of them clears the criterion:

| Gate | Meaning |
| --- | --- |
| `met` | The cohort satisfies §1 and the rate is `>= 0.90`. |
| `failed` | The cohort satisfies §1 and the rate is below `0.90`. |
| `unproven` | The cohort does not satisfy §1, so the rate means nothing yet. |

Denominator = sessions that are neither `struck: true` nor `dry_run: true`. Numerator =
those sessions where all five steps are `pass`. A struck session must carry a
`strike_reason`; because a mid-session strike stops the journey, struck rows are exempt
from the five-step requirement.

Every row must carry `consent_at`, a `facilitator`, and a different `observer`; every
step must carry a 1–5 `difficulty`; every failed step must carry an `obstacle` and a
one-sentence `observation`. A `pass` past 240 seconds, or a `pass` carrying an obstacle,
is rejected rather than counted — §4 already classifies both as failures.

## 8. Dry run

Before recruiting, run one internal dry run end to end: full session procedure, both
roles staffed, real timings, real screenshots, real result row, real acceptance
computation. A dry run proves the protocol and the capture pipeline; it is recorded with
`dry_run: true` and is **never** counted in the qualifying denominator.

The dry run must surface, and the team must fix, at least the following before
recruitment: an ambiguous prompt, a missing starting state, a capture field that cannot
be filled without recording prohibited content, or a stopwatch/observer workflow that
cannot keep up. If the dry run surfaces none of these, run it again with a second
internal participant before concluding the protocol is clean.

## 9. Evidence package

Retained for the ticket:

- This protocol at the commit used for the study.
- Build identifier (commit SHA) and study origin.
- `usability-results.json` with one row per session.
- `scripts/usability-acceptance.mjs` output, verbatim.
- Screenshots per failed step, reviewed for prohibited content.
- Dry-run row and its acceptance output.

## 10. Gate

The criterion is met only when the computed rate over a cohort satisfying §1 is
`>= 0.90`. Anything below that is recorded as a **failed gate** with the computed rate
and the failure breakdown. It is not relabeled a partial pass, a soft launch, or a
follow-up. Re-running requires a fresh cohort under §1 exclusions; participants from a
failed round are no longer unaided-eligible.
