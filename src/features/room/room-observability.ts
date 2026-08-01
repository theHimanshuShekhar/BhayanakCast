import { captureRoomInteraction } from '../../server/rooms/room-observability'
import type { RoomAnalyticsEvent } from '../../server/observability/room-analytics'

const STORAGE_KEY = 'bhayanakcast.room-anonymous-id.v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
let memoryAnonymousId: string | undefined

export function observeRoom(event: RoomAnalyticsEvent): void {
  try {
    void captureRoomInteraction({
      data: { anonymousId: anonymousId(), event },
    }).catch(() => undefined)
  } catch {
    // Analytics is deliberately outside the Room interaction's control flow.
  }
}

function anonymousId() {
  if (memoryAnonymousId) return memoryAnonymousId
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && UUID.test(stored)) return (memoryAnonymousId = stored)
    const created = globalThis.crypto.randomUUID()
    window.localStorage.setItem(STORAGE_KEY, created)
    return (memoryAnonymousId = created)
  } catch {
    return (memoryAnonymousId = globalThis.crypto.randomUUID())
  }
}
