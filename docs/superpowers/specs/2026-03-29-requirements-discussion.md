# BhayanakCast — Requirements Discussion Transcript
**Date:** 2026-03-29

---

## Transcript

**Q1 — Core audience**
> Who are the primary users of BhayanakCast?

**A:** Small friend groups / private circles (Discord communities doing movie nights).

---

**Q2 — Room access model**
> How should room access work?

**A:** Both — rooms are public by default (anyone with link can join), but can be locked/password-protected.

---

**Q3 — Social graph**
> Friend/follow system?

**A:** None — keep it connectionless. Rooms are ephemeral, social coordination happens outside the app (Discord etc.).

---

**Q4 — Discovery**
> How do people find rooms?

**A:** Public room browser is first-class — home page shows all active rooms with search. Direct link join also works.

---

**Q5 — Room identity**
> Are rooms permanent channels or ephemeral sessions?

**A:** Ephemeral — created fresh each time, live while the stream is active, then gone.

---

**Q6 — Streamer model**
> One streamer, co-streaming, or queue?

**A:** One streamer at a time, transferable.

---

**Q7 — Viewer experience**
> What can viewers do beyond watch + chat?

**A:** Watch + chat is the full experience for now. May add more later.

---

**Q8 — Authentication**
> Discord only or open it up?

**A:** Discord only. BhayanakCast is specifically built to replace Discord's streaming for movie nights (Discord caps free tier at 720p).

---

**Q9 — Stream quality**
> Quality targets?

**A:** Always push for maximum quality — no user-facing quality controls, just best effort.

---

**Q10 — Room size**
> How many people typically?

**A:** Usually 2–5, but can be up to 10–12 people.

---

**Q11 — Notifications**
> In-app notifications needed?

**A:** No — coordination happens in Discord first, then people jump to the link.

---

**Q12 — User profiles**
> How important is identity within BhayanakCast?

**A:** Not important — show Discord name/avatar as-is. No customization needed.

---

**Q13 — Room creation**
> Who can create rooms, any restrictions?

**A:** One active room per user at a time. If you join another room you automatically leave the old one. Applies whether you are a streamer or a viewer.

---

**Q14 — Room listing**
> What info shown per room and how sorted?

**A:** Rich cards — room name, streamer name/avatar, viewer count, how long it's been live, sorted by viewer count. Plus a live thumbnail from the stream taken every 5 minutes.

---

**Q15 — Chat**
> Any gaps in current chat?

**A:** Good enough for now — no changes needed.

---

**Q16 — Mobile**
> Mobile priority?

**A:** Secondary platform. UI should be nice and responsive on all screen sizes (desktop-first, mobile a decent second). Mobile users cannot stream.

---

**Q17 — Top priority feature**
> If you could only ship one thing, what would it be?

**A:** Streaming should be the most important feature to work robustly without any errors. Room management and streamer auto-transfer logic are also top priority.

---

**Q18 — Known streaming pain points**
> Specific failure modes to address?

**A:** All of the above:
- Viewers getting stuck on "connecting" and never seeing the stream
- Stream dropping mid-session and not recovering automatically
- Streamer transfer breaking (new streamer can't get viewers to reconnect)

---

**Q19 — Error recovery expectation**
> When something goes wrong?

**A:** Auto-recover silently — retry in the background, show a subtle spinner, user shouldn't need to do anything.

---

**Q20 — Success criteria**
> How would you know BhayanakCast is "done enough"?

**A:**
- Room management is perfect
- Participant leaving and joining is handled perfectly and instantly
- Streamer-to-viewer P2P stream works perfectly, connection set up quickly and reliably
- Streamer transfer (both automatic when streamer leaves, and manual transfer) works perfectly
- Room state changes are perfectly managed

---

## Requirements Summary

### Product Identity
- **What it is:** A P2P screen-sharing app to replace Discord streaming for movie nights
- **Core pain point solved:** Discord free tier caps at 720p; BhayanakCast removes that limit
- **Target users:** Small Discord friend groups (2–12 people)

### Non-Features (explicitly cut)
- Social graph (friends/follows) — coordination happens in Discord
- In-app notifications — people get notified via Discord
- User profile customization — Discord name/avatar is sufficient
- Multiple simultaneous streamers — one at a time only
- Viewer interactivity beyond chat (reactions, polls) — for now
- Quality controls — always best effort

### Must-Have Features
1. **Streaming reliability** — silent auto-recovery, no user action required
2. **Room management** — perfect state transitions, instant join/leave
3. **Streamer transfer** — both auto (on leave) and manual, must be seamless
4. **Public room browser** — home page, sorted by viewer count, with search
5. **Rich room cards** — streamer name/avatar, viewer count, live duration, thumbnail (every 5 min)
6. **Room access control** — public by default, lockable
7. **One room per user** — auto-leave on join elsewhere

### Quality Bar
- P2P connection established quickly and reliably
- Streamer transfer (auto + manual) works every time
- Room state (waiting → preparing → active → ended) transitions are always correct
- Responsive UI, desktop-first, mobile works well

### Architecture Constraints (carry forward)
- Discord OAuth only
- PeerJS for WebRTC (keep using PeerJS cloud server)
- One streamer at a time
- Mobile can view, cannot stream
- Ephemeral rooms (die after 5 min empty)
- Room size up to ~12 — P2P is viable, no SFU needed yet

---

## Addendum — User Profiles & Watch Buddy Stats
**Date:** 2026-03-29

**Q21 — Profile page**
> Does the watch buddy feature require a profile page?

**A:** Yes — add a read-only user profile page showing Discord details + stats. Users cannot edit anything directly.

---

**Q22 — Visibility**
> Who can see a profile page?

**A:** Fully public — click any username anywhere in the app to see their profile.

---

**Q23 — "Time together" definition**
> When does the shared-time clock run?

**A:** Any time both users are present in the same room simultaneously, regardless of whether a stream is active.

---

**Q24 — Ranking scope**
> All-time or recent?

**A:** Both — all-time ranking AND a rolling 30-day ranking shown on the profile.

---

**Q25 — Privacy / opt-out**
> Can users opt out of appearing on others' lists?

**A:** No opt-out needed — shared room time is non-sensitive.

---

**Q26 — Stats beyond watch buddies**
> What other stats to show?

**A:** Full rich stats suite:
- Total hours watched (as viewer)
- Total hours streamed (as streamer)
- Total rooms joined
- Longest single session
- Current watch streak (consecutive days with activity)
- Favourite time of day/week to watch
- First seen / member since date
- Total unique watch buddies ever

---

**Q27 — Minimum shared time threshold**
> Minimum time to appear on watch buddy list?

**A:** 5 minutes — filters out drive-by joins.

---

### Profile Feature Summary

**Profile page:** Read-only, publicly accessible by clicking any username. Shows:
- Discord avatar, name, member-since date
- **Watch buddy lists:** Top 5 by shared room time — all-time + last 30 days
- **Stats:** total hours watched, total hours streamed, rooms joined, longest session, watch streak, favourite watch time, total unique buddies
- Minimum 5 minutes shared time to appear on buddy list
- No privacy controls / opt-out — data is non-sensitive
- No profile editing — Discord identity is the source of truth
