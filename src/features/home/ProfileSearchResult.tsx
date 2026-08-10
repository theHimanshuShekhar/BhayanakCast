import { useId } from 'react'
import { observeHome } from './home-observability'
import type { PublicProfileSummary } from './home-types'

export function ProfileSearchResult({
  profile,
}: Readonly<{ profile: PublicProfileSummary }>) {
  const accessibleDescriptionId = useId()
  return (
    <li className="profile-search-result">
      <a
        aria-describedby={accessibleDescriptionId}
        aria-label={`Open ${profile.displayName} public profile`}
        href={`/users/${encodeURIComponent(profile.accountId)}`}
        onClick={() => observeHome({
          name: 'home_profile_opened',
          properties: {},
        })}
      >
        <span className="visually-hidden" id={accessibleDescriptionId}>
          {profile.roomCount} {profile.roomCount === 1 ? 'room' : 'rooms'} hosted.{' '}
          {profile.streamCount} {profile.streamCount === 1 ? 'screen' : 'screens'} shared.
          {profile.pastStreams.length > 0
            ? ` Recent rooms: ${profile.pastStreams.slice(0, 3).map((stream) => stream.name).join(', ')}.`
            : ''}
          {profile.coUsers.length > 0
            ? ` Often shares rooms with ${profile.coUsers.length} people.`
            : ''}
        </span>
        <div className="profile-search-result__identity">
          {profile.avatarUrl ? (
            <img alt="" decoding="async" loading="lazy" src={profile.avatarUrl} />
          ) : (
            <span aria-hidden="true" className="profile-search-result__avatar-fallback">
              {profile.displayName.slice(0, 1).toLocaleUpperCase()}
            </span>
          )}
          <div>
            <h3>{profile.displayName}</h3>
            <p className="tabular-nums">
              {profile.roomCount} {profile.roomCount === 1 ? 'room' : 'rooms'} hosted ·{' '}
              {profile.streamCount} {profile.streamCount === 1 ? 'screen' : 'screens'} shared
            </p>
          </div>
        </div>

        {profile.pastStreams.length > 0 && (
          <div className="profile-search-result__context">
            <h4>Recent rooms</h4>
            <ul>
              {profile.pastStreams.slice(0, 3).map((stream) => (
                <li key={stream.roomId}>{stream.name}</li>
              ))}
            </ul>
          </div>
        )}
        {profile.coUsers.length > 0 && (
          <div className="profile-search-result__context">
            <h4>Often shares rooms with</h4>
            <div
              aria-label={`${profile.coUsers.length} frequent co-users`}
              className="profile-search-result__co-users"
            >
              {profile.coUsers.slice(0, 3).map((coUser) =>
                coUser.avatarUrl ? (
                  <img
                    alt=""
                    decoding="async"
                    key={coUser.accountId}
                    loading="lazy"
                    src={coUser.avatarUrl}
                  />
                ) : (
                  <span aria-hidden="true" key={coUser.accountId} />
                ),
              )}
            </div>
          </div>
        )}
        <span aria-hidden="true" className="profile-search-result__open">
          View profile <span>→</span>
        </span>
      </a>
    </li>
  )
}
