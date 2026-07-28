/** Production bindings for the room's realtime services, mirroring
    `bindRoomService` in `features/home/create-room` — server functions resolve
    the live instance at call time rather than importing the pool directly. */

import type { ChatService } from './chat-service'
import type { StreamService } from '../streams/stream-service'
import type { SubscriptionService } from '../streams/subscription-service'
import type { RoomRealtimeEvent } from '../realtime/room-events'

interface RoomRuntime {
  streams?: StreamService
  subscriptions?: SubscriptionService
  chat?: ChatService
  publish?: (event: RoomRealtimeEvent) => void
}

const runtime: RoomRuntime = {}

export function bindRoomRealtimeRuntime(bindings: RoomRuntime) {
  Object.assign(runtime, bindings)
}

/** Live view of the bindings. Socket handlers resolve services per command so
    a socket server attached before `bindServerRuntime` still works. */
export function roomRealtime(): Readonly<RoomRuntime> {
  return runtime
}

export function getStreamService(): StreamService {
  if (!runtime.streams) throw new Error('Stream service is not configured')
  return runtime.streams
}

export function getSubscriptionService(): SubscriptionService {
  if (!runtime.subscriptions) throw new Error('Subscription service is not configured')
  return runtime.subscriptions
}

export function getChatService(): ChatService {
  if (!runtime.chat) throw new Error('Chat service is not configured')
  return runtime.chat
}

export function publishRoomEvent(event: RoomRealtimeEvent) {
  runtime.publish?.(event)
}
