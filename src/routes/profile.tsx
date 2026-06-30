import type { ReactNode } from 'react'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createFileRoute } from '@tanstack/react-router'
import { Clock, Radio, UserRound, UsersRound } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { auth } from '#/lib/auth'
import { getPublicProfile } from '#/lib/aggregates'

const loadOwnProfile = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequest().headers })
  if (!session) return { authenticated: false, profile: null }

  return {
    authenticated: true,
    profile: await getPublicProfile(session.user.id),
  }
})

export const Route = createFileRoute('/profile')({
  loader: () => loadOwnProfile(),
  component: ProfilePage,
})

function ProfilePage() {
  const profileState = Route.useLoaderData()
  if (!profileState.authenticated) return <AuthRequiredState />

  const profile = profileState.profile
  if (!profile) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-8 py-8 text-white">
        <section className="profile-banner rounded-3xl border border-white/10 bg-white/4 p-8 shadow-2xl shadow-violet-950/20 backdrop-blur">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-violet-300/70">
            public watch history
          </p>
          <h1 className="mt-2 font-mono text-3xl font-semibold">
            Profile unavailable
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-400">
            Sign in to view your public aggregate projection.
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-8 py-8">
      <section className="profile-banner overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_20%_0%,rgba(168,85,247,0.35),transparent_38%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(49,46,129,0.82))] p-8 text-white shadow-2xl shadow-violet-950/20 backdrop-blur">
        <div className="flex flex-wrap items-end gap-5">
          <img
            src={
              profile.user.image ??
              `https://api.dicebear.com/9.x/initials/svg?seed=${profile.user.id}`
            }
            alt=""
            className="h-24 w-24 rounded-3xl border border-white/20 bg-white/10"
          />
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-violet-200/80">
              public watch history
            </p>
            <h1 className="mt-2 font-mono text-4xl font-semibold">
              {profile.user.name}
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Discord user · joined aggregate projection
            </p>
            <p className="mt-2 font-mono text-xs text-slate-400">
              Freshness:{' '}
              {profile.lastUpdatedAt
                ? profile.lastUpdatedAt.toISOString()
                : 'not computed yet'}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-5">
        <Metric
          icon={<Radio className="h-4 w-4" />}
          label="Streams hosted"
          value={String(profile.facts.roomsHosted)}
        />
        <Metric
          icon={<UsersRound className="h-4 w-4" />}
          label="Rooms joined"
          value={String(profile.facts.roomsJoined)}
        />
        <Metric
          icon={<Clock className="h-4 w-4" />}
          label="Hours watched"
          value={String(Math.round(profile.facts.watchedSeconds / 3600))}
        />
        <Metric
          icon={<UsersRound className="h-4 w-4" />}
          label="Peak viewers"
          value={String(profile.facts.peakViewers)}
        />
        <Metric
          icon={<UserRound className="h-4 w-4" />}
          label="Reports made"
          value={String(profile.facts.reportsCreated)}
        />
      </div>

      <Card className="border-white/10 bg-white/5 text-white">
        <CardHeader>
          <CardTitle>Top co-users</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-400">
          {profile.topCoUsers.length === 0 ? (
            <div className="flex items-center justify-between gap-3">
              <span>No co-user aggregate rows yet.</span>
              <progress value={0} max={100} className="h-2 w-40" />
            </div>
          ) : (
            profile.topCoUsers.map((coUser) => (
              <div
                key={coUser.user.id}
                className="flex items-center justify-between gap-3"
              >
                <span>{coUser.user.name}</span>
                <progress
                  value={coUser.roomsTogether}
                  max={Math.max(1, profile.facts.roomsJoined)}
                  className="h-2 w-40"
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function AuthRequiredState() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-16 text-white">
      <p className="font-mono text-xs uppercase tracking-[0.24em] text-violet-300/70">
        public watch history
      </p>
      <h1 className="mt-2 font-mono text-3xl font-semibold">
        Sign in to view your profile
      </h1>
      <p className="mt-3 text-sm text-slate-400">
        Continue with Discord before opening your aggregate profile page.
      </p>
    </div>
  )
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <Card className="border-white/10 bg-white/5 text-white transition duration-300 hover:-translate-y-0.5 hover:bg-white/8">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xs text-slate-300">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="font-mono text-2xl font-semibold">
        {value}
      </CardContent>
    </Card>
  )
}
