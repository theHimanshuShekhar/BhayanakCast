import type { QueryKey } from '@tanstack/react-query'
import { SiDiscord } from '@icons-pack/react-simple-icons'
import { SignInButton } from '../auth/SignInButton'
import type { SessionProjection } from '../auth/auth-client'
import { CreateRoomButton } from './HomeNavigation'
import { HomeSectionBoundary } from './HomeSectionBoundary'
import { HomeMetricsSkeleton } from './HomeSectionSkeletons'
import type { ConnectedPresence, HomeStatistics } from './home-types'

interface HomeRailProps {
  readonly session: SessionProjection | null
  readonly hasActiveSearch: boolean
  readonly statistics: HomeStatistics | undefined
  readonly statisticsPending: boolean
  readonly statisticsFailed: boolean
  readonly statisticsQueryKey: QueryKey
  readonly presence: ConnectedPresence | undefined
}

/** The wide-stage companion column: who is here, how the clubhouse is doing,
    and a way in that never scrolls away.

    One element at every width rather than a second copy of the same numbers.
    Below 1280px the rail is `display: contents`, so the statistics fall back
    into the centre column exactly where they have always been, and the two
    cards that only make sense beside the centre are `display: none` — which
    takes them out of the accessibility tree with the layout. */
export function HomeRail({
  session,
  hasActiveSearch,
  statistics,
  statisticsPending,
  statisticsFailed,
  statisticsQueryKey,
  presence,
}: HomeRailProps) {
  return (
    <aside aria-label="Clubhouse activity" className="home-rail" data-testid="home-rail">
      {/* Searching turns the page into results: the counter in the masthead
          takes the headline back to report matches, and the statistics — which
          describe everything rather than the query — stand down with it. */}
      {!hasActiveSearch && (
        <>
          <PresenceCard presence={presence} />

          <HomeSectionBoundary
            failed={statisticsFailed}
            label="Statistics"
            pending={statisticsPending && !statistics}
            queryKey={statisticsQueryKey}
            skeleton={<HomeMetricsSkeleton label="Loading statistics" />}
          >
            <StatisticsStrip statistics={statistics} />
          </HomeSectionBoundary>
        </>
      )}

      <CreateRoomCard session={session} />
    </aside>
  )
}

/** The number the masthead headline carries, at rail scale. Exactly one of the
    two is drawn: the headline goes `display: none` on the wide stage while this
    card stands in, so the page keeps one h1 and one live count. The masthead
    boundary still owns the query's pending and failed states — this card only
    ever draws a number, or a dash before one arrives. */
function PresenceCard({ presence }: Readonly<{ presence: ConnectedPresence | undefined }>) {
  const connected = presence?.connectedCount
  return (
    <section aria-label="Right now" className="home-rail-card home-rail-presence">
      <p className="home-counter__eyebrow">
        <span aria-hidden="true" className="home-pulse-dot" />
        Right now
      </p>
      <h1 className="home-rail-presence__value">
        <span className="tabular-nums">{connected ?? '—'}</span>{' '}
        <span className="home-rail-presence__unit">
          {connected === 1 ? 'person in the clubhouse' : 'people in the clubhouse'}
        </span>
      </h1>
    </section>
  )
}

/** A standing way in. For an anonymous visitor the door is Discord, because
    there is no room to open until they are through it. */
function CreateRoomCard({ session }: Readonly<{ session: SessionProjection | null }>) {
  return (
    <section
      aria-label={session ? 'Open a room' : 'Join the clubhouse'}
      className="home-rail-card home-rail-cta"
    >
      <h2>{session ? 'Open a room' : 'Join the clubhouse'}</h2>
      <p>
        {session
          ? 'Share a screen and whoever is around can sit in. Name it, pick who gets in, done.'
          : 'Browse every public room without an account. Signing in is what lets you join one or open your own.'}
      </p>
      {session ? (
        <CreateRoomButton className="home-rail-cta__action" label="Open a room" />
      ) : (
        // Named apart from the navigation's `Continue with Discord`: two
        // controls carrying one accessible name is two identical rows in the
        // keyboard and screen-reader list with nothing to tell them apart.
        <SignInButton
          ariaLabel="Sign in with Discord"
          className="home-rail-cta__action home-rail-cta__action--brand"
          icon={<SiDiscord aria-hidden="true" title="" />}
          label="Sign in with Discord"
        />
      )}
    </section>
  )
}

/** Five cells, always open. A disclosure here hid the only numbers that told a
    visitor whether the clubhouse was worth staying in.

    Below 768px those cells cost a third of the viewport on the one page whose
    job is showing rooms, so the phone gets the same five numbers as a sentence
    instead. Exactly one of the two forms is rendered at a time — the other is
    `display: none`, so it leaves the accessibility tree with it. */
function StatisticsStrip({
  statistics,
}: Readonly<{ statistics: HomeStatistics | undefined }>) {
  return (
    <section aria-label="Statistics" className="home-statistics" data-testid="home-statistics">
      <h2 className="visually-hidden">Statistics</h2>
      <p className="home-statistics__line">
        <Count value={statistics?.activeRoomCount} one="room live" many="rooms live" />,{' '}
        <Count
          value={statistics?.activeStreamCount}
          one="screen shared"
          many="screens shared"
        />, and{' '}
        <Count
          value={statistics?.currentMembershipCount}
          one="person sitting in"
          many="people sitting in"
        />
        . <Count value={statistics?.roomsCreatedToday} one="room" many="rooms" /> opened
        today, <Count
          value={statistics?.peakConnectedCount}
          one="person"
          many="people"
        />{' '}
        here at peak.
      </p>
      <dl>
        <Metric label="rooms live" value={statistics?.activeRoomCount} />
        <Metric label="screens shared" value={statistics?.activeStreamCount} />
        <Metric label="sitting in rooms" value={statistics?.currentMembershipCount} />
        <Metric label="opened today" value={statistics?.roomsCreatedToday} />
        <Metric label="peak today" value={statistics?.peakConnectedCount} />
      </dl>
    </section>
  )
}

/** A missing count reads as an em dash and keeps the plural noun: the sentence
    stays grammatical before the statistics query lands. */
function Count({
  value,
  one,
  many,
}: Readonly<{ value: number | undefined; one: string; many: string }>) {
  return (
    <>
      <span className="tabular-nums">{value ?? '—'}</span> {value === 1 ? one : many}
    </>
  )
}

function Metric({ label, value }: Readonly<{ label: string; value: number | undefined }>) {
  return (
    // Value renders above the label; the DOM keeps dt-then-dd because a dl
    // group is only valid in that order.
    <div className="home-statistics__cell">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value ?? '—'}</dd>
    </div>
  )
}
