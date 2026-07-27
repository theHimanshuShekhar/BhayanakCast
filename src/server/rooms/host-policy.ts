export interface HostCandidate {
  readonly id: string
  readonly joinedAt: Date
}

export function selectNextHost(candidates: readonly HostCandidate[]): string | null {
  let selected: HostCandidate | undefined
  for (const candidate of candidates) {
    if (
      !selected ||
      candidate.joinedAt.getTime() < selected.joinedAt.getTime() ||
      (candidate.joinedAt.getTime() === selected.joinedAt.getTime() &&
        candidate.id.localeCompare(selected.id) < 0)
    ) {
      selected = candidate
    }
  }
  return selected?.id ?? null
}
