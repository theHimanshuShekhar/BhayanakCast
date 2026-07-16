export interface HomeSearch {
  readonly q?: string
  readonly category?: string
  readonly tags?: readonly string[]
}

export interface StreamPreview {
  readonly previewKey: string
  readonly updatedAt: string
}

export interface ActiveRoomSummary {
  readonly id: string
  readonly name: string
  readonly category: string | null
  readonly tags: readonly string[]
  readonly visibility: 'public' | 'private'
  readonly memberCount: number
  readonly streamCount: number
  readonly state: 'live' | 'full'
  readonly previews: readonly StreamPreview[]
  readonly memberAvatars: readonly string[]
}

export interface PastStreamSummary {
  readonly roomId: string
  readonly name: string
  readonly endedAt: string
  readonly visibility: 'public' | 'private'
  readonly category: string | null
  readonly tags: readonly string[]
  readonly memberCount: number
  readonly streamCount: number
}

export interface CoUserSummary {
  readonly accountId: string
  readonly avatarUrl: string | null
}

export interface PublicProfileSummary {
  readonly accountId: string
  readonly displayName: string
  readonly avatarUrl: string | null
  readonly roomCount: number
  readonly streamCount: number
  readonly pastStreams: readonly PastStreamSummary[]
  readonly coUsers: readonly CoUserSummary[]
}

export interface Facet {
  readonly value: string
  readonly count: number
}

export interface HomeFacets {
  readonly categories: readonly Facet[]
  readonly tags: readonly Facet[]
}

export interface HomeStatistics {
  readonly activeRoomCount: number
  readonly activeStreamCount: number
  readonly currentMembershipCount: number
  readonly roomsCreatedToday: number
  readonly peakConnectedAccountCount: number
}

export interface ConnectedPresence {
  readonly connectedAccountCount: number
}
