import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createFileRoute } from '@tanstack/react-router'
import { auth } from '#/lib/auth'
import { getAdminMetrics } from '#/lib/aggregates'
import { isPlatformAdminUser } from '#/lib/admin'

const loadAdminState = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequest().headers })
  const allowlist = (process.env.ADMIN_DISCORD_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  const allowed = await isPlatformAdminUser(session?.user.id, allowlist)
  return { allowed, metrics: allowed ? await getAdminMetrics() : null }
})

export const Route = createFileRoute('/admin')({
  loader: () => loadAdminState(),
  component: AdminPage,
})

function AdminPage() {
  const admin = Route.useLoaderData()

  if (!admin.allowed) {
    return (
      <div className="min-h-screen bg-[#080d18] px-8 py-16 text-white">
        <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">
          /admin
        </p>
        <h1 className="mt-2 text-3xl font-black">Admin access required</h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-400">
          Sign in with an allowlisted Discord account view reports, sanctions,
          metrics.
        </p>
      </div>
    )
  }

  const metrics = admin.metrics
  const totals = [
    ['Total users', metrics?.totalUsers ?? 0, ''],
    ['Rooms hosted', metrics?.totalRooms ?? 0, ''],
    ['Live now', metrics?.liveRooms ?? 0, ''],
    ['Open reports', metrics?.openReports ?? 0, ''],
    ['Active streams', metrics?.activeStreams ?? 0, ''],
  ] as const

  return (
    <div className="min-h-screen bg-[#080d18] px-8 py-7 text-white">
      <div className="mx-auto max-w-[1320px] space-y-6">
        <header className="flex items-start justify-between border-b border-white/10 pb-6">
          <div>
            <p className="text-[0.65rem] font-black uppercase tracking-[0.22em] text-slate-500">
              /admin
            </p>
            <h1 className="mt-2 text-2xl font-black">Dashboard</h1>
            <p className="mt-1 text-xs text-slate-500">
              full platform overview · restricted to admins
            </p>
          </div>
          <span className="rounded-full border border-violet-300/20 bg-violet-500/10 px-4 py-2 text-[0.65rem] font-black uppercase text-violet-200 shadow-[0_0_22px_rgba(168,85,247,0.35)]">
            admin access
          </span>
        </header>


        <MetricSection
          dot="bg-violet-400"
          label="platform stats"
          suffix="current"
        >
          <div className="grid grid-cols-5 gap-3">
            {totals.map(([label, value, delta]) => (
              <MetricCard
                delta={delta}
                key={label}
                label={label}
                value={value}
              />
            ))}
          </div>
        </MetricSection>

        <section className="space-y-3">
          <h2 className="text-xs font-black lowercase text-white">
            <span className="text-rose-400">●</span> live rooms{' '}
            <span className="font-normal text-slate-500">
              {metrics?.liveRooms ?? 0} streaming now
            </span>
          </h2>
          <div className="rounded-2xl border border-white/10 bg-[#121a2a] p-4 text-xs text-slate-400">
            No live rooms.
          </div>
        </section>
      </div>
    </div>
  )
}

function MetricSection({
  children,
  dot,
  label,
  suffix,
}: {
  children: React.ReactNode
  dot: string
  label: string
  suffix: string
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-black lowercase text-white">
        <span className={`mr-1 inline-block h-2 w-2 rounded-full ${dot}`} />
        {label}{' '}
        <span className="font-normal uppercase tracking-wider text-slate-500">
          {suffix}
        </span>
      </h2>
      {children}
    </section>
  )
}

function MetricCard({
  delta,
  label,
  value,
}: {
  delta: string
  label: string
  value: number
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#151d2e] p-4">
      <div className="text-[0.62rem] font-black uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
      {delta ? (
        <div
          className={[
            'mt-2 text-[0.62rem] font-black',
            delta.startsWith('-') ? 'text-rose-300' : 'text-emerald-300',
          ].join(' ')}
        >
          {delta} vs prev 30d
        </div>
      ) : null}
    </div>
  )
}
