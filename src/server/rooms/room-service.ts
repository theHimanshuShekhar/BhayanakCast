import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import type Redis from 'ioredis'
import type { Pool, PoolClient } from 'pg'
import {
  consumePrivatePasswordLimit,
  consumeRoomCreationLimit,
} from '../rate-limits/room-limits'
import {
  EMPTY_GRACE_MS,
  endRoom,
  ROOM_LIFETIME_MS,
  roomEndDeadline,
} from './end-room'
import {
  normalizeRoomInput,
  ROOM_CAPACITY,
  type NormalizedRoomInput,
  type RoomInput,
  type RoomVisibility,
} from './room-policy'
import {
  type CurrentMembership,
  RoomRepository,
  type RoomRecord,
} from './room-repository'
import {
  selectRoomRouteProjection,
  type RoomRouteProjection,
} from './room-projection'
import type { RoomRosterMember } from './room-roster'
import type { RoomActivityKind, RoomEventPublisher } from '../realtime/room-events'
import type { HomeEventPublisher } from '../realtime/home-events'
import {
  readAccountAccessPolicy,
  type SanctionType,
} from '../auth/account-access-policy'
import type { Clock } from '../time'
import {
  MembershipService,
  type DepartureResult,
  type ReclaimResult,
  type UnexpectedDisconnectResult,
  type TerminalDepartureReason,
} from './membership-service'
import { RoomLifecycle, type RoomLifecycleWarning } from './room-lifecycle'

const SANCTION_DEFAULT_MS = 7 * 24 * 60 * 60 * 1_000
const confirmationProposalDigest = (input: NormalizedRoomInput) =>
  createHash('sha256')
    .update(JSON.stringify({
      name: input.name,
      category: input.category ?? null,
      description: input.description ?? null,
      tags: input.tags,
      visibility: input.visibility,
      password: input.password ?? null,
    }))
    .digest('hex')
const CONFIRMATION_TTL_MS = 5 * 60 * 1_000
const deriveKey = promisify(scryptCallback)

/** `json_build_object` hands timestamps back as ISO strings, so the roster is
    revived into `Date` before it reaches the projection. */
type RosterRow = Omit<RoomRosterMember, 'joinedAt' | 'previewUpdatedAt'> & {
  readonly joinedAt: string
  readonly previewUpdatedAt: string | null
}

type Consequence = 'transfer-host' | 'stop-stream'

export type ConfirmationCommand = 'create' | 'admit' | 'leave'
type Restriction =
  | 'account-read-only'
  | 'room-creation-sanctioned'
  | 'all-access-sanctioned'

export interface RoomProjection {
  readonly id: string
  readonly name: string
  readonly category: string | null
  readonly description: string | null
  readonly tags: readonly string[]
  readonly visibility: RoomVisibility
  readonly createdAt: Date
  readonly expiresAt: Date
}

export interface MembershipProjection {
  readonly id: string
  readonly roomId: string
  readonly accountId: string
  readonly role: 'host' | 'member'
  readonly joinedAt: Date
}

export interface MembershipConfirmation {
  readonly token?: string
  readonly issuedAt?: Date
  readonly command: ConfirmationCommand
  readonly target: string
  readonly sourceMembershipId: string
  readonly consequences: readonly Consequence[]
}

interface ConfirmationRequired {
  readonly status: 'confirmation-required'
  readonly consequences: readonly Consequence[]
  readonly confirmation: MembershipConfirmation
}

interface ConfirmationStale {
  readonly status: 'confirmation-stale'
}

export type CreateRoomResult =
  | {
      readonly status: 'created'
      readonly room: RoomProjection
      readonly membership: MembershipProjection
    }
  | { readonly status: 'unauthenticated' }
  | { readonly status: Restriction }
  | { readonly status: 'rate-limited'; readonly retryAfterSeconds: number }
  | { readonly status: 'rate-limit-unavailable' }
  | ConfirmationRequired
  | ConfirmationStale

export interface AdmitOptions {
  readonly password?: string
  readonly clientIp?: string
  readonly confirmation?: MembershipConfirmation
}

export type AdmitResult =
  | {
      readonly status: 'joined'
      readonly membership: MembershipProjection
      readonly role: 'host' | 'member'
      readonly revived: boolean
    }
  | { readonly status: 'already-member'; readonly membership: MembershipProjection }
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'account-read-only' | 'all-access-sanctioned' }
  | { readonly status: 'not-found' | 'ended' | 'full' | 'banned' }
  | { readonly status: 'password-required' | 'invalid-password' }
  | { readonly status: 'rate-limited'; readonly retryAfterSeconds: number }
  | { readonly status: 'rate-limit-unavailable' }
  | ConfirmationRequired
  | ConfirmationStale

export type LeaveResult =
  | { readonly status: 'not-member' }
  | ConfirmationRequired
  | ConfirmationStale
  | {
      readonly status: 'left'
      readonly roomState: 'active' | 'empty-grace' | 'ended'
    }

export type RoomInspection =
  | { readonly status: 'not-found' }
  | {
      readonly status: 'active' | 'empty-grace' | 'ended'
      readonly id: string
      readonly name: string
      readonly category: string | null
      readonly tags: readonly string[]
      readonly visibility: RoomVisibility
      readonly memberCount: number
      readonly expiresAt: Date
      readonly admission: 'open' | 'password-required' | 'full' | 'member' | 'ended'
    }

export interface AffectedRoomTransition {
  readonly roomId: string
}

export interface PlatformAdminRoomActor {
  readonly accountId: string
  readonly isPlatformAdmin: boolean
}

export interface AdminLiveRoom {
  readonly id: string
  readonly name: string
  readonly visibility: RoomVisibility
  readonly memberCount: number
  readonly streamCount: number
  readonly createdAt: Date
}

export type AdminEndRoomResult =
  | { readonly status: 'ended'; readonly endedAt: Date }
  | { readonly status: 'already-ended' | 'forbidden' | 'not-found' }

export type ListAdminLiveRoomsResult =
  | { readonly status: 'forbidden' }
  | { readonly status: 'ok'; readonly rooms: readonly AdminLiveRoom[] }

export interface RoomModerationAuditEntry {
  readonly level: 'info'
  readonly event:
    | 'room.member_kicked'
    | 'room.ban_applied'
    | 'room.ban_cleared'
    | 'room.host_transferred'
    | 'room.admin_ended'
  readonly roomId: string
  readonly actorAccountId: string
  readonly targetAccountId: string | null
  readonly outcome:
    | 'banned'
    | 'kicked'
    | 'cleared'
    | 'transferred'
    | 'not-banned'
    | 'not-member'
    | 'invalid-target'
    | 'forbidden'
    | 'ended'
    | 'not-found'
    | 'already-ended'
  readonly occurredAt: string
}

export interface RoomServiceConfiguration {
  readonly pool: Pool
  readonly valkey: Redis
  readonly valkeyPrefix: string
  readonly now?: () => Date
  readonly clock?: Clock
  readonly publishHomeEvent?: HomeEventPublisher
  /** Room-scoped fan-out. Lifetime warnings are canonical Activity entries
      inside the room as well as Home badges (ADR 0103). */
  readonly publishRoomEvent?: RoomEventPublisher
  readonly revokeConnections: (accountId: string) => Promise<void> | void
  readonly revokeRoomConnections?: (
    accountId: string,
    roomId: string,
  ) => Promise<void> | void
  /** Moderation detail stays in structured operational logs, never Room
      Activity or analytics. */
  readonly moderationAudit?: (entry: RoomModerationAuditEntry) => void
}

export class RoomService {
  private readonly repository: RoomRepository
  private readonly now: () => Date
  private readonly publishHomeEvent: HomeEventPublisher
  private readonly revokeConnections: (accountId: string) => Promise<void> | void
  private readonly revokeRoomConnections: (
    accountId: string,
    roomId: string,
  ) => Promise<void> | void
  private readonly moderationAudit: (entry: RoomModerationAuditEntry) => void
  private readonly membershipService: MembershipService
  private readonly lifecycle?: RoomLifecycle
  private readonly initialization: Promise<void>

  constructor(private readonly configuration: RoomServiceConfiguration) {
    this.repository = new RoomRepository(configuration.pool)
    this.now = configuration.now ?? (() => new Date())
    this.revokeConnections = configuration.revokeConnections
    this.revokeRoomConnections = configuration.revokeRoomConnections ?? (() => {})
    this.publishHomeEvent = configuration.publishHomeEvent ?? (() => {})
    this.moderationAudit = configuration.moderationAudit ?? writeRoomModerationAudit
    let membershipService!: MembershipService
    const lifecycle = configuration.clock
      ? new RoomLifecycle({
          pool: configuration.pool,
          clock: configuration.clock,
          onWarning: (warning: RoomLifecycleWarning) => {
            this.emitHomeEvent({
              type: 'room-warning',
              roomId: warning.roomId,
              minutes: warning.minutes,
            })
            configuration.publishRoomEvent?.({
              type: 'activity',
              roomId: warning.roomId,
              entry: {
                id: randomUUID(),
                kind: 'room-warning',
                displayName: null,
                at: this.now().toISOString(),
                minutes: warning.minutes,
              },
            })
          },
          onRoomEnded: (roomId) => {
            this.emitHomeEvent({ type: 'room-ended', roomId })
            configuration.publishRoomEvent?.({ type: 'room-ended', roomId })
          },
          onReconnectExpired: async (membershipId, reconnectUntil) => {
            const result = await membershipService.expireReconnect(membershipId, reconnectUntil)
            await this.publishMembershipTransition(result)
            return result
          },
          onError: (error) => {
            console.error('Room lifecycle callback failed', error)
          },
        })
      : undefined
    membershipService = new MembershipService({
      pool: configuration.pool,
      now: this.now,
      clock: configuration.clock,
      scheduleReconnect: lifecycle
        ? (membershipId, reconnectUntil) =>
            lifecycle.scheduleMembership(membershipId, reconnectUntil)
        : undefined,
    })
    this.membershipService = membershipService
    this.lifecycle = lifecycle
    this.initialization = lifecycle ? this.recoverLifecycle(lifecycle) : Promise.resolve()
  }
  private async recoverLifecycle(lifecycle: RoomLifecycle): Promise<void> {
    for (;;) {
      try {
        await lifecycle.recover()
        return
      } catch (error) {
        console.error('Room lifecycle recovery failed', error)
        await new Promise<void>((resolve) => setTimeout(resolve, 1_000))
      }
    }
  }

  async ready(): Promise<void> {
    await this.initialization
  }

  async scheduleRoom(roomId: string): Promise<void> {
    await this.initialization
    await this.lifecycle?.scheduleRoom(roomId)
  }

  async drainLifecycle(): Promise<void> {
    await this.initialization
    await this.lifecycle?.drain()
  }
  private emitHomeEvent(event: Parameters<HomeEventPublisher>[0]) {
    try {
      this.publishHomeEvent(event)
    } catch {
      // Notifications are best effort after the owning mutation commits.
    }
  }

  private emitRoomActivity(
    roomId: string,
    kind: RoomActivityKind,
    displayName: string | null,
    at: Date,
  ) {
    try {
      this.configuration.publishRoomEvent?.({
        type: 'activity',
        roomId,
        entry: {
          id: randomUUID(),
          kind,
          displayName,
          at: at.toISOString(),
        },
      })
    } catch {
      // Realtime delivery is best effort after the committed moderation action.
    }
  }

  private emitModerationAudit(
    event: RoomModerationAuditEntry['event'],
    actorAccountId: string,
    roomId: string,
    targetAccountId: string | null,
    outcome: RoomModerationAuditEntry['outcome'],
  ) {
    try {
      this.moderationAudit({
        level: 'info',
        event,
        roomId,
        actorAccountId,
        targetAccountId,
        outcome,
        occurredAt: this.now().toISOString(),
      })
    } catch {
      // Logging cannot turn an already decided moderation command into failure.
    }
  }

  async publishRoomTransitions(
    transitions: readonly AffectedRoomTransition[],
  ): Promise<void> {
    for (const transition of transitions) {
      await this.publishRoomMembership(transition.roomId)
      // Rosters, watcher stacks and Stream counts all move together, so the
      // room refetches its projection on any membership transition.
      this.configuration.publishRoomEvent?.({
        type: 'membership-changed',
        roomId: transition.roomId,
      })
      await this.scheduleRoom(transition.roomId)
    }
  }

  async createRoom(
    accountId: string | null,
    input: RoomInput,
    options: { readonly confirmation?: MembershipConfirmation } = {},
  ): Promise<CreateRoomResult> {
    if (!accountId) return { status: 'unauthenticated' }
    const normalized = normalizeRoomInput(input)
    const proposal = confirmationProposalDigest(normalized)
    const restriction = await this.restriction(accountId, true)
    if (restriction) return { status: restriction }

    const current = await this.repository.currentMembership(accountId)
    const currentRoom = current
      ? await this.repository.room(current.roomId)
      : null
    if (
      current &&
      currentRoom &&
      !currentRoom.endedAt &&
      roomEndDeadline(currentRoom).getTime() > this.now().getTime()
    ) {
      const consequences = await this.sourceConsequences(
        this.configuration.pool,
        current,
      )
      if (consequences.length > 0 && !options.confirmation) {
        return this.confirmationRequired(
          accountId,
          current,
          consequences,
          'create',
          proposal,
        )
      }
    }

    const limit = await consumeRoomCreationLimit(
      this.configuration.valkey,
      this.configuration.valkeyPrefix,
      accountId,
    )
    if (limit.kind === 'unavailable') return { status: 'rate-limit-unavailable' }
    if (limit.kind === 'limited') {
      return { status: 'rate-limited', retryAfterSeconds: limit.retryAfterSeconds }
    }

    const passwordHash = normalized.password
      ? await hashPassword(normalized.password)
      : null
    let validatedConfirmation:
      | {
          readonly confirmation: MembershipConfirmation
          readonly membership: CurrentMembership
          readonly consequences: readonly Consequence[]
        }
      | undefined
    const affectedRooms: AffectedRoomTransition[] = []
    const result: CreateRoomResult = await this.transaction(async (client) => {
      if (!(await this.lockAccount(client, accountId))) {
        return { status: 'unauthenticated' }
      }
      const currentRestriction = await this.restriction(accountId, true, client)
      if (currentRestriction) return { status: currentRestriction }
      let lockedCurrent = await this.lockCurrentMembership(client, accountId)
      const instant = this.now()
      if (
        lockedCurrent &&
        (await this.closeRoomIfDue(client, lockedCurrent.roomId, instant))
      ) {
        affectedRooms.push({ roomId: lockedCurrent.roomId })
        lockedCurrent = null
      }
      if (lockedCurrent) {
        const consequences = await this.sourceConsequences(client, lockedCurrent)
        if (options.confirmation) {
          if (
            options.confirmation.sourceMembershipId !== lockedCurrent.id ||
            !(await this.confirmationMatches(
              accountId,
              options.confirmation,
              lockedCurrent,
              consequences,
              'create',
              proposal,
            ))
          ) {
            return await this.confirmationRequired(
              accountId,
              lockedCurrent,
              consequences,
              'create',
              proposal,
            )
          }
          validatedConfirmation = {
            confirmation: options.confirmation,
            membership: lockedCurrent,
            consequences,
          }
        } else if (consequences.length > 0) {
          return await this.confirmationRequired(
            accountId,
            lockedCurrent,
            consequences,
            'create',
            proposal,
          )
        }
      } else if (options.confirmation) {
        return { status: 'confirmation-stale' }
      }

      const roomId = randomUUID()
      const membershipId = randomUUID()
      await client.query(
        `INSERT INTO room
           (id, name, category, description, tags, visibility, password_hash, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          roomId,
          normalized.name,
          normalized.category ?? null,
          normalized.description ?? null,
          normalized.tags,
          normalized.visibility,
          passwordHash,
          accountId,
          instant,
        ],
      )
      if (lockedCurrent) await this.depart(client, lockedCurrent, instant)
      if (lockedCurrent) affectedRooms.push({ roomId: lockedCurrent.roomId })
      await client.query(
        `INSERT INTO room_membership
           (id, room_id, account_id, role, joined_at)
         VALUES ($1, $2, $3, 'host', $4)`,
        [membershipId, roomId, accountId, instant],
      )
      return {
        status: 'created',
        room: roomProjection({
          id: roomId,
          name: normalized.name,
          category: normalized.category ?? null,
          description: normalized.description ?? null,
          tags: normalized.tags,
          visibility: normalized.visibility,
          passwordHash,
          createdAt: instant,
          emptyAt: null,
          endedAt: null,
        }),
        membership: {
          id: membershipId,
          roomId,
          accountId,
          role: 'host',
          joinedAt: instant,
        },
      }
    })
    if (result.status === 'created' && validatedConfirmation) {
      await this.consumeConfirmation(
        accountId,
        validatedConfirmation.confirmation,
        validatedConfirmation.membership,
        validatedConfirmation.consequences,
        'create',
        proposal,
      ).catch(() => false)
    }
    if (result.status === 'created') {
      await this.publishRoomTransitions(affectedRooms)
      this.emitHomeEvent({ type: 'room-discovery', roomId: result.room.id })
      await this.publishRoomTransitions([{ roomId: result.room.id }])
    }
    return result
  }

  async admit(
    accountId: string | null,
    roomId: string,
    options: AdmitOptions = {},
  ): Promise<AdmitResult> {
    if (!accountId) return { status: 'unauthenticated' }
    const restriction = await this.restriction(accountId, false)
    if (restriction === 'account-read-only' || restriction === 'all-access-sanctioned') {
      return { status: restriction }
    }

    await this.endDueRooms()
    const initialRoom = await this.repository.room(roomId)
    if (!initialRoom) return { status: 'not-found' }
    if (initialRoom.endedAt) return { status: 'ended' }

    let initialPasswordChecked = false
    if (initialRoom.visibility === 'private') {
      const initialCurrent = await this.repository.currentMembership(accountId)
      if (initialCurrent?.roomId !== roomId) {
        if (!options.password) return { status: 'password-required' }
        const limit = await consumePrivatePasswordLimit(
          this.configuration.valkey,
          this.configuration.valkeyPrefix,
          {
            accountId,
            roomId,
            clientIp: options.clientIp ?? 'unknown',
          },
        )
        if (limit.kind === 'unavailable') return { status: 'rate-limit-unavailable' }
        if (limit.kind === 'limited') {
          return { status: 'rate-limited', retryAfterSeconds: limit.retryAfterSeconds }
        }
        if (
          !initialRoom.passwordHash ||
          !(await passwordMatches(options.password, initialRoom.passwordHash))
        ) {
          return { status: 'invalid-password' }
        }
        initialPasswordChecked = true
    }
      }

    let validatedConfirmation:
      | {
          readonly confirmation: MembershipConfirmation
          readonly membership: CurrentMembership
          readonly consequences: readonly Consequence[]
        }
      | undefined
    const affectedRooms: AffectedRoomTransition[] = []
    const result: AdmitResult = await this.transaction(async (client) => {
      if (!(await this.lockAccount(client, accountId))) {
        return { status: 'unauthenticated' }
      }
      const currentRestriction = await this.restriction(accountId, false, client)
      if (
        currentRestriction === 'account-read-only' ||
        currentRestriction === 'all-access-sanctioned'
      ) {
        return { status: currentRestriction }
      }
      const observedCurrent = await this.repository.currentMembership(
        accountId,
        client,
      )
      await this.lockRooms(client, [roomId, observedCurrent?.roomId])
      const instant = this.now()
      let current = await this.repository.currentMembership(accountId, client, true)
      if (
        current &&
        (await this.closeRoomIfDue(client, current.roomId, instant))
      ) {
        affectedRooms.push({ roomId: current.roomId })
        current = null
      }
      if (current?.roomId === roomId) {
        return { status: 'already-member', membership: membershipProjection(current) }
      }

      const target = await this.repository.room(roomId, client, true)
      if (!target) return { status: 'not-found' }
      if (target.endedAt || roomExpired(target, instant) || emptyGraceExpired(target, instant)) {
        if (!target.endedAt) {
          affectedRooms.push({ roomId: target.id })
          await endRoom(client, target.id, roomEndDeadline(target))
        }
        return { status: 'ended' }
      }
      if (target.visibility === 'private') {
        if (!options.password) return { status: 'password-required' }
        if (!initialPasswordChecked) {
          const limit = await consumePrivatePasswordLimit(
            this.configuration.valkey,
            this.configuration.valkeyPrefix,
            {
              accountId,
              roomId,
              clientIp: options.clientIp ?? 'unknown',
            },
          )
          if (limit.kind === 'unavailable') return { status: 'rate-limit-unavailable' }
          if (limit.kind === 'limited') {
            return { status: 'rate-limited', retryAfterSeconds: limit.retryAfterSeconds }
          }
        }
        if (
          !target.passwordHash ||
          !(await passwordMatches(options.password, target.passwordHash))
        ) {
          return { status: 'invalid-password' }
        }
      }

      const ban = await client.query(
        `SELECT 1 FROM room_ban
          WHERE room_id = $1 AND account_id = $2 AND cleared_at IS NULL`,
        [roomId, accountId],
      )
      if (ban.rows[0]) return { status: 'banned' }

      if (current) {
        const consequences = await this.sourceConsequences(client, current)
        if (options.confirmation) {
          if (
            options.confirmation.sourceMembershipId !== current.id ||
            !(await this.confirmationMatches(
              accountId,
              options.confirmation,
              current,
              consequences,
              'admit',
              roomId,
            ))
          ) {
            return await this.confirmationRequired(
              accountId,
              current,
              consequences,
              'admit',
              roomId,
            )
          }
          validatedConfirmation = {
            confirmation: options.confirmation,
            membership: current,
            consequences,
          }
        } else if (consequences.length > 0) {
          return await this.confirmationRequired(
            accountId,
            current,
            consequences,
            'admit',
            roomId,
          )
        }
      } else if (options.confirmation) {
        return { status: 'confirmation-stale' }
      }
      const memberCount = await this.repository.memberCount(roomId, client)
      if (memberCount >= ROOM_CAPACITY) return { status: 'full' }


      if (current) affectedRooms.push({ roomId: current.roomId })
      if (current) await this.depart(client, current, instant)
      const revived = target.emptyAt !== null
      const role = revived ? 'host' : 'member'
      if (revived) {
        await client.query('UPDATE room SET empty_at = NULL WHERE id = $1', [roomId])
      }
      const membership: MembershipProjection = {
        id: randomUUID(),
        roomId,
        accountId,
        role,
        joinedAt: instant,
      }
      await client.query(
        `INSERT INTO room_membership
           (id, room_id, account_id, role, joined_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [membership.id, roomId, accountId, role, instant],
      )
      return { status: 'joined', membership, role, revived }
    })
    if (result.status === 'joined' && validatedConfirmation) {
      await this.consumeConfirmation(
        accountId,
        validatedConfirmation.confirmation,
        validatedConfirmation.membership,
        validatedConfirmation.consequences,
        'admit',
        roomId,
      ).catch(() => false)
    }
    if (result.status === 'joined') {
      affectedRooms.push({ roomId: result.membership.roomId })
    }
    await this.publishRoomTransitions(affectedRooms)
    if (result.status === 'joined') {
      this.emitHomeEvent({ type: 'room-discovery', roomId: result.membership.roomId })
    }
    return result
  }
  async leave(
    accountId: string,
    options: {
      readonly roomId?: string
      readonly membershipId?: string
      readonly confirmation?: MembershipConfirmation
    } = {},
  ): Promise<LeaveResult> {
    const affectedRooms: AffectedRoomTransition[] = []
    let changedRoomId: string | undefined
    let validatedConfirmation:
      | {
          readonly confirmation: MembershipConfirmation
          readonly membership: CurrentMembership
          readonly consequences: readonly Consequence[]
        }
      | undefined
    const result: LeaveResult = await this.transaction(async (client) => {
      if (!(await this.lockAccount(client, accountId))) {
        return { status: 'not-member' }
      }
      const current = await this.lockCurrentMembership(client, accountId)
      if (
        !current ||
        (options.roomId !== undefined && options.roomId !== current.roomId) ||
        (options.membershipId !== undefined && options.membershipId !== current.id)
      ) {
        return { status: 'not-member' }
      }
      changedRoomId = current.roomId
      const instant = this.now()
      if (await this.closeRoomIfDue(client, current.roomId, instant)) {
        affectedRooms.push({ roomId: current.roomId })
        return { status: 'left', roomState: 'ended' }
      }
      const consequences = await this.sourceConsequences(client, current)
      if (options.confirmation) {
        if (
          options.confirmation.sourceMembershipId !== current.id ||
          !(await this.confirmationMatches(
            accountId,
            options.confirmation,
            current,
            consequences,
            'leave',
            current.roomId,
          ))
        ) {
          return await this.confirmationRequired(
            accountId,
            current,
            consequences,
            'leave',
            current.roomId,
          )
        }
        validatedConfirmation = {
          confirmation: options.confirmation,
          membership: current,
          consequences,
        }
      } else if (consequences.length > 0) {
        return await this.confirmationRequired(
          accountId,
          current,
          consequences,
          'leave',
          current.roomId,
        )
      }
      const roomState = await this.depart(client, current, instant)
      affectedRooms.push({ roomId: current.roomId })
      return { status: 'left', roomState }
    })
    if (result.status === 'left' && validatedConfirmation) {
      await this.consumeConfirmation(
        accountId,
        validatedConfirmation.confirmation,
        validatedConfirmation.membership,
        validatedConfirmation.consequences,
        'leave',
        validatedConfirmation.membership.roomId,
      ).catch(() => false)
    }
    if (result.status === 'left') {
      await this.publishRoomTransitions(affectedRooms)
      if (result.roomState !== 'ended' && changedRoomId) {
        this.emitHomeEvent({ type: 'room-discovery', roomId: changedRoomId })
      }
    }
    return result
  }

  private async publishMembershipTransition(
    result: DepartureResult | ReclaimResult | UnexpectedDisconnectResult,
  ): Promise<void> {
    if (!('roomId' in result) || !result.roomId) return
    await this.publishRoomTransitions([{ roomId: result.roomId }])
  }
  async currentMembership(accountId: string): Promise<MembershipProjection | null> {
    const membership = await this.repository.currentMembership(accountId)
    return membership ? membershipProjection(membership) : null
  }

  async handleUnexpectedDisconnect(
    accountId: string,
  ): Promise<UnexpectedDisconnectResult> {
    const result = await this.membershipService.unexpectedDisconnect(accountId)
    await this.publishMembershipTransition(result)
    return result
  }

  async reclaimMembership(accountId: string): Promise<ReclaimResult> {
    const result = await this.membershipService.reclaim(accountId)
    if (result.status === 'reclaimed' || result.status === 'expired') {
      await this.publishMembershipTransition(result)
    }
    return result
  }

  async terminalDeparture(
    accountId: string,
    reason: TerminalDepartureReason,
  ): Promise<DepartureResult> {
    const result = await this.membershipService.depart(accountId, reason)
    await this.publishMembershipTransition(result)
    return result
  }

  async inspectPreAdmission(
    roomId: string,
    accountId: string | null,
  ): Promise<RoomInspection> {
    await this.endDueRooms()
    const room = await this.repository.room(roomId)
    if (!room) return { status: 'not-found' }
    const memberCount = await this.repository.memberCount(roomId)
    const current = accountId
      ? await this.repository.currentMembership(accountId)
      : null
    const status = room.endedAt ? 'ended' : room.emptyAt ? 'empty-grace' : 'active'
    const admission = room.endedAt
      ? 'ended'
      : current?.roomId === room.id
        ? 'member'
        : memberCount >= ROOM_CAPACITY
          ? 'full'
          : room.visibility === 'private'
            ? 'password-required'
            : 'open'
    return {
      status,
      id: room.id,
      name: room.name,
      category: room.category,
      tags: room.tags,
      visibility: room.visibility,
      memberCount,
      expiresAt: new Date(room.createdAt.getTime() + ROOM_LIFETIME_MS),
      admission,
    }
  }

  async inspectRouteProjection(
    roomId: string,
    accountId: string | null,
  ): Promise<RoomRouteProjection | null> {
    await this.endDueRooms()
    const result = await this.configuration.pool.query<{
      id: string
      name: string
      category: string | null
      description: string | null
      tags: string[]
      visibility: RoomVisibility
      createdAt: Date
      endedAt: Date | null
      thumbnailCapturedAt: Date | null
      memberCount: number
      streamCount: number
      membershipId: string | null
      membershipRole: 'host' | 'member' | null
      roster: readonly RosterRow[]
      watchingStreamId: string | null
    }>(
      `SELECT room.id,
              room.name,
              room.category,
              room.description,
              room.tags,
              room.visibility,
              room.created_at AS "createdAt",
              room.ended_at AS "endedAt",
              CASE
                WHEN room.visibility = 'public' AND room.ended_at IS NOT NULL
                THEN (
                  SELECT thumbnail.captured_at
                    FROM past_stream_thumbnail thumbnail
                   WHERE thumbnail.room_id = room.id
                )
                ELSE NULL
              END AS "thumbnailCapturedAt",
              (
                SELECT count(*)::int
                  FROM room_membership
                 WHERE room_id = room.id
                   AND (room.ended_at IS NOT NULL OR left_at IS NULL)
              ) AS "memberCount",
              (
                SELECT count(*)::int
                  FROM stream
                 WHERE room_id = room.id
                   AND (room.ended_at IS NOT NULL OR ended_at IS NULL)
              ) AS "streamCount",
              self.id AS "membershipId",
              self.role AS "membershipRole",
              -- Roster is returned only to a viewer who holds a current
              -- membership. ADR 0003 hides participant identities until
              -- admission, so an anonymous or pre-admission request must not
              -- be able to read names out of this projection at all.
              CASE
                WHEN self.id IS NULL THEN '[]'::json
                ELSE COALESCE(roster.items, '[]'::json)
              END AS roster,
              self_watch.stream_id AS "watchingStreamId"
         FROM room
         LEFT JOIN room_membership self
           ON self.room_id = room.id
          AND self.account_id = $2
          AND self.left_at IS NULL
         LEFT JOIN LATERAL (
           SELECT json_agg(
                    json_build_object(
                      'membershipId', membership.id,
                      'accountId', membership.account_id,
                      'displayName', account.name,
                      'avatarUrl', account.image,
                      'role', membership.role,
                      'joinedAt', membership.joined_at,
                      'reconnecting', membership.reconnect_until IS NOT NULL,
                      'streamId', live_stream.id,
                      'previewKey', live_stream.preview_key,
                      'previewUpdatedAt', live_stream.preview_updated_at,
                      'watcherCount', COALESCE(watchers.total, 0),
                      'watchers', COALESCE(watchers.items, '[]'::json)
                    )
                  ) AS items
             FROM room_membership membership
             JOIN "user" account ON account.id = membership.account_id
             LEFT JOIN stream live_stream
               ON live_stream.membership_id = membership.id
              AND live_stream.ended_at IS NULL
             -- ADR 0101's watcher stack: up to three avatars plus the total,
             -- ordered by watch start so visible avatars stay stable.
             LEFT JOIN LATERAL (
               SELECT count(*)::int AS total,
                      json_agg(
                        json_build_object(
                          'accountId', visible."accountId",
                          'displayName', visible."displayName",
                          'avatarUrl', visible."avatarUrl"
                        ) ORDER BY visible.rank
                      ) FILTER (WHERE visible.rank <= 3) AS items
                 FROM (
                   SELECT watcher_account.id AS "accountId",
                          watcher_account.name AS "displayName",
                          watcher_account.image AS "avatarUrl",
                          row_number() OVER (
                            ORDER BY subscription.started_at ASC, subscription.id ASC
                          ) AS rank
                     FROM stream_subscription subscription
                     JOIN room_membership watcher
                       ON watcher.id = subscription.viewer_membership_id
                     JOIN "user" watcher_account ON watcher_account.id = watcher.account_id
                    WHERE subscription.stream_id = live_stream.id
                      AND subscription.ended_at IS NULL
                 ) visible
             ) watchers ON live_stream.id IS NOT NULL
            WHERE membership.room_id = room.id
              AND membership.left_at IS NULL
         ) roster ON true
         LEFT JOIN LATERAL (
           SELECT subscription.stream_id
             FROM stream_subscription subscription
            WHERE subscription.viewer_membership_id = self.id
              AND subscription.ended_at IS NULL
            LIMIT 1
         ) self_watch ON self.id IS NOT NULL
        WHERE room.id = $1`,
      [roomId, accountId],
    )
    const row = result.rows[0]
    const viewerAccess =
      accountId && row?.membershipId
        ? await readAccountAccessPolicy(this.configuration.pool, accountId, this.now())
        : null
    return selectRoomRouteProjection({
      room: row
        ? {
            id: row.id,
            name: row.name,
            category: row.category,
            description: row.description,
            tags: row.tags,
            visibility: row.visibility,
            createdAt: row.createdAt,
            endedAt: row.endedAt,
            thumbnailCapturedAt: row.thumbnailCapturedAt,
          }
        : null,
      memberCount: row?.memberCount ?? 0,
      streamCount: row?.streamCount ?? 0,
      self:
        row?.membershipId && row.membershipRole
          ? { id: row.membershipId, role: row.membershipRole }
          : null,
      viewerAuthenticated: accountId !== null,
      watchingStreamId: row?.watchingStreamId ?? null,
      viewerSanctionTypes: viewerAccess?.sanctionTypes.filter(
        (type): type is 'streaming' | 'chat' => type === 'streaming' || type === 'chat',
      ),
      roster: (row?.roster ?? []).map((member) => ({
        ...member,
        joinedAt: new Date(member.joinedAt),
        previewUpdatedAt: member.previewUpdatedAt
          ? new Date(member.previewUpdatedAt)
          : null,
      })),
    })
  }
  async setDeletionPending(accountId: string, pending: boolean) {
    const affectedRooms = await this.transaction((client) =>
      this.setDeletionPendingInTransaction(client, accountId, pending),
    )
    await this.publishRoomTransitions(affectedRooms)
  }

  async setDeletionPendingInTransaction(
    client: PoolClient,
    accountId: string,
    pending: boolean,
  ): Promise<readonly AffectedRoomTransition[]> {
    if (!(await this.lockAccount(client, accountId))) {
      throw new Error(`Unknown Account: ${accountId}`)
    }
    const current = pending ? await this.lockCurrentMembership(client, accountId) : null
    const instant = this.now()
    await client.query(
      `INSERT INTO account_state (account_id, deletion_requested_at)
       VALUES ($1, $2)
       ON CONFLICT (account_id)
       DO UPDATE SET deletion_requested_at = EXCLUDED.deletion_requested_at`,
      [accountId, pending ? instant : null],
    )
    if (current) {
      await this.depart(client, current, instant)
      return [{ roomId: current.roomId }]
    }
    return []
  }

  async applySanction(input: {
    readonly accountId: string
    readonly type: SanctionType
    readonly expiresAt?: Date | null
  }) {
    const affectedRooms: AffectedRoomTransition[] = []
    const result = await this.transaction(async (client) => {
      if (!(await this.lockAccount(client, input.accountId))) {
        throw new Error(`Unknown Account: ${input.accountId}`)
      }
      const current = await this.lockCurrentMembership(client, input.accountId)
      const instant = this.now()
      const expiresAt =
        input.expiresAt === undefined
          ? new Date(instant.getTime() + SANCTION_DEFAULT_MS)
          : input.expiresAt
      if (expiresAt && expiresAt.getTime() <= instant.getTime()) {
        throw new TypeError('Sanction expiry must be in the future')
      }
      const sanctionId = randomUUID()
      await client.query(
        `INSERT INTO platform_sanction
           (id, account_id, type, starts_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [sanctionId, input.accountId, input.type, instant, expiresAt],
      )
      let stoppedStreams = 0
      if (input.type === 'streaming' && current) {
        await client.query(
          `UPDATE stream_subscription subscription
              SET ended_at = $2
             FROM stream
            WHERE subscription.stream_id = stream.id
              AND stream.membership_id = $1
              AND subscription.ended_at IS NULL`,
          [current.id, instant],
        )
        const stopped = await client.query(
          `UPDATE stream
              SET ended_at = $2,
                  preview_key = NULL,
                  preview_updated_at = NULL
            WHERE membership_id = $1 AND ended_at IS NULL
          RETURNING id`,
          [current.id, instant],
        )
        stoppedStreams = stopped.rowCount ?? stopped.rows.length
      }
      if (input.type !== 'all_access' && current) {
        affectedRooms.push({ roomId: current.roomId })
      }
      if (input.type !== 'all_access') {
        return { sanctionId, removedFromRoom: false, stoppedStreams }
      }
      await client.query(
        `UPDATE "user" account
            SET all_access_blocked_indefinite = EXISTS (
                  SELECT 1
                    FROM platform_sanction
                   WHERE account_id = account.id
                     AND type = 'all_access'
                     AND starts_at <= $2
                     AND lifted_at IS NULL
                     AND expires_at IS NULL
                ),
                all_access_blocked_until = (
                  SELECT max(expires_at)
                    FROM platform_sanction
                   WHERE account_id = account.id
                     AND type = 'all_access'
                     AND starts_at <= $2
                     AND lifted_at IS NULL
                     AND expires_at > $2
                )
          WHERE id = $1`,
        [input.accountId, instant],
      )
      if (current) await this.depart(client, current, instant)
      if (current) affectedRooms.push({ roomId: current.roomId })
      await client.query('DELETE FROM session WHERE user_id = $1', [input.accountId])
      return {
        sanctionId,
        removedFromRoom: current !== null,
        stoppedStreams: current ? 1 : 0,
      }
    })
    await this.publishRoomTransitions(affectedRooms)
    if (input.type === 'all_access') {
      await this.revokeConnections(input.accountId)
    }
    return { status: 'applied' as const, ...result }
  }

  async kickAccount(hostAccountId: string, roomId: string, accountId: string) {
    if (hostAccountId === accountId) {
      const result = { status: 'invalid-target' as const }
      this.emitModerationAudit(
        'room.member_kicked',
        hostAccountId,
        roomId,
        accountId,
        result.status,
      )
      return result
    }
    const affectedRooms: AffectedRoomTransition[] = []
    const result = await this.transaction(async (client) => {
      const accounts = await this.lockAccounts(client, [hostAccountId, accountId])
      if (!accounts.has(hostAccountId)) return { status: 'forbidden' as const }
      const access = await readAccountAccessPolicy(client, hostAccountId, this.now())
      if (!access?.canMutate('moderate')) return { status: 'forbidden' as const }
      await this.lockRooms(client, [roomId])
      const instant = this.now()
      if (await this.closeRoomIfDue(client, roomId, instant)) {
        affectedRooms.push({ roomId })
        return { status: 'ended' as const }
      }
      const host = await this.repository.currentMembership(hostAccountId, client, true)
      if (!host || host.roomId !== roomId || host.role !== 'host') {
        return { status: 'forbidden' as const }
      }
      const target = await this.repository.currentMembership(accountId, client, true)
      if (!target || target.roomId !== roomId) return { status: 'not-member' as const }
      const targetAccount = await client.query<{ displayName: string }>(
        'SELECT name AS "displayName" FROM "user" WHERE id = $1',
        [accountId],
      )
      await this.depart(client, target, instant)
      affectedRooms.push({ roomId: target.roomId })
      return {
        status: 'kicked' as const,
        activity: {
          displayName: targetAccount.rows[0]?.displayName ?? 'A member',
          at: instant,
        },
      }
    })
    this.emitModerationAudit(
      'room.member_kicked',
      hostAccountId,
      roomId,
      accountId,
      result.status,
    )
    if (result.status === 'kicked') {
      await this.revokeRoomConnections(accountId, roomId)
    }
    if (result.status === 'kicked') {
      this.emitRoomActivity(
        roomId,
        'member-removed',
        result.activity.displayName,
        result.activity.at,
      )
    }
    await this.publishRoomTransitions(affectedRooms)
    return result.status === 'kicked' ? { status: 'kicked' as const } : result
  }

  async banAccount(hostAccountId: string, roomId: string, accountId: string) {
    if (hostAccountId === accountId) {
      const result = { status: 'invalid-target' as const }
      this.emitModerationAudit('room.ban_applied', hostAccountId, roomId, accountId, result.status)
      return result
    }
    const affectedRooms: AffectedRoomTransition[] = []
    const result = await this.transaction(async (client) => {
      const accounts = await this.lockAccounts(client, [
        hostAccountId,
        accountId,
      ])
      if (!accounts.has(hostAccountId)) return { status: 'forbidden' as const }
      const access = await readAccountAccessPolicy(client, hostAccountId, this.now())
      if (!access?.canMutate('moderate')) return { status: 'forbidden' as const }
      await this.lockRooms(client, [roomId])
      const instant = this.now()
      if (await this.closeRoomIfDue(client, roomId, instant)) {
        affectedRooms.push({ roomId })
        return { status: 'ended' as const }
      }
      const host = await this.repository.currentMembership(hostAccountId, client, true)
      if (!host || host.roomId !== roomId || host.role !== 'host') {
        return { status: 'forbidden' as const }
      }
      const target = await this.repository.currentMembership(accountId, client, true)
      if (!target || target.roomId !== roomId) return { status: 'not-member' as const }
      const targetAccount = await client.query<{ displayName: string }>(
        'SELECT name AS "displayName" FROM "user" WHERE id = $1',
        [accountId],
      )
      const existing = await client.query(
        `SELECT 1 FROM room_ban
          WHERE room_id = $1 AND account_id = $2 AND cleared_at IS NULL`,
        [roomId, accountId],
      )
      if (!existing.rows[0]) {
        await client.query(
          `INSERT INTO room_ban
             (id, room_id, account_id, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [randomUUID(), roomId, accountId, hostAccountId, instant],
        )
      }
      await this.depart(client, target, instant)
      affectedRooms.push({ roomId: target.roomId })
      return {
        status: 'banned' as const,
        activity: {
          displayName: targetAccount.rows[0]?.displayName ?? 'A member',
          at: instant,
        },
      }
    })
    this.emitModerationAudit('room.ban_applied', hostAccountId, roomId, accountId, result.status)
    if (result.status === 'banned') {
      await this.revokeRoomConnections(accountId, roomId)
    }
    if (result.status === 'banned') {
      this.emitRoomActivity(
        roomId,
        'member-removed',
        result.activity.displayName,
        result.activity.at,
      )
    }
    await this.publishRoomTransitions(affectedRooms)
    return result.status === 'banned' ? { status: 'banned' as const } : result
  }

  async transferHost(hostAccountId: string, roomId: string, accountId: string) {
    if (hostAccountId === accountId) {
      const result = { status: 'invalid-target' as const }
      this.emitModerationAudit(
        'room.host_transferred',
        hostAccountId,
        roomId,
        accountId,
        result.status,
      )
      return result
    }
    const affectedRooms: AffectedRoomTransition[] = []
    const result = await this.transaction(async (client) => {
      const accounts = await this.lockAccounts(client, [hostAccountId, accountId])
      if (!accounts.has(hostAccountId)) return { status: 'forbidden' as const }
      const access = await readAccountAccessPolicy(client, hostAccountId, this.now())
      if (!access?.canMutate('moderate')) return { status: 'forbidden' as const }
      await this.lockRooms(client, [roomId])
      const instant = this.now()
      if (await this.closeRoomIfDue(client, roomId, instant)) {
        affectedRooms.push({ roomId })
        return { status: 'ended' as const }
      }
      const host = await this.repository.currentMembership(hostAccountId, client, true)
      if (!host || host.roomId !== roomId || host.role !== 'host') {
        return { status: 'forbidden' as const }
      }
      const target = await this.repository.currentMembership(accountId, client, true)
      if (!target || target.roomId !== roomId) return { status: 'not-member' as const }
      const targetAccount = await client.query<{ displayName: string }>(
        'SELECT name AS "displayName" FROM "user" WHERE id = $1',
        [accountId],
      )
      // The partial unique Host index is immediate, so demote then promote
      // inside one locked transaction rather than briefly creating two Hosts.
      await client.query(
        "UPDATE room_membership SET role = 'member' WHERE id = $1 AND left_at IS NULL",
        [host.id],
      )
      await client.query(
        "UPDATE room_membership SET role = 'host' WHERE id = $1 AND left_at IS NULL",
        [target.id],
      )
      affectedRooms.push({ roomId })
      return {
        status: 'transferred' as const,
        activity: {
          displayName: targetAccount.rows[0]?.displayName ?? 'A member',
          at: instant,
        },
      }
    })
    this.emitModerationAudit(
      'room.host_transferred',
      hostAccountId,
      roomId,
      accountId,
      result.status,
    )
    if (result.status === 'transferred') {
      this.emitRoomActivity(
        roomId,
        'host-transferred',
        result.activity.displayName,
        result.activity.at,
      )
    }
    await this.publishRoomTransitions(affectedRooms)
    return result.status === 'transferred' ? { status: 'transferred' as const } : result
  }

  async clearBan(hostAccountId: string, roomId: string, accountId: string) {
    const affectedRooms: AffectedRoomTransition[] = []
    const result = await this.transaction(async (client) => {
      if (!(await this.lockAccount(client, hostAccountId))) {
        return { status: 'forbidden' as const }
      }
      const access = await readAccountAccessPolicy(client, hostAccountId, this.now())
      if (!access?.canMutate('moderate')) return { status: 'forbidden' as const }
      await this.lockRooms(client, [roomId])
      const instant = this.now()
      if (await this.closeRoomIfDue(client, roomId, instant)) {
        affectedRooms.push({ roomId })
        return { status: 'ended' as const }
      }
      const host = await this.repository.currentMembership(hostAccountId, client, true)
      if (!host || host.roomId !== roomId || host.role !== 'host') {
        return { status: 'forbidden' as const }
      }
      const result = await client.query(
        `UPDATE room_ban
            SET cleared_at = $3
          WHERE room_id = $1 AND account_id = $2 AND cleared_at IS NULL
          RETURNING id`,
        [roomId, accountId, instant],
      )
      return { status: result.rows[0] ? ('cleared' as const) : ('not-banned' as const) }
    })
    this.emitModerationAudit('room.ban_cleared', hostAccountId, roomId, accountId, result.status)
    await this.publishRoomTransitions(affectedRooms)
    return result
  }

  /** Host Settings: metadata and privacy. The same normalization the create
      form uses runs here, so an edited room cannot hold a value a new room
      could not (ADR 0060). */
  async updateRoom(
    hostAccountId: string,
    roomId: string,
    input: RoomInput,
  ): Promise<
    | { readonly status: 'updated' }
    | { readonly status: 'forbidden' | 'ended' | 'password-required' }
  > {
    const normalized = normalizeRoomInput(input)
    if (normalized.visibility === 'private' && !normalized.password) {
      // Only when the room is becoming private: an already-private room keeps
      // the password it has unless a new one is supplied.
      const current = await this.repository.room(roomId)
      if (!current?.passwordHash) return { status: 'password-required' }
    }
    const passwordHash = normalized.password
      ? await hashPassword(normalized.password)
      : null
    return this.transaction(async (client) => {
      if (!(await this.lockAccount(client, hostAccountId))) {
        return { status: 'forbidden' as const }
      }
      const access = await readAccountAccessPolicy(client, hostAccountId, this.now())
      if (!access?.canMutate('moderate')) return { status: 'forbidden' as const }
      await this.lockRooms(client, [roomId])
      const instant = this.now()
      if (await this.closeRoomIfDue(client, roomId, instant)) {
        return { status: 'ended' as const }
      }
      const host = await this.repository.currentMembership(hostAccountId, client, true)
      if (!host || host.roomId !== roomId || host.role !== 'host') {
        return { status: 'forbidden' as const }
      }
      await client.query(
        `UPDATE room
            SET name = $2,
                category = $3,
                description = $4,
                tags = $5,
                visibility = $6,
                password_hash = CASE
                  WHEN $6 = 'public' THEN NULL
                  WHEN $7::text IS NOT NULL THEN $7
                  ELSE password_hash
                END
          WHERE id = $1`,
        [
          roomId,
          normalized.name,
          normalized.category ?? null,
          normalized.description ?? null,
          normalized.tags,
          normalized.visibility,
          passwordHash,
        ],
      )
      if (normalized.visibility === 'private') {
        // A capture stored under the public rule is readable (ADRs 0035 and
        // 0109). Retire both the live key and durable archive in this privacy
        // transaction rather than relying on either serving path to hide it.
        await client.query(
          `UPDATE stream
              SET preview_key = NULL, preview_updated_at = NULL
            WHERE room_id = $1 AND ended_at IS NULL AND preview_key IS NOT NULL`,
          [roomId],
        )
        await client.query(
          'DELETE FROM past_stream_thumbnail WHERE room_id = $1',
          [roomId],
        )
      }
      return { status: 'updated' as const }
    }).then(async (result) => {
      if (result.status === 'updated') await this.publishRoomTransitions([{ roomId }])
      return result
    })
  }

  /** The Bans tab. Host-only: a ban list is moderation state, not room state. */
  async listBans(hostAccountId: string, roomId: string) {
    const host = await this.repository.currentMembership(hostAccountId)
    if (!host || host.roomId !== roomId || host.role !== 'host') return null
    const result = await this.configuration.pool.query<{
      accountId: string
      displayName: string
      createdAt: Date
    }>(
      `SELECT room_ban.account_id AS "accountId",
              account.name AS "displayName",
              room_ban.created_at AS "createdAt"
         FROM room_ban
         JOIN "user" account ON account.id = room_ban.account_id
        WHERE room_ban.room_id = $1 AND room_ban.cleared_at IS NULL
        ORDER BY room_ban.created_at DESC`,
      [roomId],
    )
    return result.rows
  }

  async endDueRooms() {
    const instant = this.now()
    const endedRoomIds: string[] = []
    const count = await this.transaction(async (client) => {
      const due = await client.query<{
        id: string
        createdAt: Date
        emptyAt: Date | null
      }>(
        `SELECT id,
                created_at AS "createdAt",
                empty_at AS "emptyAt"
           FROM room
          WHERE ended_at IS NULL
            AND (
              created_at + interval '12 hours' <= $1
              OR (empty_at IS NOT NULL AND empty_at + interval '5 minutes' <= $1)
            )
          ORDER BY id
          FOR UPDATE`,
        [instant],
      )
      for (const room of due.rows) {
        await endRoom(client, room.id, roomEndDeadline(room))
        endedRoomIds.push(room.id)
      }
      return due.rows.length
    })
    for (const roomId of endedRoomIds) {
      this.emitHomeEvent({ type: 'room-ended', roomId })
    }
    return count
  }

  /** Recomputes and broadcasts a room's Home-visible counts. Public because
      stream start/stop changes the Stream count without touching membership. */
  async publishRoomMembership(roomId: string): Promise<void> {
    try {
      const result = await this.configuration.pool.query<{
        memberCount: number
        streamCount: number
        endedAt: Date | null
      }>(
        `SELECT count(DISTINCT membership.id)::int AS "memberCount",
                count(DISTINCT stream.id)::int AS "streamCount",
                max(room.ended_at) AS "endedAt"
           FROM room
           LEFT JOIN room_membership membership
             ON membership.room_id = room.id
            AND membership.left_at IS NULL
           LEFT JOIN stream
             ON stream.room_id = room.id
            AND stream.ended_at IS NULL
          WHERE room.id = $1
          GROUP BY room.id`,
        [roomId],
      )
      const row = result.rows[0]
      if (!row) return
      if (row.endedAt) {
        this.emitHomeEvent({ type: 'room-ended', roomId })
        return
      }
      this.emitHomeEvent({
        type: 'room-membership',
        roomId,
        memberCount: row.memberCount,
        streamCount: row.streamCount,
        state: row.memberCount >= ROOM_CAPACITY ? 'full' : 'live',
      })
    } catch {
      // Projection failures must not turn a committed mutation into a retry.
    }
  }

  private async lockAccount(client: PoolClient, accountId: string) {
    const accounts = await this.lockAccounts(client, [accountId])
    return accounts.has(accountId)
  }

  private async lockAccounts(
    client: PoolClient,
    accountIds: readonly string[],
  ) {
    const ids = [...new Set(accountIds)].sort()
    const accounts = await client.query<{ id: string }>(
      `SELECT id
         FROM "user"
        WHERE id = ANY($1::text[])
        ORDER BY id
        FOR UPDATE`,
      [ids],
    )
    return new Set(accounts.rows.map((account) => account.id))
  }

  private async lockRooms(
    client: PoolClient,
    roomIds: readonly (string | undefined)[],
  ) {
    const ids = [
      ...new Set(roomIds.filter((id): id is string => Boolean(id))),
    ].sort()
    if (ids.length === 0) return
    await client.query(
      `SELECT id
         FROM room
        WHERE id = ANY($1::uuid[])
        ORDER BY id
        FOR UPDATE`,
      [ids],
    )
  }

  private async lockCurrentMembership(
    client: PoolClient,
    accountId: string,
  ) {
    const observed = await this.repository.currentMembership(accountId, client)
    if (!observed) return null
    await this.lockRooms(client, [observed.roomId])
    return this.repository.currentMembership(accountId, client, true)
  }

  private async restriction(
    accountId: string,
    includeRoomCreation: boolean,
    executor: Pool | PoolClient = this.configuration.pool,
  ): Promise<Restriction | 'unauthenticated' | null> {
    const policy = await readAccountAccessPolicy(executor, accountId, this.now())
    if (!policy) return 'unauthenticated'
    if (policy.state === 'pending' || policy.state === 'approved') {
      return 'account-read-only'
    }
    if (policy.sanctionTypes.includes('all_access')) {
      return 'all-access-sanctioned'
    }
    if (includeRoomCreation && policy.sanctionTypes.includes('room_creation')) {
      return 'room-creation-sanctioned'
    }
    return null
  }

  private async sourceConsequences(
    executor: Pool | PoolClient,
    membership: CurrentMembership,
  ): Promise<Consequence[]> {
    const consequences: Consequence[] = []
    if (membership.role === 'host') consequences.push('transfer-host')
    const stream = await executor.query(
      'SELECT 1 FROM stream WHERE membership_id = $1 AND ended_at IS NULL',
      [membership.id],
    )
    if (stream.rows[0]) consequences.push('stop-stream')
    return consequences
  }
  private confirmationKey(token: string) {
    return `${this.configuration.valkeyPrefix}:room-confirmation:${token}`
  }

  private async confirmationRequired(
    accountId: string,
    membership: CurrentMembership,
    consequences: readonly Consequence[],
    command: ConfirmationCommand,
    target: string,
  ): Promise<ConfirmationRequired> {
    const token = randomUUID()
    const issuedAt = this.now()
    await this.configuration.valkey.set(
      this.confirmationKey(token),
      JSON.stringify({
        accountId,
        sourceMembershipId: membership.id,
        consequences,
        command,
        target,
        issuedAt: issuedAt.toISOString(),
      }),
      'PX',
      CONFIRMATION_TTL_MS,
    )
    return {
      status: 'confirmation-required',
      consequences,
      confirmation: {
        token,
        issuedAt,
        command,
        target,
        sourceMembershipId: membership.id,
        consequences,
      },
    }
  }

  private async confirmationMatches(
    accountId: string,
    confirmation: MembershipConfirmation,
    membership: CurrentMembership,
    consequences: readonly Consequence[],
    command: ConfirmationCommand,
    target: string,
  ) {
    if (!confirmation.token) return false
    const raw = await this.configuration.valkey.get(this.confirmationKey(confirmation.token))
    if (!raw) return false
    try {
      const stored = JSON.parse(raw) as {
        accountId?: string
        sourceMembershipId?: string
        consequences?: readonly Consequence[]
        command?: ConfirmationCommand
        target?: string
      }
      return (
        stored.accountId === accountId &&
        stored.sourceMembershipId === membership.id &&
        stored.command === command &&
        stored.target === target &&
        confirmation.command === command &&
        confirmation.target === target &&
        JSON.stringify(stored.consequences) === JSON.stringify(consequences)
      )
    } catch {
      return false
    }
  }

  private async consumeConfirmation(
    accountId: string,
    confirmation: MembershipConfirmation,
    membership: CurrentMembership,
    consequences: readonly Consequence[],
    command: ConfirmationCommand,
    target: string,
  ) {
    if (!confirmation.token) return false
    const key = this.confirmationKey(confirmation.token)
    const raw = await this.configuration.valkey.get(key)
    if (!raw) return false
    try {
      const stored = JSON.parse(raw) as {
        accountId?: string
        sourceMembershipId?: string
        consequences?: readonly Consequence[]
        command?: ConfirmationCommand
        target?: string
      }
      if (
        stored.accountId !== accountId ||
        stored.sourceMembershipId !== membership.id ||
        stored.command !== command ||
        stored.target !== target ||
        confirmation.command !== command ||
        confirmation.target !== target ||
        JSON.stringify(stored.consequences) !== JSON.stringify(consequences)
      ) return false
      const consumed = await this.configuration.valkey.eval(
        "local raw = redis.call('GET', KEYS[1]); if raw == ARGV[1] then redis.call('DEL', KEYS[1]); return 1 end; return 0",
        1,
        key,
        raw,
      )
      return Number(consumed) === 1
    } catch {
      return false
    }
  }

  private async closeRoomIfDue(
    client: PoolClient,
    roomId: string,
    instant: Date,
  ) {
    const room = await this.repository.room(roomId, client, true)
    if (!room || room.endedAt) return true
    const deadline = roomEndDeadline(room)
    if (deadline.getTime() > instant.getTime()) return false
    await endRoom(client, roomId, deadline)
    return true
  }


  private async depart(
    client: PoolClient,
    membership: CurrentMembership,
    instant: Date,
  ): Promise<'active' | 'empty-grace' | 'ended'> {
    const roomResult = await client.query<
      Pick<RoomRecord, 'createdAt' | 'emptyAt' | 'endedAt'>
    >(
      `SELECT created_at AS "createdAt",
              empty_at AS "emptyAt",
              ended_at AS "endedAt"
         FROM room
        WHERE id = $1
        FOR UPDATE`,
      [membership.roomId],
    )
    const room = roomResult.rows[0]
    if (!room || room.endedAt) return 'ended'
    const deadline = roomEndDeadline(room)
    if (deadline.getTime() <= instant.getTime()) {
      await endRoom(client, membership.roomId, deadline)
      return 'ended'
    }
    await client.query(
      `UPDATE stream_subscription
          SET ended_at = $2
        WHERE viewer_membership_id = $1 AND ended_at IS NULL`,
      [membership.id, instant],
    )
    await client.query(
      `UPDATE stream_subscription subscription
          SET ended_at = $2
         FROM stream
        WHERE subscription.stream_id = stream.id
          AND stream.membership_id = $1
          AND subscription.ended_at IS NULL`,
      [membership.id, instant],
    )
    await client.query(
      'UPDATE stream SET ended_at = $2, preview_key = NULL, preview_updated_at = NULL WHERE membership_id = $1 AND ended_at IS NULL',
      [membership.id, instant],
    )
    await client.query(
      'UPDATE room_membership SET left_at = $2 WHERE id = $1 AND left_at IS NULL',
      [membership.id, instant],
    )

    const remaining = await client.query<{ id: string; role: 'host' | 'member' }>(
      `SELECT id, role
         FROM room_membership
        WHERE room_id = $1 AND left_at IS NULL
        ORDER BY joined_at, id
        FOR UPDATE`,
      [membership.roomId],
    )
    if (remaining.rows.length === 0) {
      await client.query('UPDATE room SET empty_at = $2 WHERE id = $1', [
        membership.roomId,
        instant,
      ])
      return 'empty-grace'
    }
    if (membership.role === 'host') {
      await client.query("UPDATE room_membership SET role = 'host' WHERE id = $1", [
        remaining.rows[0].id,
      ])
    }
    return 'active'
  }


  async listAdminLiveRooms(
    actor: PlatformAdminRoomActor,
  ): Promise<ListAdminLiveRoomsResult> {
    if (!actor.isPlatformAdmin) return { status: 'forbidden' }
    const result = await this.configuration.pool.query<AdminLiveRoom>(
      `SELECT room.id,
              room.name,
              room.visibility,
              room.created_at AS "createdAt",
              count(DISTINCT membership.id)::int AS "memberCount",
              count(DISTINCT stream.id)::int AS "streamCount"
         FROM room
         LEFT JOIN room_membership membership
           ON membership.room_id = room.id AND membership.left_at IS NULL
         LEFT JOIN stream
           ON stream.room_id = room.id AND stream.ended_at IS NULL
        WHERE room.ended_at IS NULL
        GROUP BY room.id
        ORDER BY count(DISTINCT membership.id) DESC, room.created_at ASC, room.id ASC`,
    )
    return { status: 'ok', rooms: result.rows }
  }

  async adminEndRoom(
    actor: PlatformAdminRoomActor,
    roomId: string,
  ): Promise<AdminEndRoomResult> {
    if (!actor.isPlatformAdmin) {
      this.emitModerationAudit(
        'room.admin_ended',
        actor.accountId,
        roomId,
        null,
        'forbidden',
      )
      return { status: 'forbidden' }
    }

    const endedAt = this.now()
    const result = await this.transaction(async (client): Promise<AdminEndRoomResult> => {
      const room = await client.query<{ endedAt: Date | null }>(
        `SELECT ended_at AS "endedAt"
           FROM room
          WHERE id = $1
          FOR UPDATE`,
        [roomId],
      )
      if (!room.rows[0]) return { status: 'not-found' }
      if (room.rows[0].endedAt) return { status: 'already-ended' }
      await endRoom(client, roomId, endedAt)
      return { status: 'ended', endedAt }
    })

    this.emitModerationAudit(
      'room.admin_ended',
      actor.accountId,
      roomId,
      null,
      result.status,
    )
    if (result.status === 'ended') {
      this.emitHomeEvent({ type: 'room-ended', roomId })
      try {
        this.configuration.publishRoomEvent?.({ type: 'room-ended', roomId })
      } catch {
        // The committed end remains authoritative; clients also refresh on reconnect.
      }
    }
    return result
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.configuration.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await work(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

function membershipProjection(membership: CurrentMembership): MembershipProjection {
  return {
    id: membership.id,
    roomId: membership.roomId,
    accountId: membership.accountId,
    role: membership.role,
    joinedAt: membership.joinedAt,
  }
}

function roomProjection(room: RoomRecord): RoomProjection {
  return {
    id: room.id,
    name: room.name,
    category: room.category,
    description: room.description,
    tags: room.tags,
    visibility: room.visibility,
    createdAt: room.createdAt,
    expiresAt: new Date(room.createdAt.getTime() + ROOM_LIFETIME_MS),
  }
}

function roomExpired(room: RoomRecord, instant: Date) {
  return room.createdAt.getTime() + ROOM_LIFETIME_MS <= instant.getTime()
}

function emptyGraceExpired(room: RoomRecord, instant: Date) {
  return (
    room.emptyAt !== null &&
    room.emptyAt.getTime() + EMPTY_GRACE_MS <= instant.getTime()
  )
}

async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const key = (await deriveKey(password, salt, 32)) as Buffer
  return `scrypt:${salt.toString('base64url')}:${key.toString('base64url')}`
}

async function passwordMatches(password: string, stored: string) {
  const [algorithm, encodedSalt, encodedKey] = stored.split(':')
  if (algorithm !== 'scrypt' || !encodedSalt || !encodedKey) return false
  const expected = Buffer.from(encodedKey, 'base64url')
  const actual = (await deriveKey(
    password,
    Buffer.from(encodedSalt, 'base64url'),
    expected.length,
  )) as Buffer
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function writeRoomModerationAudit(entry: RoomModerationAuditEntry) {
  console.info(JSON.stringify(entry))
}
