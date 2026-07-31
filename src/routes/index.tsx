import { createFileRoute } from '@tanstack/react-router'
import { HomePage } from '../features/home/HomePage'
import {
  connectedPresenceQueryOptions,
  homeFacetsQueryOptions,
  homeProfilesQueryOptions,
  homeRoomsQueryOptions,
  homeStatisticsQueryOptions,
  pastStreamsQueryOptions,
} from '../features/home/home-queries'
import { parseHomeSearch } from '../features/home/home-search'
import { getRouteSession } from '../server/auth/session-fn'

export const Route = createFileRoute('/')({
  validateSearch: parseHomeSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps, abortController, cause }) => {
    const rooms = homeRoomsQueryOptions(deps)
    const profiles = homeProfilesQueryOptions(deps.q)
    const pastStreams = pastStreamsQueryOptions(!deps.q)
    const cancel = () => {
      void context.queryClient.cancelQueries({ queryKey: rooms.queryKey, exact: true })
      void context.queryClient.cancelQueries({
        queryKey: deps.q ? profiles.queryKey : pastStreams.queryKey,
        exact: true,
      })
    }
    abortController.signal.addEventListener('abort', cancel, { once: true })
    const session = getRouteSession()
    const critical = Promise.allSettled(
      deps.q
        ? [
            context.queryClient.ensureQueryData(rooms),
            context.queryClient.ensureQueryData(profiles),
          ]
        : [
            context.queryClient.ensureQueryData(rooms),
            context.queryClient.ensureQueryData(pastStreams),
          ],
    )
    const cleanup = () => {
      abortController.signal.removeEventListener('abort', cancel)
    }

    void Promise.all([
      context.queryClient.prefetchQuery(homeFacetsQueryOptions()),
      context.queryClient.prefetchQuery(homeStatisticsQueryOptions()),
      context.queryClient.prefetchQuery(connectedPresenceQueryOptions()),
    ])
    if (cause === 'stay') {
      void critical.then(cleanup)
      return { session: await session }
    }
    await critical
    cleanup()
    return { session: await session }
  },
  component: Home,
})

function Home() {
  const search = Route.useSearch()
  const { session } = Route.useLoaderData()
  return <HomePage search={search} session={session} />
}
