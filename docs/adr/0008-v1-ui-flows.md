# V1 UI flows

BhayanakCast keeps the design document's central mosaic as the primary room interaction surface, but updates labels and controls to match the product model: rooms contain multiple member streams, not a single broadcast.

## Consequences

- Create Room requires name, freeform category, up to five freeform tags, visibility, and password when private. Room names are 3–80 characters; tags are at most 24 characters each.
- Private rooms remain publicly listed but show a lock badge and hide participant names/avatar stacks. Joining a private room opens a password modal with retry; failed password attempts do not enter the Socket.IO room.
- Room header shows member capacity, active stream count, public/private state, and current host. It must not use a single-room “broadcasting” model.
- The mosaic has three tile states: subscribed stream media, unsubscribed blurred stream preview, and compact non-streaming member tile.
- The primary Watch/Stop Watching control lives on the mosaic tile. The People tab mirrors live status and may provide secondary status/actions.
- A user's own active stream appears as a local preview tile and does not create a self-subscription.
- Streamer and current host can stop a stream from its tile controls.
- Reports are target-specific: stream tile menu, People/member menu, and chat message menu.
- Host room-ban management lives in a room settings modal, including clearing bans.
- Admin dashboard includes analytics plus operational moderation: report review, sanctions, ending live rooms, and lifting sanctions.
