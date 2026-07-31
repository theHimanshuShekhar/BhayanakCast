import { createFileRoute } from '@tanstack/react-router'
import { ProfilePage } from '../features/profile/ProfilePage'
import { publicProfileQueryOptions } from '../features/public-profile/public-profile-queries'
import { getRouteSession } from '../server/auth/session-fn'

export const Route = createFileRoute('/profile')({
  loader: async ({ context, abortController }) => {
    const session = await getRouteSession()
    if (!session) return { profile: null, session: null }

    const profileQuery = publicProfileQueryOptions(session.id)
    const cancel = () => {
      void context.queryClient.cancelQueries({
        queryKey: profileQuery.queryKey,
        exact: true,
      })
    }
    abortController.signal.addEventListener('abort', cancel, { once: true })
    try {
      const profile = await context.queryClient.ensureQueryData(profileQuery)
      return { profile, session }
    } finally {
      abortController.signal.removeEventListener('abort', cancel)
    }
  },
  head: () => ({
    meta: [
      { title: 'Profile | BhayanakCast' },
      { name: 'robots', content: 'noindex, nofollow, noarchive' },
      {
        name: 'description',
        content: 'Manage your BhayanakCast profile and account access.',
      },
    ],
  }),
  component: Profile,
})

function Profile() {
  const { profile, session } = Route.useLoaderData()
  return <ProfilePage profile={profile} session={session} />
}
