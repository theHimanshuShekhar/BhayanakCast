interface SkeletonProps { readonly label?: string }

export function HomeRoomsSkeleton({ label = 'Loading live rooms' }: SkeletonProps) {
  return <div aria-busy="true" aria-label={label} className="home-section-skeleton home-rooms-skeleton"><i /><i /><i /></div>
}

export function HomePastStreamsSkeleton() {
  return <div aria-busy="true" aria-label="Loading past streams" className="home-section-skeleton home-past-streams-skeleton"><i /><i /><i /><i /></div>
}

export function HomeMetricsSkeleton({ label = 'Loading home statistics' }: SkeletonProps) {
  return <div aria-busy="true" aria-label={label} className="home-section-skeleton home-metrics-skeleton"><i /><i /></div>
}
