export type RoomVisibility = 'public' | 'private'

export interface RoomInput {
  name: string
  category?: string | null
  tags?: readonly string[] | null
  visibility?: RoomVisibility
  password?: string | null
}

export interface NormalizedRoomInput {
  name: string
  category?: string
  tags: string[]
  visibility: RoomVisibility
  password?: string
}

export type RoomInputErrorCode =
  | 'ROOM_NAME_LENGTH'
  | 'ROOM_CATEGORY_LENGTH'
  | 'ROOM_TAG_COUNT'
  | 'ROOM_TAG_LENGTH'
  | 'ROOM_PASSWORD_LENGTH'

export class RoomInputError extends Error {
  constructor(readonly code: RoomInputErrorCode) {
    super(code)
    this.name = 'RoomInputError'
  }
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const normalizeText = (value: string) => value.normalize('NFKC').trim()

const visibleCharacterCount = (value: string) =>
  Array.from(graphemeSegmenter.segment(value)).length

const assertVisibleLength = (
  value: string,
  min: number,
  max: number,
  code: RoomInputErrorCode,
) => {
  const length = visibleCharacterCount(value)
  if (length < min || length > max) throw new RoomInputError(code)
}

export const normalizeRoomInput = (input: RoomInput): NormalizedRoomInput => {
  const name = normalizeText(input.name)
  assertVisibleLength(name, 3, 80, 'ROOM_NAME_LENGTH')

  const category = input.category == null ? undefined : normalizeText(input.category)
  if (category) assertVisibleLength(category, 0, 32, 'ROOM_CATEGORY_LENGTH')

  const tags = [
    ...new Set((input.tags ?? []).map(normalizeText).filter((tag) => tag.length > 0)),
  ]
  if (tags.length > 5) throw new RoomInputError('ROOM_TAG_COUNT')
  for (const tag of tags) {
    assertVisibleLength(tag, 0, 24, 'ROOM_TAG_LENGTH')
  }

  const visibility = input.visibility ?? 'public'
  if (visibility === 'public') return { name, ...(category && { category }), tags, visibility }

  const password = input.password ?? ''
  assertVisibleLength(password, 8, Number.POSITIVE_INFINITY, 'ROOM_PASSWORD_LENGTH')
  return { name, ...(category && { category }), tags, visibility, password }
}
