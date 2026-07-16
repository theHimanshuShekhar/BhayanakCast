import type { HomeSearch } from './home-types'

export interface RoomSearchCandidate {
  readonly id: string
  readonly name: string
  readonly category: string | null
  readonly tags: readonly string[]
  readonly memberCount: number
  readonly streamCount: number
  readonly activityAt: string
}

export interface ProfileSearchCandidate {
  readonly accountId: string
  readonly displayName: string
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const QUERY_MAX_LENGTH = 80
const CATEGORY_MAX_LENGTH = 32
const TAG_MAX_LENGTH = 24
const TAG_MAX_COUNT = 5

export function normalizeHomeValue(value: string): string {
  return value.normalize('NFKC').trim()
}

export function parseHomeSearch(value: unknown): HomeSearch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const q = normalizeBoundedOptionalString(source.q, QUERY_MAX_LENGTH)
  const category = normalizeBoundedOptionalString(source.category, CATEGORY_MAX_LENGTH)
  const rawTags = Array.isArray(source.tags)
    ? source.tags
    : typeof source.tags === 'string'
      ? [source.tags]
      : []
  const tags = [
    ...new Set(
      rawTags
        .filter(isString)
        .map(normalizeHomeValue)
        .filter((tag) => tag.length > 0 && visibleLength(tag) <= TAG_MAX_LENGTH),
    ),
  ]
    .sort(compareText)
    .slice(0, TAG_MAX_COUNT)
  return {
    ...(q && { q }),
    ...(category && { category }),
    ...(tags.length > 0 && { tags }),
  }
}

export const canonicalHomeSearch = (value: HomeSearch): HomeSearch => parseHomeSearch(value)

export function rankRooms<T extends RoomSearchCandidate>(
  rooms: readonly T[],
  search: HomeSearch,
): T[] {
  const canonical = canonicalHomeSearch(search)
  const query = canonical.q?.toLocaleLowerCase()
  const filtered = rooms.filter(
    (room) =>
      (!canonical.category || room.category === canonical.category) &&
      (!canonical.tags || canonical.tags.every((tag) => room.tags.includes(tag))),
  )
  return filtered
    .map((room) => ({ room, relevance: roomRelevance(room, query) }))
    .filter(({ relevance }) => relevance !== null)
    .sort((left, right) => {
      const relevance = left.relevance! - right.relevance!
      if (relevance) return relevance
      return compareRoomRank(left.room, right.room)
    })
    .map(({ room }) => room)
}

export function rankProfiles<T extends ProfileSearchCandidate>(
  profiles: readonly T[],
  search: HomeSearch,
): T[] {
  const query = canonicalHomeSearch(search).q?.toLocaleLowerCase()
  return profiles
    .map((profile) => ({
      profile,
      relevance: textRelevance(profile.displayName, query),
    }))
    .filter(({ relevance }) => relevance !== null)
    .sort((left, right) => {
      const relevance = left.relevance! - right.relevance!
      if (relevance) return relevance
      const name = compareText(
        normalizeHomeValue(left.profile.displayName).toLocaleLowerCase(),
        normalizeHomeValue(right.profile.displayName).toLocaleLowerCase(),
      )
      return name || left.profile.accountId.localeCompare(right.profile.accountId)
    })
    .map(({ profile }) => profile)
}

function roomRelevance(room: RoomSearchCandidate, query: string | undefined) {
  if (!query) return 0
  const name = textRelevance(room.name, query)
  if (name !== null && name < 3) return name
  const attributes = [room.category ?? '', ...room.tags]
  if (attributes.some((value) => {
    const relevance = textRelevance(value, query)
    return relevance !== null && relevance < 3
  })) return 3
  return name === 3 || attributes.some((value) => textRelevance(value, query) === 3)
    ? 4
    : null
}

function textRelevance(value: string, query: string | undefined) {
  if (!query) return 0
  const normalized = normalizeHomeValue(value).toLocaleLowerCase()
  if (normalized === query) return 0
  if (normalized.startsWith(query)) return 1
  if (normalized.includes(query)) return 2
  if (visibleLength(query) < 3) return null
  const threshold = Math.max(1, Math.floor(visibleLength(query) / 4))
  return normalized.split(/\s+/).some(
    (word) => damerauLevenshtein(word, query) <= threshold,
  )
    ? 3
    : null
}

function compareRoomRank(left: RoomSearchCandidate, right: RoomSearchCandidate) {
  return (
    right.memberCount - left.memberCount ||
    right.streamCount - left.streamCount ||
    right.activityAt.localeCompare(left.activityAt) ||
    left.id.localeCompare(right.id)
  )
}

function damerauLevenshtein(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  const current = new Array<number>(right.length + 1)
  const beforePrevious = new Array<number>(right.length + 1)
  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        previous[column]! + 1,
        current[column - 1]! + 1,
        previous[column - 1]! + Number(left[row - 1] !== right[column - 1]),
        row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]
          ? beforePrevious[column - 2]! + 1
          : Number.POSITIVE_INFINITY,
      )
    }
    beforePrevious.splice(0, beforePrevious.length, ...previous)
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]!
}

function normalizeBoundedOptionalString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined
  const normalized = normalizeHomeValue(value)
  return visibleLength(normalized) <= maxLength ? normalized : undefined
}

function visibleLength(value: string) {
  return [...segmenter.segment(value)].length
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

