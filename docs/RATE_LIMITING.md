# Rate Limiting Configuration Guide

## Overview

This document explains the rate limiting strategy for BhayanakCast, including tuning rationale and operational guidelines.

## Philosophy

Our rate limiting follows these principles:

1. **Permissive for legitimate users** - Don't frustrate real users with overly strict limits
2. **Progressive penalties** - Escalate restrictions for repeat offenders
3. **Context-aware** - Different actions have different costs and risk profiles
4. **Clear communication** - Users always know when and why they're rate limited

## Rate Limit Tiers

### Critical (Strict Limits)
Operations that are expensive or security-sensitive

| Action | Limit | Window | Rationale |
|--------|-------|--------|-----------|
| `ROOM_CREATE` | 3 | 60s | Creates DB records, expensive operation |
| `STREAMER_TRANSFER` | 1 | 30s | Ownership changes should be deliberate |
| `AUTH_ATTEMPT` | 5 | 15min | Prevents brute force attacks |

### Moderate (Balanced Limits)
Normal user operations with abuse protection

| Action | Limit | Window | Rationale |
|--------|-------|--------|-----------|
| `CHAT_SEND` | 30 | 15s | ~120/min max, allows active chat |
| `CHAT_RAPID` | 5 | 3s | Prevents copy-paste spam |
| `ROOM_JOIN` | 10 | 60s | Allows browsing multiple rooms |
| `ROOM_LEAVE` | 5 | 60s | Less common than joins |

### Generous (Lenient Limits)
Read operations and connection handling

| Action | Limit | Window | Rationale |
|--------|-------|--------|-----------|
| `SEARCH` | 60 | 60s | Autocomplete + fast typing |
| `PROFILE_VIEW` | 120 | 60s | Profile browsing |
| `HOME_REFRESH` | 20 | 60s | Room list updates |
| `WS_CONNECTION` | 30 | 60s | Accounts for shared IPs |

## Implementation Details

### Sliding Window Algorithm
All rate limits use a sliding window that tracks timestamps:
- More accurate than fixed windows
- Prevents burst abuse at window boundaries
- Automatically expires old entries

### Per-User vs Per-IP
- **Per-user** (userId): Applied to authenticated actions
- **Per-IP**: Applied to connections and anonymous actions
- **Per-room**: Applied to room-specific actions (e.g., streamer transfer)

### Namespacing
Rate limits are namespaced by action to prevent cross-contamination:
```typescript
// These are completely independent
check("user1", { keyPrefix: "chat:send", ... })
check("user1", { keyPrefix: "room:join", ... })
```

## Error Messages

All rate limit violations return clear, actionable messages:

```typescript
// Client receives:
{
  message: "You're sending messages too quickly. Try again in 12 seconds.",
  retryAfter: 12
}
```

## Monitoring

Track these metrics to tune limits:

1. **Violation Rate**: % of requests that hit rate limits
   - Target: < 0.1% for legitimate users
   - If higher: limits may be too strict

2. **Repeat Offenders**: Users hitting limits frequently
   - May indicate abuse or UI issues

3. **False Positives**: Support tickets about rate limiting
   - Tune limits if legitimate users complain

## Tuning Guidelines

### When to Increase Limits
- Legitimate users complaining
- High violation rate (> 0.5%)
- New features causing unexpected traffic patterns

### When to Decrease Limits
- Detecting spam/abuse campaigns
- Server resources strained
- Bots bypassing current limits

### Emergency Response
For active abuse attacks:

1. **Immediate**: Lower limits via code deploy
2. **Short-term**: Implement IP-based blocking
3. **Long-term**: Consider CAPTCHA for suspicious patterns

## Future Enhancements

1. **Tiered Rate Limits**: Different limits for different user levels
   - New users: stricter
   - Verified users: more lenient
   - Premium: highest limits

2. **Adaptive Rate Limiting**: Adjust based on server load
   - High load: lower limits temporarily
   - Low load: higher limits

3. **Behavioral Detection**: ML-based abuse detection
   - Identify bot patterns
   - Reduce false positives

## Migration to Valkey

When moving to multi-server:

1. Update `RateLimiter.getInstance()` to use `ValkeyBackend`
2. All rate limits automatically become distributed
3. No code changes needed in consumers
4. Consider persistence for deny-lists

## Configuration Reference

See `src/lib/rate-limiter.ts` for:
- All rate limit definitions
- Backend implementations
- Usage patterns
