import { createFileRoute, notFound } from '@tanstack/react-router'
import { PublicProfilePage } from '../../features/public-profile/PublicProfilePage'
import { publicProfileQueryOptions } from '../../features/public-profile/public-profile-queries'

export const Route = createFileRoute('/users/$userId')({
  loader: async ({ context, params, abortController }) => {
    const profileQuery = publicProfileQueryOptions(params.userId)
    const cancel = () => {
      void context.queryClient.cancelQueries({
        queryKey: profileQuery.queryKey,
        exact: true,
      })
    }
    abortController.signal.addEventListener('abort', cancel, { once: true })
    try {
      const profile = await context.queryClient.ensureQueryData(profileQuery)
      if (!profile) throw notFound()
      return profile
    } finally {
      abortController.signal.removeEventListener('abort', cancel)
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.displayName} | BhayanakCast`
          : 'Profile not found | BhayanakCast',
      },
      {
        name: 'description',
        content: loaderData
          ? `${loaderData.displayName}'s public profile on BhayanakCast.`
          : 'The requested BhayanakCast public profile does not exist.',
      },
    ],
  }),
  component: PublicProfile,
  notFoundComponent: ProfileNotFound,
})

function PublicProfile() {
  return <PublicProfilePage profile={Route.useLoaderData()} />
}

function ProfileNotFound() {
  return (
    <main>
      <h1>Profile not found</h1>
      <p>The requested public profile does not exist.</p>
    </main>
  )
}
