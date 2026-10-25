# Relaying a lossy pair through Cloudflare TURN: does it help, how to switch, what it costs

Research for #92 (map #89, "Fix blurry streams for some viewers"). Sources were read on 2026-10-11. Claims without a primary source are marked **UNVERIFIED**, and our own inferences are marked **(inference)**.

## Answer in brief

- **When it helps.** Relaying can fix loss and long round trips that come from the **path between two ISPs**, but not from a viewer's **own last hop** (Wi-Fi, access link). Skype's data shows inter-AS calls are 2–3× more likely to have poor network performance than intra-AS calls. Choosing the best relay per call cut poor-network incidence by 45% (oracle: up to 53%). The same paper says "in cases of a poor last-hop network, no relaying strategy can help". Cloudflare's own claim is narrower: the gain comes "if both ends of a connection are using Cloudflare Realtime TURN", and is mostly in "reliability and packet loss behavior, not raw latency".
- **Telling the two apart.** A client can't see which link is at fault directly, but the mesh gives it a natural comparison. Loss and round trip on **all** of a viewer's inbound pairs (different streamers, different paths) point to the viewer's last mile. Loss on **one** pair while the viewer's other pairs are clean points to that path. This heuristic is ours (**UNVERIFIED** as a published method). It needs a trial switch that is reverted if the relay doesn't measure better.
- **Switching.** Native WebRTC can move one existing `RTCPeerConnection` to relay and back: `setConfiguration({...getConfiguration(), iceTransportPolicy: 'relay'})` plus an ICE restart (`restartIce()`). Both peers must do it to get relay on both ends. Media keeps flowing on the old pair until the new one is selected, and the DTLS session continues, so there is no new handshake and no keyframe by design. This works in Chromium and Firefox 99+.
- **Cost.** Cloudflare bills only egress from its edge to a TURN client, so each direction of media is billed at most once, at the receiving end. One relayed screen share costs **0.68–2.7 GB per viewer-hour** (720p30–1080p60), or about 0.8–3.0 GB with share audio and overhead. The 1,000 GB/month free tier (shared with the SFU) covers about **740 relayed stream-hours at 1080p30**. Beyond it, the cost is **$0.034–$0.15 per relayed stream-hour**.

## Where we start (code and ADRs)

- ADR 3 and `src/lib/ice.ts` / `src/server/ice.ts`: the page gets STUN plus Cloudflare TURN credentials. A pair uses a relay only when ICE picks one, which in practice means P2P failed. `isRelayed` reads the selected candidate pair from `getStats()`.
- `src/lib/mesh.ts`: on `failed` (or the connect timeout) a negotiated pair gets **one** `restartIce()`. `#configure` already calls `setConfiguration({...getConfiguration(), iceServers})` before a restart and on each credential refresh. `onnegotiationneeded` sends an offer.
- `iceTransportPolicy` is never set, so it is always `"all"`.

## 1. When relaying improves a lossy or high-RTT path, and when it can't

### Evidence that relaying helps WAN-path problems

**Via (Microsoft/Skype, SIGCOMM 2016)**, "a data set of 430 million calls from Skype, with clients across 1900 ASes and 126 countries". PDF: https://www.microsoft.com/en-us/research/wp-content/uploads/2016/08/via.pdf

- Poor-network thresholds: "RTT ≥ 320ms, loss rate ≥ 1.2%, jitter ≥ 12ms". Over 15% of calls on default routes cross at least one of them (§2.2).
- "calls across ASes are 2−3× more likely to experience poor network performance than those within the same AS domain" (§2.3). International calls are worse still, which "points to the WAN path as the culprit".
- Possible gains: "an oracle-based overlay can potentially improve up to 53% of calls whose quality is impacted by poor network performance". The oracle "can help reduce RTT, loss and jitter by 30%-60% at median" (§3.2).
- Real gains: "VIA cuts the incidence of poor network conditions for calls by 45% (and for some countries and ASes by over 80%)" (abstract).
- The benefit depends on *choosing* among many relays and on changing that choice over time. "The optimal relaying options for 30% of AS pairs last for less than 2 days" (Fig. 9). Via compares the direct path against "bouncing" (one relay) and "transit" (two relays over the private backbone) and picks per pair. A relay is not always better than the default path.
- The MSR publication page's abstract quotes different figures (83%, 66%). The numbers above are from the paper PDF.

**Cloudflare Realtime TURN FAQ.** https://developers.cloudflare.com/realtime/turn/faq/

- "Cloudflare Realtime TURN allocations are homed in the nearest available Cloudflare data center to the TURN client via anycast routing. If both ends of a connection are using Cloudflare Realtime TURN, Cloudflare will be able to control the routing and, if possible, route TURN packets through the Cloudflare backbone."
- "When only one peer uses TURN, the other leg traverses the public Internet, and latency and packet loss depend on the interconnect between that peer and the nearest Cloudflare data center."
- "The more consistent improvement from using TURN on both ends is reliability and packet loss behavior, not raw latency. Backbone latency is typically better than the public Internet, but the size of the latency improvement varies by geography. The reduction in packet loss is generally more predictable."
- Cloudflare's 2024 launch blog (https://blog.cloudflare.com/cloudflare-calls-anycast-webrtc): "about 95% of the Internet connected population is within 50ms of a Cloudflare data center".
- **UNVERIFIED:** any published Cloudflare measurement of TURN against direct-path loss. Cloudflare's docs state the claim but give no numbers. Nothing ties TURN to Argo.

What this means for us **(inference)**:

- Cloudflare TURN is a single anycast choice, Via's "transit" option with no relay selection. It can fix a bad ISP-to-ISP route on either side of Cloudflare's network, because each peer then only crosses its own ISP to its nearest Cloudflare data center. It is not guaranteed to beat the direct path.
- Relay on one side only (Via's "bouncing") keeps one public-Internet leg and gains less.
- **UNVERIFIED:** how common bad inter-ISP paths are for our users (Indian residential ISPs). Nothing in production records it today (map #89 Notes).

### When relaying can't help

- Via §2.2: "This work focuses on improving the performance of the WAN path, rather than the last-hop link (e.g., wireless)… However, in cases of a poor last-hop network, no relaying strategy can help improve call quality."
- Home Wi-Fi is a common last-hop bottleneck at the speeds ADR 2 assumes. Sundaresan, Feamster and Teixeira (PAM 2016, 2,652 US homes): "wireless bottlenecks are more common than access-link bottlenecks—particularly for home networks with downstream throughput greater than 20 Mbps, where access-link bottlenecks are relatively rare" (https://link.springer.com/chapter/10.1007/978-3-319-30505-9_9; abstract read via search, full text not read). How this applies to Indian homes is **UNVERIFIED**.
- A relay adds a hop. Every packet still crosses the viewer's own Wi-Fi and access link, so loss or bufferbloat there is unchanged. RTT may also grow by the detour to the nearest data center **(inference)**.
- A viewer whose **download** is too small for 3 shares (the ADR 2 floor) gains nothing from a relay. That is a rung/budget problem (#91), not a path problem **(inference)**.
- TURN's own limits are far above one stream: per allocation ">50-100 Mbps" and ">5-10 kpps", and "Hitting these limits will result in packet drops" (https://developers.cloudflare.com/realtime/turn/). One 6 Mbps share is about 625 packets/s at ~1,200 B **(inference)**.

### Telling the two apart from `getStats()`

These are the webrtc-stats fields (https://w3c.github.io/webrtc-stats/) that a client can read per pair.

- `candidate-pair.currentRoundTripTime`: "the latest round trip time measured in seconds, computed from both STUN connectivity checks… including those that are sent for consent verification". This is the path RTT, independent of media.
- `candidate-pair.availableIncomingBitrate` / `availableOutgoingBitrate`: the congestion controller's estimate for the pair.
- `remote-inbound-rtp.fractionLost` (sender side) and `roundTripTime` (from RTCP RR).
- `inbound-rtp.packetsLost`, `jitter`, `nackCount`, `pliCount`, `retransmittedPacketsReceived`, and `freezeCount` ("a freeze if frame duration … equals or exceeds Max(3 * avg_frame_duration_ms, avg_frame_duration_ms + 150)").
- **Not usable:** `networkType` (Wi-Fi vs. wired) "was deprecated for preserving privacy" (webrtc-stats status section). Whether Chromium still exposes it to pages is **UNVERIFIED**, so we can't rely on it.

The heuristic below is ours: **UNVERIFIED**, not a published method, but it fits Via's last-hop/WAN split.

| What the stats show | Most likely cause | Does relay help? |
|---|---|---|
| A viewer's inbound loss/RTT is bad on **every** pair (from different streamers) | Viewer's own Wi-Fi or access link | No |
| A streamer's outbound loss is bad on every pair | Streamer's uplink (ADR 2 `UplinkBudget` "strain") | No |
| Loss/RTT is bad on **one** pair, and both peers are clean on their other pairs | The path between those two ISPs | Possibly |

- With only two people in a room there is no comparison, so the heuristic can't decide **(inference)**.
- The only conclusive test is to try it: switch the pair to relay, compare loss and RTT over a window against the direct baseline, and revert if it isn't clearly better. That is a cut-down version of Via's "exploration-exploitation".
- Remember the result per pair for a while. Via found the best option is stable for days on most AS pairs (Fig. 9).
- **UNVERIFIED:** whether libwebrtc keeps measuring RTT on the unselected relay pairs after nomination, which would allow a cheap probe before switching. That depends on its pruning and ping behaviour, which I didn't check.

## 2. Switching one existing connection to relay mid-session, and back

### The spec says it is supported

**W3C webrtc-pc, "set the configuration".** https://w3c.github.io/webrtc-pc/

- "Set the ICE Agent's ICE transports setting to the value of configuration.iceTransportPolicy. As defined in [RFC9429], if the new ICE transports setting changes the existing setting, no action will be taken until the next gathering phase. If a script wants this to happen immediately, it should do an ICE restart."
- `certificates`, `bundlePolicy` and `rtcpMuxPolicy` may not change. `iceCandidatePoolSize` can't change after `setLocalDescription`. `iceTransportPolicy` and `iceServers` *may* change.
- `relay`: "The ICE Agent uses only media relay candidates such as candidates passing through a TURN server."

**RFC 9429 (JSEP) §3.5.3.** https://www.rfc-editor.org/rfc/rfc9429.txt

- "the JSEP implementation MUST allow the candidate policy to be changed in mid-session".
- "the application can apply it by kicking off a new gathering phase via an ICE restart".
- §4.1.18: "If an ICE gathering phase has already started or completed, the 'needs-ice-restart' bit will be set."

**`restartIce()` (webrtc-pc).** It empties and refills `[[LocalIceCredentialsToReplace]]` with the current ICE credentials, then runs "Update the negotiation-needed flag". The next `createOffer` restarts ICE with a new ufrag and password.

### The switch, step by step **(inference from the above)**

1. Decide on the switch at the pair level, and tell the peer over signalling.
2. **Both** sides call `pc.setConfiguration({...pc.getConfiguration(), iceServers, iceTransportPolicy: 'relay'})`. This gives the relay–relay pair that Cloudflare's backbone claim needs. A policy set on one side only filters that side's own local candidates, so the remote side could still reach this side's relay from its direct address.
3. The offering side calls `restartIce()`, and `negotiationneeded` then leads to the restart offer, as `src/lib/mesh.ts` already does.
4. Check `getStats()` for a selected pair with `candidateType: 'relay'` on both ends. `isRelayed` already reads this.

Two Mesh details matter:

- `#configure` spreads `getConfiguration()`, so a relay policy would survive credential refreshes.
- The Mesh's one-automatic-restart guard (`link.restarted`) and its `failed` handling would need to tell a deliberate relay restart apart from a failure restart.

### What the switch disrupts

- **No media gap by design.** RFC 8445 §9: "during the restart, data can continue to be sent using existing data sessions" (https://www.rfc-editor.org/rfc/rfc8445.txt). libwebrtc `p2p_transport_channel.cc`: "Any selected connection is kept so that it can be used to send data during ICE restart per RFC 8445."
- If the relay checks never succeed, the pair simply stays on the old path. The app needs its own timeout and its own record of the outcome.
- **No new DTLS handshake.** JSEP §5.11: "If an ICE restart is performed without a change in the tls-id value or fingerprint… the same DTLS connection is continued over the new ICE channel."
- **No forced keyframe.** In libwebrtc the route-change path (`RtpTransportControllerSend::OnNetworkRouteChanged`) never touches the encoder (https://webrtc.googlesource.com/src/+/refs/heads/main/call/rtp_transport_controller_send.cc).
  - Keyframes come from `GenerateKeyFrame`, stream startup, or the receiver's PLI/FIR (video_send_stream_impl.cc).
  - Packets lost at the switch are repaired by NACK/RTX, or by a PLI-driven keyframe if a frame can't be completed **(inference)**.
  - **UNVERIFIED:** that no other libwebrtc path asks for a keyframe on a route change (`video_stream_encoder.cc` wasn't read in full).
- **Congestion control.** The same function restarts the bandwidth estimate only when `IsRelevantRouteChange` sees a change in `connected` or in the local/remote `network_id`. With field trial `WebRTC-Bwe-ResetOnAdapterIdChange`, it compares `adapter_id` instead.
  - The route endpoint does record `uses_turn` (p2p_transport_channel.cc `CreateRouteEndpointFromCandidate`), but `IsRelevantRouteChange` doesn't compare it.
  - So a switch from host/srflx to relay over the **same local interface** probably keeps the existing estimate instead of starting over **(inference)**. Packet overhead is updated (`pacer_.SetTransportOverhead`).
  - **UNVERIFIED:** that the remote `network_id` stays the same between the remote peer's direct and relay candidates.
  - Either way, the ADR 2 controller should ignore its first samples after a switch, as it already does for a new sender.

### Going back to direct

- Call `setConfiguration({...getConfiguration(), iceTransportPolicy: 'all'})` and restart ICE again.
- ICE then prefers direct paths **by candidate priority, not quality**. RFC 8445 §5.1.2.2: "The RECOMMENDED values for type preferences are 126 for host candidates, 110 for peer-reflexive candidates, 100 for server-reflexive candidates, and 0 for relayed candidates."
- So with `'all'`, ICE returns to the lossy direct path whenever its checks succeed. A "keep this pair on relay" decision has to be held by the app, with a hold time, and re-tested occasionally.
- **UNVERIFIED:** whether libwebrtc's ICE controller ever weighs measured RTT when choosing between writable pairs. Its `CompareConnections` code wasn't read in full.

### Chromium vs. Firefox (and Safari)

- **Chromium.** In `PeerConnection::SetConfiguration` (https://webrtc.googlesource.com/src/+/refs/heads/main/pc/peer_connection.cc), `needs_ice_restart` is `modified_config.servers != configuration_.servers || NeedIceRestart(...)` on a transport-type change. It then calls `transport_controller_->SetNeedsIceRestartFlag()` and `sdp_handler_->UpdateNegotiationNeeded()`.
  - So in Chromium, a policy change alone already fires `negotiationneeded` and makes the next offer an ICE restart. `restartIce()` is redundant there but harmless.
  - `restartIce()` arrived in Chrome 77; `setConfiguration` dates from Chrome 48 (MDN browser-compat-data).
- **Firefox.**
  - `setConfiguration` was implemented in bug 1253706, "Implement RTCPeerConnection.setConfiguration", RESOLVED FIXED for the 99 branch (2022-02-09): https://bugzilla.mozilla.org/show_bug.cgi?id=1253706. Per that bug, changes stay tentative until the ICE restart they need is finalized, and its WPT covers `iceTransportPolicy` switches between `all` and `relay`.
  - `restartIce()` arrived in Firefox 70 (browser-compat-data).
  - Bug 1295552, "no relay candidates after ice restarts", was fixed in Firefox 51.
  - Firefox does **not** start a restart on its own when the policy changes, so call `restartIce()` explicitly. Doing so in all browsers keeps one code path **(inference)**.
  - **UNVERIFIED:** end-to-end behaviour of a mid-session `all`→`relay`→`all` switch in current Firefox, beyond the WPT coverage the bug mentions.
- **Safari.** `setConfiguration` 11, `restartIce` 14.1 (browser-compat-data). Mid-session policy behaviour is **UNVERIFIED**.

### Alternatives (not recommended)

- **A second `RTCPeerConnection` with `iceTransportPolicy: 'relay'`, then `replaceTrack`.** This brings a new DTLS handshake, a new SDP exchange, and a new receive stream (new decoder, so a keyframe and a visible switch), plus two connections to manage at once **(inference)**.
- **Dropping non-relay candidates in signalling.** This only filters what the *remote* side learns. The local agent still checks its own host/srflx candidates, so it isn't a clean policy **(inference)**.

### Side finding: credential refresh restarts ICE

- In Chromium, `setConfiguration` with **different `servers`** sets `needs_ice_restart` and fires `negotiationneeded` (code above).
- The Mesh's `#configure` runs on every TURN credential refresh (about every 3.5 h, ADR 3), and `onnegotiationneeded` sends an offer. So **every pair probably restarts ICE at each credential refresh** in Chromium **(inference)**.
- This was not reproduced. It is harmless by the "no media gap" rules above, but it matters to anyone reading ICE logs or BWE resets.

## 3. Cost per relayed viewer-hour

### How Cloudflare bills

Sources: https://developers.cloudflare.com/realtime/turn/faq/ and https://developers.cloudflare.com/realtime/sfu/platform/pricing/

- "Cloudflare TURN pricing is based on the data sent from the Cloudflare edge to the TURN client, as described in RFC 8656 Figure 1. This means data sent from the TURN server to the TURN client and captures all data, including TURN overhead, following successful authentication."
- The FAQ diagram labels client→server **"Ingress (free)"**, server→client **"Egress (charged)"**, and server↔peer **"Not part of billing"**.
- "Pricing for Cloudflare Realtime TURN service is $0.05 per GB of data used."
- "There is a free tier of 1,000 GB before any charges start." From the pricing page: "The first 1,000 GB each month is free. SFU and TURN share this allowance; they do not have independent free tiers."
- The TURN overview page also says TURN is "available free of charge when used together with the Realtime SFU", which conflicts with the shared allowance above. That doesn't apply to us, since we use no SFU.
- **UNVERIFIED:**
  - The free tier is per account (implied by the single bill line item, not stated). ADR 3's dashboard addendum already assumes it.
  - Whether "GB" means 10^9 or 2^30 bytes. The docs only say "GB", and ADR 3 takes 10^9.

### What that means for a relayed pair **(inference from the billing rule; Cloudflare doesn't spell these cases out)**

- **Both ends relayed** (what the backbone claim needs): the streamer's media enters Cloudflare free (ingress) and is billed once as egress to the viewer. The viewer's return traffic is billed as egress to the streamer: RTCP, plus the viewer's own mic, camera or share if they have one on.
- **Only the streamer's side relayed:** by the diagram, the streamer→viewer media leg is "not part of billing". Only the viewer→streamer direction is billed.
- **Only the viewer's side relayed:** the streamer→viewer media is billed once.
- So **each direction is billed at most once, at the receiving end**, and both directions count. In this app the screen share's direction dominates. The return direction is small unless the viewer also has a camera (≈0.5 Mbps) or a share on.

### Per relayed stream at each rung (one share, one viewer)

- "Raw" uses the rung's `maxBitrate` (ADR 2 addendum) as a ceiling.
- "+audio, +8%" adds the 128 kbps share audio and about 8% for IP/UDP/RTP/SRTP/TURN headers and retransmissions. The 8% is our rough estimate (**UNVERIFIED**). Cloudflare bills "including TURN overhead".
- A still screen sends far below `maxBitrate`, so these are upper bounds.

| Rung | Mbps | GB/h raw | GB/h +audio,+8% | Hours in 1,000 GB (raw / +) | $/h after free tier (raw / +) |
|---|---|---|---|---|---|
| 720p30 | 1.5 | 0.68 | 0.79 | 1,481 / 1,264 | $0.034 / $0.040 |
| 900p30 | 2.2 | 0.99 | 1.13 | 1,010 / 884 | $0.050 / $0.057 |
| 1080p30 | 3.0 | 1.35 | 1.52 | 741 / 658 | $0.068 / $0.076 |
| 1080p45 | 4.5 | 2.03 | 2.25 | 494 / 445 | $0.101 / $0.112 |
| 1080p60 | 6.0 | 2.70 | 2.98 | 370 / 336 | $0.135 / $0.149 |

Scale:

- A viewer relayed for **all three** shares at 1080p30 uses about 4–4.6 GB/h.
- So the free tier covers roughly **220 such viewer-hours a month** (about 7 per day). After that it costs about $0.20–0.23 per viewer-hour.
- Pairs that relay today because P2P fails (CGNAT) draw on the same 1,000 GB. ADR 3's admin panel already shows account-wide TURN egress and warns at 800 GB.

## What would make this a decision (not researched here)

- The real-world session data (#89's telemetry tickets) showing whether affected viewers had pair-specific or viewer-wide loss. Only the former is relay-shaped.
- A per-pair policy: trigger (pair-specific loss for N samples), trial window, success criterion, hold time and revert, plus a monthly budget cap that disables trial switches near the free-tier limit.

## Sources

- Cloudflare Realtime TURN overview: https://developers.cloudflare.com/realtime/turn/
- Cloudflare Realtime TURN FAQ (updated 2026-07-14): https://developers.cloudflare.com/realtime/turn/faq/
- Cloudflare Realtime pricing: https://developers.cloudflare.com/realtime/sfu/platform/pricing/
- Cloudflare TURN analytics: https://developers.cloudflare.com/realtime/turn/analytics/
- Cloudflare Calls anycast blog (2024): https://blog.cloudflare.com/cloudflare-calls-anycast-webrtc
- W3C webrtc-pc (editor's draft): https://w3c.github.io/webrtc-pc/
- W3C webrtc-stats (editor's draft): https://w3c.github.io/webrtc-stats/
- RFC 8445 (ICE): https://www.rfc-editor.org/rfc/rfc8445.txt
- RFC 9429 (JSEP): https://www.rfc-editor.org/rfc/rfc9429.txt
- libwebrtc `call/rtp_transport_controller_send.cc`, `p2p/base/p2p_transport_channel.cc`, `pc/peer_connection.cc`, `video/video_send_stream_impl.cc` at https://webrtc.googlesource.com/src/+/refs/heads/main/
- Mozilla bug 1253706: https://bugzilla.mozilla.org/show_bug.cgi?id=1253706
- Mozilla bug 1295552: https://bugzilla.mozilla.org/show_bug.cgi?id=1295552
- MDN browser-compat-data `api/RTCPeerConnection.json`: https://github.com/mdn/browser-compat-data
- Sundaresan, Feamster, Teixeira, "Home Network or Access Link? Locating Last-Mile Downstream Throughput Bottlenecks", PAM 2016: https://link.springer.com/chapter/10.1007/978-3-319-30505-9_9
- Jiang et al., "Via: Improving Internet Telephony Call Quality Using Predictive Relay Selection", SIGCOMM 2016: https://www.microsoft.com/en-us/research/wp-content/uploads/2016/08/via.pdf
