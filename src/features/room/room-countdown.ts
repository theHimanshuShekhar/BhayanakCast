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

/** The visible label carries its own subject: an unlabeled duration sitting
    beside the member and Stream counts reads as a fourth statistic. */
export function roomCountdownLabel(
  expiresAt: Date,
  now: number = Date.now(),
  accessible = false,
): string {
  const minutesRemaining = Math.max(0, Math.ceil((expiresAt.getTime() - now) / 60_000))
  if (minutesRemaining === 0) return accessible ? 'Room is ending now' : 'Ending now'
  const hours = Math.floor(minutesRemaining / 60)
  const minutes = minutesRemaining % 60
  if (!accessible) {
    if (hours === 0) return `Ends in ${minutesRemaining}m`
    return minutes === 0 ? `Ends in ${hours}h` : `Ends in ${hours}h ${minutes}m`
  }
  const spoken: string[] = []
  if (hours > 0) spoken.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`)
  if (minutes > 0) spoken.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`)
  return `Room ends in ${spoken.join(' ')}`
}
