import type { SessionProjection } from '../auth/auth-client'
import { SignInButton } from '../auth/SignInButton'
import type { PublicProfileSummary } from '../home/home-types'
import { ProfileOverview } from './ProfileOverview'

interface ProfilePageProps {
  readonly profile: PublicProfileSummary | null
  readonly session: SessionProjection | null
}

export function ProfilePage({ profile, session }: ProfilePageProps) {
  if (session) return <ProfileOverview profile={profile} session={session} />

  return (
    <main aria-labelledby="profile-heading" className="public-profile">
      <a className="public-profile__home" href="/">
        <span aria-hidden="true">←</span> Back to Home
      </a>
      <header className="public-profile__header">
        <h1 id="profile-heading">Profile</h1>
        <p>Sign in to see your public activity and account details.</p>
        <SignInButton callbackURL="/profile" label="Continue with Discord" />
      </header>
    </main>
  )
}
