import { queryOptions } from '@tanstack/react-query'
import { getPublicProfile } from '../../server/home/home-functions'

const MINUTE = 60_000

export const publicProfileQueryKeys = {
  detail: (accountId: string) => ['public-profile', accountId] as const,
}

export function publicProfileQueryOptions(accountId: string) {
  return queryOptions({
    queryKey: publicProfileQueryKeys.detail(accountId),
    queryFn: ({ signal }) => getPublicProfile({ data: { accountId }, signal }),
    staleTime: MINUTE,
    gcTime: 10 * MINUTE,
  })
}
