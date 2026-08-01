export type RoomCountdownState = 'normal' | 'thirty-minute' | 'ten-minute' | 'one-minute'

export function roomCountdownState(
  expiresAt: Date,
  now: number = Date.now(),
): RoomCountdownState {
  const minutesRemaining = Math.max(0, Math.ceil((expiresAt.getTime() - now) / 60_000))
  if (minutesRemaining <= 1) return 'one-minute'
  if (minutesRemaining <= 10) return 'ten-minute'
  if (minutesRemaining <= 30) return 'thirty-minute'
  return 'normal'
}

export function roomCountdownLabel(
  expiresAt: Date,
  now: number = Date.now(),
  accessible = false,
): string {
  const minutesRemaining = Math.max(0, Math.ceil((expiresAt.getTime() - now) / 60_000))
  if (minutesRemaining === 0) return accessible ? 'Room is ending now' : 'Ending now'
  if (accessible) {
    return `Room expires in ${minutesRemaining} ${minutesRemaining === 1 ? 'minute' : 'minutes'}`
  }
  const hours = Math.floor(minutesRemaining / 60)
  const minutes = minutesRemaining % 60
  if (hours === 0) return `${minutesRemaining}m left`
  return minutes === 0 ? `${hours}h left` : `${hours}h ${minutes}m left`
}
