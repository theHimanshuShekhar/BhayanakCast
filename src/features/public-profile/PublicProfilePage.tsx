import { PastStreams } from '../home/PastStreams'
import type { PublicProfileSummary } from '../home/home-types'


interface PublicProfilePageProps {
  readonly profile: PublicProfileSummary
}
export function PublicProfilePage({ profile }: PublicProfilePageProps) {
  const coUserAvatars = profile.coUsers.filter(({ avatarUrl }) => avatarUrl !== null)

  return (
    <main aria-labelledby="public-profile-name" className="public-profile">
      <a className="public-profile__home" href="/">
        <span aria-hidden="true">←</span> Home
      </a>
      <header className="public-profile__header">
        <div className="public-profile__identity">
          {profile.avatarUrl ? (
            <img
              alt={profile.displayName}
              height="96"
              src={profile.avatarUrl}
              width="96"
            />
          ) : (
            <span aria-hidden="true" className="public-profile__avatar-fallback">
              {profile.displayName.slice(0, 1).toLocaleUpperCase()}
            </span>
          )}
          <div>
            <p>Public profile</p>
            <h1 id="public-profile-name">{profile.displayName}</h1>
          </div>
        </div>
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
      </header>

      {profile.pastStreams.length > 0 && (
        <PastStreams streams={profile.pastStreams} />
      )}
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
    </main>
  )
}


function countLabel(count: number, noun: string) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}
