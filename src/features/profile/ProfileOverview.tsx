import { PastStreams } from '../home/PastStreams'
import type { PublicProfileSummary } from '../home/home-types'
import type { SessionProjection } from '../auth/auth-client'
import { ThemePreference } from './ThemePreference'
import { MutedAccounts } from './MutedAccounts'

interface ProfileOverviewProps {
  readonly profile: PublicProfileSummary | null
  readonly session: SessionProjection
}

export function ProfileOverview({ profile, session }: ProfileOverviewProps) {
  const coUserAvatars = profile?.coUsers.filter(({ avatarUrl }) => avatarUrl !== null) ?? []

  return (
    <main aria-labelledby="profile-heading" className="public-profile">
      <a className="public-profile__home" href="/">
        <span aria-hidden="true">←</span> Home
      </a>
      <header className="public-profile__header">
        <h1 id="profile-heading">Profile</h1>
        <div className="public-profile__identity">
          {session.avatar ? (
            <img
              alt={session.displayName}
              height="96"
              src={session.avatar}
              width="96"
            />
          ) : (
            <span aria-hidden="true" className="public-profile__avatar-fallback">
              {session.displayName.slice(0, 1).toLocaleUpperCase()}
            </span>
          )}
          <div>
            <p>Current Account</p>
            <h2>{session.displayName}</h2>
          </div>
        </div>
      </header>

      <section aria-labelledby="public-activity-heading">
        <div className="home-section-heading">
          <h2 id="public-activity-heading">Public activity</h2>
          <p>Activity visible on your public profile</p>
        </div>
        {profile ? (
          <>
            <dl className="public-profile__metrics">
              <div>
                <dt>Past rooms</dt>
                <dd>{countLabel(profile.roomCount, 'room')}</dd>
              </div>
              <div>
                <dt>Past streams</dt>
                <dd>{countLabel(profile.streamCount, 'stream')}</dd>
              </div>
            </dl>
            <PastStreams streams={profile.pastStreams} />
            {coUserAvatars.length > 0 && (
              <section
                aria-labelledby="profile-co-users-heading"
                className="public-profile__co-users"
              >
                <div className="home-section-heading">
                  <h2 id="profile-co-users-heading">People who shared rooms</h2>
                  <p>Frequent co-members</p>
                </div>
                <ul>
                  {coUserAvatars.map(({ accountId, avatarUrl }) => (
                    <li key={accountId}>
                      <a
                        aria-label="Open co-user public profile"
                        href={`/users/${encodeURIComponent(accountId)}`}
                      >
                        <img
                          alt="Co-user avatar"
                          height="48"
                          src={avatarUrl!}
                          width="48"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : (
          <p>Public activity is not available right now.</p>
        )}
      </section>
      <ThemePreference />
      <MutedAccounts />
    </main>
  )
}

function countLabel(count: number, noun: string) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}
