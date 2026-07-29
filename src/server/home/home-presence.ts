import { operatorDay } from '../../features/home/operator-day'

/** Home's "right now" number (ADR 0108). Accounts and anonymous visitors are
    counted the same way — one person is one entry however many tabs they hold
    — and `count()` blends the two, because the headline says "people", not
    "accounts". Anonymous entries key off a client-supplied visitor id, so the
    total is social proof rather than a metric a caller can trust. */
export class HomePresence {
  private readonly socketsByAccount = new Map<string, Set<string>>()
  private readonly socketsByVisitor = new Map<string, Set<string>>()
  private readonly peakByDay = new Map<string, number>()

  add(accountId: string, socketId: string, instant = new Date()) {
    this.attach(this.socketsByAccount, accountId, socketId, instant)
  }

  remove(accountId: string, socketId: string, instant = new Date()) {
    this.detach(this.socketsByAccount, accountId, socketId, instant)
  }

  addVisitor(visitorId: string, socketId: string, instant = new Date()) {
    this.attach(this.socketsByVisitor, visitorId, socketId, instant)
  }

  removeVisitor(visitorId: string, socketId: string, instant = new Date()) {
    this.detach(this.socketsByVisitor, visitorId, socketId, instant)
  }

  count() {
    return this.socketsByAccount.size + this.socketsByVisitor.size
  }

  peak(day: string, instant = new Date()) {
    const stored = this.peakByDay.get(day) ?? 0
    return day === operatorDay(instant) ? Math.max(stored, this.count()) : stored
  }

  private attach(
    sockets: Map<string, Set<string>>,
    key: string,
    socketId: string,
    instant: Date,
  ) {
    const held = sockets.get(key) ?? new Set<string>()
    held.add(socketId)
    sockets.set(key, held)
    this.recordPeak(instant)
  }

  private detach(
    sockets: Map<string, Set<string>>,
    key: string,
    socketId: string,
    instant: Date,
  ) {
    this.recordPeak(instant)
    const held = sockets.get(key)
    if (!held) return
    held.delete(socketId)
    if (held.size === 0) sockets.delete(key)
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
