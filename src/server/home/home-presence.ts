import { operatorDay } from '../../features/home/operator-day'
export class HomePresence {
  private readonly socketsByAccount = new Map<string, Set<string>>()
  private readonly peakByDay = new Map<string, number>()

  add(accountId: string, socketId: string, instant = new Date()) {
    const sockets = this.socketsByAccount.get(accountId) ?? new Set<string>()
    sockets.add(socketId)
    this.socketsByAccount.set(accountId, sockets)
    this.recordPeak(instant)
  }

  remove(accountId: string, socketId: string, instant = new Date()) {
    this.recordPeak(instant)
    const sockets = this.socketsByAccount.get(accountId)
    if (!sockets) return
    sockets.delete(socketId)
    if (sockets.size === 0) this.socketsByAccount.delete(accountId)
  }

  count() {
    return this.socketsByAccount.size
  }

  peak(day: string, instant = new Date()) {
    const stored = this.peakByDay.get(day) ?? 0
    return day === operatorDay(instant) ? Math.max(stored, this.count()) : stored
  }

  private recordPeak(instant: Date) {
    const day = operatorDay(instant)
    this.peakByDay.set(day, Math.max(this.peakByDay.get(day) ?? 0, this.count()))
  }
}

const HOME_PRESENCE_KEY = Symbol.for('bhayanakcast.home-presence')
const shared = globalThis as typeof globalThis & {
  [HOME_PRESENCE_KEY]?: HomePresence
}

export const homePresence = (shared[HOME_PRESENCE_KEY] ??= new HomePresence())
