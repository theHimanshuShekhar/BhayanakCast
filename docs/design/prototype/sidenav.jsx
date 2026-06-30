// Narrow icon-rail sidenav (64px) — Tailwind v4 utilities

const RailItem = ({ icon: I, label, active, badge, onClick }) => {
  const base =
    'group relative w-10 h-10 rounded-[10px] grid place-items-center transition-[background-color,color] duration-150'
  const state = active
    ? 'bg-primary-soft text-primary shadow-[0_0_0_1px_color-mix(in_oklch,var(--color-primary)_40%,transparent),0_0_16px_var(--color-primary-glow)]'
    : 'text-muted hover:bg-surface hover:text-fg'
  return (
    <button className={`${base} ${state}`} onClick={onClick} title={label}>
      {/* Active marker bar (was ::before) */}
      {active && (
        <span className="absolute -left-3 top-2 bottom-2 w-[3px] bg-primary rounded-r-[3px] shadow-[0_0_10px_var(--color-primary-glow)]" />
      )}
      <span className="inline-flex">
        <I size={16} />
      </span>
      {badge !== undefined && badge !== null && (
        <span className="absolute -top-[3px] -right-[3px] min-w-4 h-4 px-1 rounded-full bg-primary text-primary-ink text-[9.5px] font-bold leading-none grid place-items-center border-2 border-canvas">
          {badge}
        </span>
      )}
      <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 -translate-x-1 px-2.5 py-[5px] bg-surface-3 text-fg border border-border-strong rounded-md text-[11px] tracking-[0.02em] whitespace-nowrap opacity-0 transition-[opacity,transform] duration-150 z-[100] shadow-pop group-hover:opacity-100 group-hover:translate-x-0">
        {label}
      </span>
    </button>
  )
}

const SideNav = ({
  view,
  onNav,
  rooms,
  activeRoomId,
  onEnter,
  onCreate,
  onProfile,
  theme,
  onThemeToggle,
}) => {
  const liveCount = rooms.length

  const adminBase =
    'group relative w-9 h-7 rounded-lg grid place-items-center cursor-pointer transition-all duration-150 mb-0.5'
  const adminState =
    view === 'admin'
      ? 'bg-primary border border-primary text-bg shadow-[0_0_14px_var(--color-primary-glow)]'
      : 'bg-[color-mix(in_oklch,var(--color-primary)_14%,transparent)] border border-[color-mix(in_oklch,var(--color-primary)_35%,transparent)] text-primary hover:bg-[color-mix(in_oklch,var(--color-primary)_24%,transparent)] hover:border-[color-mix(in_oklch,var(--color-primary)_60%,transparent)] hover:shadow-[0_0_12px_var(--color-primary-glow)]'

  return (
    <nav className="flex flex-col items-center gap-1 py-3 bg-canvas border-r border-border-subtle min-h-0 overflow-hidden">
      <button
        onClick={() => onNav('home')}
        className="w-10 h-10 rounded-[10px] grid place-items-center bg-surface-2 border border-border font-extrabold text-[11px] tracking-[0.08em] text-primary shadow-card mb-2 cursor-pointer hover:shadow-[var(--shadow-card),0_0_18px_var(--color-primary-glow)] transition-shadow"
      >
        <span>BC</span>
      </button>

      <div className="flex flex-col items-center gap-1 w-full">
        <RailItem
          icon={Icon.Users}
          label="Active Rooms"
          active={view === 'home'}
          badge={liveCount}
          onClick={() => onNav('home')}
        />
      </div>

      <div className="flex-1" />

      <div className="flex flex-col items-center gap-1 w-full">
        <RailItem icon={Icon.Plus} label="Start a Room" onClick={onCreate} />
      </div>

      <div className="flex flex-col items-center gap-1 pt-2 border-t border-border-subtle w-full">
        {CURRENT_USER_ADMIN && (
          <button
            className={`${adminBase} ${adminState}`}
            onClick={() => onNav('admin')}
            title="Admin Dashboard"
          >
            <Icon.Bolt size={14} />
            <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 -translate-x-1 px-2 py-1 bg-surface-3 text-fg border border-border rounded-md text-[11px] whitespace-nowrap opacity-0 transition-[opacity,transform] duration-150 z-20 group-hover:opacity-100 group-hover:translate-x-0">
              Admin Dashboard
            </span>
          </button>
        )}
        <button
          className="group relative w-10 h-10 rounded-[10px] grid place-items-center text-muted hover:bg-surface hover:text-fg transition-[background-color,color] duration-150"
          onClick={onThemeToggle}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          <span className="inline-flex">
            {theme === 'dark' ? (
              <Icon.Sun size={16} />
            ) : (
              <Icon.Moon size={16} />
            )}
          </span>
          <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 -translate-x-1 px-2.5 py-[5px] bg-surface-3 text-fg border border-border-strong rounded-md text-[11px] whitespace-nowrap opacity-0 transition-[opacity,transform] duration-150 z-[100] shadow-pop group-hover:opacity-100 group-hover:translate-x-0">
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </span>
        </button>
        <button
          className="w-9 h-9 p-0 rounded-[10px] bg-transparent grid place-items-center"
          onClick={onProfile}
          title="You"
          data-profile-trigger
        >
          <Avatar name="you" size="md" ring />
        </button>
      </div>
    </nav>
  )
}

Object.assign(window, { SideNav })
