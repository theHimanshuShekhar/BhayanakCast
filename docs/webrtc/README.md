# WebRTC Screen Sharing Implementation Plan

This directory contains a comprehensive plan for implementing screen sharing with WebRTC in BhayanakCast, with support for audio configuration and graceful handling during streamer transfers.

## Key Design Principles

1. **Screen Sharing is MVP** - Primary focus on `getDisplayMedia()`, not camera
2. **Optional/Configurable Audio** - Streamer controls audio sources (system + mic, mic only, or none)
3. **Immediate Stop Detection** - Browser's "Stop sharing" button ends stream instantly
4. **Realistic Timing** - 8-15 second total transfer time is acceptable
5. **Auto Quality** - Adaptive bitrate, no manual quality selection needed
6. **Explicit Opt-in** - New streamer must click "Start Streaming" button

## Documents

### Core Implementation

1. **[01-overview-and-sequence.md](./01-overview-and-sequence.md)**
   - Screen sharing architecture overview
   - 5-phase timing sequence (T+0ms to T+15000ms)
   - State management with audio configuration
   - Stop sharing detection flow

2. **[02-events-and-cleanup.md](./02-events-and-cleanup.md)**
   - Socket.io event definitions with audio config support
   - Screen sharing ended detection (`onended` event)
   - Enhanced cleanup logic for screen tracks
   - Audio state management

3. **[03-streamer-and-viewer-logic.md](./03-streamer-and-viewer-logic.md)**
   - `startScreenShare(audioConfig)` implementation
   - Display surface selection (monitor, window, tab)
   - Screen-specific RTC configuration (resolution, frame rate)
   - Audio track mixing (system audio + microphone)

### Server & Integration

4. **[04-server-handlers.md](./04-server-handlers.md)**
   - `webrtc:screen_share_ended` event handling
   - Audio configuration state tracking
   - Transfer with screen sharing context
   - ICE restart coordination (both sides)

5. **[05-ui-and-error-handling.md](./05-ui-and-error-handling.md)**
   - Audio configuration modal
   - Screen sharing preview component
   - Stop sharing overlay handling
   - Audio toggle controls during stream

### Edge Cases & Testing

6. **[06-edge-cases.md](./06-edge-cases.md)**
   - User stops sharing via browser UI during transfer
   - Audio permission separate from screen permission
   - Multiple monitors/display surfaces
   - Screen sharing blocked by browser policy
   - Mobile limitations

7. **[07-implementation-checklist.md](./07-implementation-checklist.md)**
   - Screen sharing focused implementation phases
   - Updated timing constants (8-15s transfer)
   - Audio configuration tasks
   - Testing scenarios for screen sharing

## Quick Start

To implement this plan:

1. **Phase 1** - Create the `useScreenShare` hook with audio configuration
2. **Phase 2** - Add server-side screen sharing event handlers
3. **Phase 3** - Build audio configuration UI and screen preview
4. **Phase 4** - Add stop sharing detection and error handling
5. **Phase 5** - Test screen sharing edge cases

## Key Design Decisions

- **Screen sharing first**: All implementation optimized for `getDisplayMedia()`
- **Configurable audio**: Three audio modes (system+mic, mic-only, none)
- **Stop sharing detection**: Critical UX - listen for `track.onended`
- **Realistic timing**: 8-15 seconds acceptable for screen sharing setup
- **Auto quality**: Simulcast enabled, adaptive bitrate, no manual selection
- **Explicit streaming**: New streamer must click button to start

## Audio Configuration Modes

```typescript
type AudioMode = 
  | 'system-and-mic'    // Share system audio + microphone
  | 'microphone-only'   // Voice only, no system audio
  | 'silent';           // No audio at all
```

## Architecture Integration

This plan integrates with existing BhayanakCast:
- Uses existing Socket.io infrastructure
- Leverages current room management
- Maintains compatibility with auth and rate limiting
- No database schema changes required

## Mobile Considerations

Mobile screen sharing is limited (iOS Safari doesn't support it). Plan includes notes for future camera fallback implementation.

## External References

- [Screen Capture API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API)
- [getDisplayMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- [WebRTC Simulcast](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/setParameters)
