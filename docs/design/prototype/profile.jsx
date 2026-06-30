// Profile page — /profile/:username — Tailwind v4 utilities

const STAT_TONE_CARD = {
  '': 'border-border',
  accent:
    'border-[color-mix(in_oklch,var(--color-primary)_50%,var(--color-border))] bg-[linear-gradient(135deg,var(--color-primary-soft),var(--color-surface)_60%)]',
  live: 'border-[color-mix(in_oklch,var(--color-live)_45%,var(--color-border))]',
}
const STAT_TONE_ICO = {
  '': 'bg-surface-2 text-fg-muted',
  accent:
    'bg-primary text-primary-ink shadow-[0_0_10px_var(--color-primary-glow)]',
  live: 'bg-[color-mix(in_oklch,var(--color-live)_25%,var(--color-surface-2))] text-[oklch(0.98_0.02_25)]',
}

const StatCard = ({ icon: I, label, value, unit, tone = '' }) => (
  <div
    className={`bg-surface border rounded-[var(--radius)] p-[14px_16px_18px] flex flex-col gap-2.5 transition-[border-color,transform] duration-[120ms] hover:border-border-strong hover:-translate-y-px ${STAT_TONE_CARD[tone] || STAT_TONE_CARD['']}`}
  >
    <div className="flex items-center gap-2">
      <span
        className={`w-[22px] h-[22px] grid place-items-center rounded-md ${STAT_TONE_ICO[tone] || STAT_TONE_ICO['']}`}
      >
        <I size={12} />
      </span>
      <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-semibold">
        {label}
      </span>
    </div>
    <div className="text-[32px] font-extrabold tracking-[-0.02em] text-fg leading-none">
      {value}
      {unit && (
        <span className="text-sm font-medium text-muted ml-0.5">{unit}</span>
      )}
    </div>
  </div>
)

const CoUserRow = ({ rank, co, onOpen }) => (
  <button
    onClick={() => onOpen(co.username)}
    className="group flex items-center gap-3.5 px-4 py-3 bg-transparent border-0 border-b border-border-subtle text-left cursor-pointer transition-colors duration-[120ms] last:border-b-0 hover:bg-surface-2"
  >
    <span className="w-[22px] flex-shrink-0 text-[11px] font-bold text-subtle tracking-[0.06em] group-hover:text-primary transition-colors">
      #{rank}
    </span>
    <Avatar name={co.username} size="md" ring={rank === 1} />
    <div className="flex-1 min-w-0">
      <div className="text-[13px] font-semibold text-fg">{co.username}</div>
      <div className="text-[10.5px] text-subtle tracking-[0.04em]">
        time together
      </div>
    </div>
    <div className="flex flex-col items-end gap-1.5 min-w-[140px]">
      <div className="text-[13px] font-bold text-primary tracking-[-0.01em]">
        {formatCotime(co.seconds)}
      </div>
      <div className="w-[120px] h-1 rounded-full bg-surface-3 overflow-hidden">
        <span
          className="block h-full rounded-full shadow-[0_0_8px_var(--color-primary-glow)] bg-[linear-gradient(90deg,var(--color-primary),color-mix(in_oklch,var(--color-primary)_40%,var(--color-success)))]"
          style={{ width: co.pct * 100 + '%' }}
        />
      </div>
    </div>
  </button>
)

const SectionHead = ({ title, sub, dotTone = 'primary' }) => {
  const dot =
    dotTone === 'success'
      ? 'bg-success shadow-[0_0_8px_color-mix(in_oklch,var(--color-success)_60%,transparent)]'
      : 'bg-primary shadow-[0_0_8px_var(--color-primary-glow)]'
  return (
    <div className="flex items-baseline gap-2.5 mb-3.5">
      <h3 className="m-0 text-[15px] font-bold inline-flex items-center gap-2 tracking-[-0.005em]">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        {title}
      </h3>
      <span className="uppercase tracking-[0.12em] text-[10px] text-muted font-medium">
        {sub}
      </span>
    </div>
  )
}

const ProfilePage = ({
  username,
  isSelf,
  isFavorite,
  onToggleFavorite,
  onOpenProfile,
  onBack,
}) => {
  const profile = USER_PROFILES[username]
  if (!profile) {
    return (
      <div className="px-10 py-20 text-center">
        <h2 className="m-0 mb-2 text-lg">user not found</h2>
        <p className="m-0 mb-4 text-muted text-[12.5px]">
          no profile for <b>{username}</b>
        </p>
        <button className="btn" onClick={onBack}>
          back
        </button>
      </div>
    )
  }

  const { stats } = profile
  const coRaw = topCoUsers(username, 5)
  const max = coRaw[0]?.seconds || 1
  const co = coRaw.map((c) => ({ ...c, pct: c.seconds / max }))
  const av = avatarFor(username)

  return (
    <div className="overflow-auto min-h-0 h-full">
      {/* Banner */}
      <div className="relative h-[180px] overflow-hidden border-b border-border-subtle">
        <div
          className="absolute inset-0"
          style={{
            background: `
            radial-gradient(60% 80% at 20% 20%, ${av.c1} / 0.4, transparent 60%),
            radial-gradient(50% 70% at 85% 80%, ${av.c2} / 0.35, transparent 60%),
            linear-gradient(135deg, var(--depth-1), var(--depth-2))
          `,
          }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(oklch(1_0_0/0.04)_1px,transparent_1px),linear-gradient(90deg,oklch(1_0_0/0.04)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:linear-gradient(180deg,oklch(0_0_0/0.6),transparent_85%)]" />
      </div>

      <div className="px-8 pb-12 max-w-[1100px] mx-auto">
        {/* Identity head */}
        <div className="flex items-end gap-6 -mt-12 pb-6 border-b border-border-subtle">
          <div className="relative p-1.5 bg-canvas border border-border-strong rounded-[20px] shadow-pop">
            <Avatar name={username} size="xl" ring />
            {isSelf && (
              <span className="absolute bottom-1 right-1 text-[9px] font-bold tracking-[0.12em] px-1.5 py-0.5 rounded-md bg-primary text-primary-ink shadow-[0_0_12px_var(--color-primary-glow)]">
                YOU
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0 pb-1.5">
            <div className="flex items-center gap-2.5 mb-2">
              <h1 className="m-0 text-[28px] font-extrabold tracking-[-0.02em] text-fg">
                {username}
              </h1>
              {isFavorite && !isSelf && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full bg-[color-mix(in_oklch,var(--color-primary)_18%,transparent)] border border-[color-mix(in_oklch,var(--color-primary)_40%,transparent)] text-primary text-[10px] tracking-[0.08em] uppercase font-semibold">
                  <Icon.Sparkle size={10} /> favorite
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="inline-flex items-baseline gap-1.5">
                <span className="text-[10px] tracking-[0.12em] uppercase text-subtle font-medium">
                  discord
                </span>
                <span className="text-fg-muted font-medium">
                  {profile.discord}
                </span>
              </span>
              <span className="w-[3px] h-[3px] rounded-full bg-subtle" />
              <span className="inline-flex items-baseline gap-1.5">
                <span className="text-[10px] tracking-[0.12em] uppercase text-subtle font-medium">
                  joined
                </span>
                <span className="text-fg-muted font-medium">
                  {profile.joined}
                </span>
              </span>
            </div>
          </div>
          <div className="pb-1.5">
            {!isSelf && (
              <button
                className={`btn ${isFavorite ? 'danger' : 'primary'}`}
                onClick={() => onToggleFavorite(username)}
              >
                <Icon.Sparkle size={14} />
                {isFavorite ? 'unfavorite' : 'favorite'}
              </button>
            )}
            {isSelf && (
              <button className="btn">
                <Icon.Gear size={14} /> edit profile
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <section className="mt-8">
          <SectionHead title="stats" sub="lifetime" />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            <StatCard
              icon={Icon.Broadcast}
              label="hours streamed"
              value={stats.hoursStreamed.toFixed(1)}
              unit="h"
              tone="accent"
            />
            <StatCard
              icon={Icon.Eye}
              label="hours watched"
              value={stats.hoursWatched.toFixed(1)}
              unit="h"
            />
            <StatCard
              icon={Icon.Plus}
              label="rooms hosted"
              value={stats.roomsHosted}
            />
            <StatCard
              icon={Icon.Users}
              label="rooms joined"
              value={stats.roomsJoined}
            />
            <StatCard
              icon={Icon.Bolt}
              label="peak viewers"
              value={stats.peakViewers}
              tone="live"
            />
          </div>
        </section>

        {/* Top co-users */}
        <section className="mt-8">
          <SectionHead
            title="top co-users"
            sub="by seconds together"
            dotTone="success"
          />
          {co.length === 0 ? (
            <div className="p-6 bg-surface border border-border rounded-[var(--radius)] text-center text-subtle text-[11.5px]">
              no shared time yet
            </div>
          ) : (
            <div className="flex flex-col bg-surface border border-border rounded-[var(--radius)] overflow-hidden">
              {co.map((c, i) => (
                <CoUserRow
                  key={c.username}
                  rank={i + 1}
                  co={c}
                  onOpen={onOpenProfile}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

Object.assign(window, { ProfilePage })
