// Narrow icon-rail sidenav (64px) — Tailwind v4 utilities

const RailItem = ({ icon: I, label, active, badge, onClick }) => {
  const base = "group relative w-10 h-10 rounded-[10px] grid place-items-center transition-[background-color,color] duration-150";
  const state = active
    ? "bg-primary-soft text-primary shadow-[0_0_0_1px_color-mix(in_oklch,var(--color-primary)_40%,transparent),0_0_16px_var(--color-primary-glow)]"
    : "text-muted hover:bg-surface hover:text-fg";
  return (
    <button className={`${base} ${state}`} onClick={onClick} title={label}>
      {/* Active marker bar (was ::before) */}
      {active && (
        <span className="max-sm:hidden absolute -left-3 top-2 bottom-2 w-[3px] bg-primary rounded-r-[3px] shadow-[0_0_10px_var(--color-primary-glow)]"/>
      )}
      <span className="inline-flex"><I size={16}/></span>
      {badge !== undefined && badge !== null && (
        <span className="absolute -top-[3px] -right-[3px] min-w-4 h-4 px-1 rounded-full bg-primary text-primary-ink text-[9.5px] font-bold leading-none grid place-items-center border-2 border-canvas">
          {badge}
        </span>
      )}
      <span className="max-sm:hidden pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 -translate-x-1 px-2.5 py-[5px] bg-surface-3 text-fg border border-border-strong rounded-md text-[11px] tracking-[0.02em] whitespace-nowrap opacity-0 transition-[opacity,transform] duration-150 z-[100] shadow-pop group-hover:opacity-100 group-hover:translate-x-0">
        {label}
      </span>
    </button>
  );
};

const SideNav = ({ view, onNav, rooms, onCreate, onProfile, theme, onThemeToggle, accentName, onAccentCycle }) => {
  const liveCount = rooms.length;


  return (
    <nav className="flex flex-col items-center gap-1 py-3 bg-canvas border-r border-border-subtle min-h-0 overflow-hidden max-sm:order-last max-sm:flex-row max-sm:justify-around max-sm:overflow-visible max-sm:py-1.5 max-sm:px-2 max-sm:pb-[max(6px,env(safe-area-inset-bottom))] max-sm:border-r-0 max-sm:border-t">
      <button
        onClick={() => onNav('home')}
        className="max-sm:hidden w-10 h-10 rounded-[10px] grid place-items-center bg-surface-2 border border-border font-extrabold text-[11px] tracking-[0.08em] text-primary shadow-card mb-2 cursor-pointer hover:shadow-[var(--shadow-card),0_0_18px_var(--color-primary-glow)] transition-shadow">
        <span>BC</span>
      </button>

      <div className="flex flex-col items-center gap-1 w-full max-sm:contents">
        <RailItem icon={Icon.Users}     label="Active Rooms" active={view === 'home'} badge={liveCount} onClick={() => onNav('home')}/>
        <RailItem icon={Icon.Plus} label="Start a Room" onClick={onCreate}/>
        {CURRENT_USER_ADMIN && (
          <RailItem icon={Icon.Bolt} label="Admin Dashboard" active={view === 'admin'} onClick={() => onNav('admin')}/>
        )}
      </div>

      <div className="flex-1 max-sm:hidden"/>

      <div className="flex flex-col items-center gap-1 pt-2 border-t border-border-subtle w-full max-sm:contents">
        <button
          className="group relative w-10 h-10 rounded-[10px] grid place-items-center hover:bg-surface transition-[background-color] duration-150"
          onClick={onAccentCycle}
          title={`Accent: ${accentName} — click to cycle`}
          aria-label={`Cycle accent color (current: ${accentName})`}>
          <span className="w-4 h-4 rounded-full bg-primary ring-2 ring-canvas shadow-[0_0_0_3px_var(--color-primary-soft),0_0_10px_var(--color-primary-glow)] transition-colors"/>
          <span className="max-sm:hidden pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 -translate-x-1 px-2.5 py-[5px] bg-surface-3 text-fg border border-border-strong rounded-md text-[11px] whitespace-nowrap opacity-0 transition-[opacity,transform] duration-150 z-[100] shadow-pop group-hover:opacity-100 group-hover:translate-x-0">
            Accent · {accentName}
          </span>
        </button>
        <button
          className="group relative w-10 h-10 rounded-[10px] grid place-items-center text-muted hover:bg-surface hover:text-fg transition-[background-color,color] duration-150"
          onClick={onThemeToggle}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
          <span className="inline-flex">
            {theme === 'dark' ? <Icon.Sun size={16}/> : <Icon.Moon size={16}/>}
          </span>
          <span className="max-sm:hidden pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 -translate-x-1 px-2.5 py-[5px] bg-surface-3 text-fg border border-border-strong rounded-md text-[11px] whitespace-nowrap opacity-0 transition-[opacity,transform] duration-150 z-[100] shadow-pop group-hover:opacity-100 group-hover:translate-x-0">
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </span>
        </button>
        <button
          className="w-9 h-9 p-0 rounded-[10px] bg-transparent grid place-items-center"
          onClick={onProfile}
          title="You"
          data-profile-trigger>
          <Avatar name="you" size="md" ring/>
        </button>
      </div>
    </nav>
  );
};

Object.assign(window, { SideNav });
