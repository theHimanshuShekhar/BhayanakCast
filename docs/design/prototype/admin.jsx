// Admin Dashboard — /admin (requires is_admin)

// ——— Custom SVG charts (lighter than recharts, fits the neon/mono aesthetic) ———

const LineChart = ({ data, xKey, series, height = 160, showDots = true }) => {
  const W = 600, H = height, pad = { t: 12, r: 12, b: 24, l: 32 };
  const w = W - pad.l - pad.r;
  const h = H - pad.t - pad.b;
  const xs = data.map((_, i) => i);
  const allY = series.flatMap(s => data.map(d => d[s.key]));
  const maxY = Math.max(...allY, 1);
  const scaleX = (i) => pad.l + (w * i) / Math.max(1, data.length - 1);
  const scaleY = (v) => pad.t + h - (h * v) / maxY;

  const path = (key) => data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(i).toFixed(1)} ${scaleY(d[key]).toFixed(1)}`).join(' ');
  const area = (key) => `${path(key)} L ${scaleX(data.length - 1)} ${pad.t + h} L ${pad.l} ${pad.t + h} Z`;

  const yTicks = 4;
  const yVals = Array.from({ length: yTicks + 1 }, (_, i) => (maxY * i) / yTicks);
  const xStep = Math.ceil(data.length / 6);

  return (
    <svg className="w-full h-auto block" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        {series.map((s, si) => (
          <linearGradient key={si} id={`lg-${s.key}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.35"/>
            <stop offset="100%" stopColor={s.color} stopOpacity="0"/>
          </linearGradient>
        ))}
      </defs>
      {/* Grid */}
      {yVals.map((v, i) => (
        <g key={i}>
          <line x1={pad.l} x2={pad.l + w} y1={scaleY(v)} y2={scaleY(v)}
            style={{ stroke: 'var(--color-border)' }} strokeDasharray="2 3"/>
          <text x={pad.l - 6} y={scaleY(v)} dy="3" textAnchor="end"
            style={{ fill: 'var(--color-muted)' }} fontSize="9" fontFamily="inherit" letterSpacing="0.05em">
            {Math.round(v)}
          </text>
        </g>
      ))}
      {/* X labels */}
      {data.map((d, i) => (i % xStep === 0 || i === data.length - 1) && (
        <text key={i} x={scaleX(i)} y={pad.t + h + 14} textAnchor="middle"
          style={{ fill: 'var(--color-muted)' }} fontSize="9" fontFamily="inherit" letterSpacing="0.05em">
          {d[xKey]}
        </text>
      ))}
      {/* Series */}
      {series.map((s, si) => (
        <g key={si}>
          <path d={area(s.key)} fill={`url(#lg-${s.key})`}/>
          <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth="1.5"/>
          {showDots && data.map((d, i) => (
            <circle key={i} cx={scaleX(i)} cy={scaleY(d[s.key])} r="2" fill={s.color}/>
          ))}
        </g>
      ))}
    </svg>
  );
};

const BarChart = ({ data, xKey, series, height = 160 }) => {
  const W = 600, H = height, pad = { t: 12, r: 12, b: 24, l: 32 };
  const w = W - pad.l - pad.r;
  const h = H - pad.t - pad.b;
  const allY = series.flatMap(s => data.map(d => d[s.key]));
  const maxY = Math.max(...allY, 1);
  const group = w / data.length;
  const barW = (group - 4) / series.length;
  const scaleY = (v) => pad.t + h - (h * v) / maxY;

  const yTicks = 4;
  const yVals = Array.from({ length: yTicks + 1 }, (_, i) => (maxY * i) / yTicks);
  const xStep = Math.ceil(data.length / 6);

  return (
    <svg className="w-full h-auto block" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {yVals.map((v, i) => (
        <g key={i}>
          <line x1={pad.l} x2={pad.l + w} y1={scaleY(v)} y2={scaleY(v)}
            style={{ stroke: 'var(--color-border)' }} strokeDasharray="2 3"/>
          <text x={pad.l - 6} y={scaleY(v)} dy="3" textAnchor="end"
            style={{ fill: 'var(--color-muted)' }} fontSize="9" fontFamily="inherit">
            {Math.round(v)}
          </text>
        </g>
      ))}
      {data.map((d, i) => (
        <g key={i}>
          {series.map((s, si) => {
            const x = pad.l + i * group + 2 + si * barW;
            const y = scaleY(d[s.key]);
            const bh = Math.max(1, pad.t + h - y);
            return <rect key={si} x={x} y={y} width={barW - 1} height={bh} fill={s.color} rx="1"/>;
          })}
          {(i % xStep === 0 || i === data.length - 1) && (
            <text x={pad.l + i * group + group / 2} y={pad.t + h + 14} textAnchor="middle"
              style={{ fill: 'var(--color-muted)' }} fontSize="9" fontFamily="inherit">
              {d[xKey]}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
};

// ——— Tables ———

const DOT = {
  accent: 'bg-primary shadow-[0_0_8px_var(--color-primary-glow)]',
  ok: 'bg-success shadow-[0_0_8px_color-mix(in_oklch,var(--color-success)_50%,transparent)]',
  live: 'bg-live shadow-[0_0_8px_var(--color-live)] animate-bc-pulse',
  muted: 'bg-muted',
};
const card = 'bg-surface border border-border rounded-[var(--radius)] shadow-card';
const th = 'px-3.5 py-2.5 text-left text-[10px] tracking-[0.1em] uppercase text-subtle font-semibold bg-canvas border-b border-border-subtle sticky top-0';
const td = 'px-3.5 py-2.5 border-b border-border-subtle text-fg-muted group-last:border-b-0 group-hover:bg-surface-2';
const barFill = 'block h-full rounded-full bg-[linear-gradient(90deg,var(--color-primary),color-mix(in_oklch,var(--color-primary)_40%,var(--color-success)))] shadow-[0_0_6px_var(--color-primary-glow)]';

const AdminSectionHead = ({ dot = 'muted', title, sub, className = 'mt-6' }) => (
  <div className={`flex items-baseline gap-2.5 mb-3 ${className}`}>
    <h3 className="m-0 text-sm font-bold inline-flex items-center gap-2 tracking-[-0.005em]">
      <span className={`w-1.5 h-1.5 rounded-full ${DOT[dot]}`}/> {title}
    </h3>
    <MonoCaps>{sub}</MonoCaps>
  </div>
);

const AdminStatCard = ({ label, value, unit, delta, tone }) => {
  const toneCls = tone === 'accent'
    ? 'border-[color-mix(in_oklch,var(--color-primary)_40%,var(--color-border))] bg-[linear-gradient(135deg,var(--color-primary-soft),var(--color-surface)_70%)]'
    : tone === 'live' ? 'border-[color-mix(in_oklch,var(--color-live)_40%,var(--color-border))] bg-surface' : 'border-border bg-surface';
  return (
    <div className={`border rounded-[var(--radius)] px-4 py-3.5 shadow-card flex flex-col gap-1.5 ${toneCls}`}>
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted font-semibold">{label}</div>
      <div className="flex items-baseline gap-[3px] text-[22px] sm:text-[26px] font-extrabold tracking-[-0.02em] text-fg leading-none">{value}{unit && <span className="text-[13px] font-medium text-muted">{unit}</span>}</div>
      {delta !== undefined && (
        <div className={`inline-flex items-center gap-[5px] text-[10.5px] tracking-[0.04em] ${delta >= 0 ? 'text-success' : 'text-live'}`}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% <span className="text-subtle text-[9.5px]">vs prev 30d</span>
        </div>
      )}
    </div>
  );
};

const SortHeader = ({ label, sortKey, sort, setSort, align = 'left' }) => {
  const active = sort.key === sortKey;
  return (
    <th
      className={`${th} cursor-pointer select-none ${active ? '!text-primary' : 'hover:text-fg-muted'}`}
      style={{ textAlign: align }}
      onClick={() => setSort({ key: sortKey, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}>
      {label}
      <span className="ml-1 text-[9px] opacity-70">{active ? (sort.dir === 'desc' ? '▼' : '▲') : '↕'}</span>
    </th>
  );
};

const RoomCell = ({ live, name }) => (
  <div className="inline-flex items-center gap-2 font-medium text-fg">
    <span className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${live ? 'bg-live shadow-[0_0_8px_var(--color-live)] animate-bc-pulse' : 'bg-subtle'}`}/>
    <span>{name}</span>
  </div>
);
const UserCell = ({ name }) => <div className="inline-flex items-center gap-2 text-fg-muted"><Avatar name={name} size="sm"/> {name}</div>;
const EmptyRow = ({ cols, children }) => <tr><td colSpan={cols} className="text-center p-7 text-subtle text-[11.5px]">{children}</td></tr>;

const LiveRoomsTable = ({ rooms, onEnter }) => (
  <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-collapse text-xs">
    <thead>
      <tr>
        <th className={th}>room</th>
        <th className={th}>streamer</th>
        <th className={`${th} !text-right`}>viewers</th>
        <th className={`${th} !text-right`}>capacity</th>
        <th className={`${th} !text-right`}>duration</th>
        <th className={`${th} w-[60px]`}></th>
      </tr>
    </thead>
    <tbody>
      {rooms.map(r => (
        <tr key={r.id} className="group">
          <td className={td}><RoomCell live name={r.name}/></td>
          <td className={td}><UserCell name={r.streamer}/></td>
          <td className={`${td} text-right`}><b>{r.viewers}</b><span className="text-subtle">/{r.capacity}</span></td>
          <td className={`${td} text-right`}>{r.capacity}</td>
          <td className={`${td} text-right`}>{r.started}</td>
          <td className={td}><Btn size="sm" onClick={() => onEnter(r)}>open</Btn></td>
        </tr>
      ))}
      {rooms.length === 0 && <EmptyRow cols={6}>no live rooms</EmptyRow>}
    </tbody>
  </table></div>
);

const AllTimeRoomsTable = ({ rooms }) => {
  const [q, setQ] = React.useState('');
  const [sort, setSort] = React.useState({ key: 'ended', dir: 'desc' });
  const filtered = rooms.filter(r =>
    r.name.toLowerCase().includes(q.toLowerCase()) ||
    r.streamer.toLowerCase().includes(q.toLowerCase())
  );
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sort.key]; const bv = b[sort.key];
    if (av == null) return 1; if (bv == null) return -1;
    if (typeof av === 'number') return sort.dir === 'desc' ? bv - av : av - bv;
    return sort.dir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5 border-b border-border-subtle bg-canvas">
        <div className="flex items-center gap-2 h-[30px] px-2.5 flex-1 min-w-0 sm:flex-none sm:min-w-[280px] bg-surface border border-border rounded-lg text-muted">
          <Icon.Search size={12}/>
          <input className="flex-1 min-w-0 bg-transparent border-0 outline-0 text-fg text-xs" placeholder="search rooms or streamers…" value={q} onChange={e => setQ(e.target.value)}/>
        </div>
        <MonoCaps>{sorted.length} of {rooms.length} rooms</MonoCaps>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-collapse text-xs">
        <thead>
          <tr>
            <SortHeader label="room" sortKey="name" sort={sort} setSort={setSort}/>
            <SortHeader label="streamer" sortKey="streamer" sort={sort} setSort={setSort}/>
            <SortHeader label="status" sortKey="status" sort={sort} setSort={setSort}/>
            <SortHeader label="peak" sortKey="peak" sort={sort} setSort={setSort} align="right"/>
            <SortHeader label="joined" sortKey="joined" sort={sort} setSort={setSort} align="right"/>
            <SortHeader label="duration" sortKey="duration" sort={sort} setSort={setSort} align="right"/>
            <SortHeader label="ended" sortKey="ended" sort={sort} setSort={setSort} align="right"/>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.id} className="group">
              <td className={td}><RoomCell live={r.status === 'live'} name={r.name}/></td>
              <td className={td}><UserCell name={r.streamer}/></td>
              <td className={td}>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9.5px] tracking-[0.08em] font-semibold uppercase border ${r.status === 'live' ? 'bg-[color-mix(in_oklch,var(--color-live)_22%,transparent)] text-live-ink border-[color-mix(in_oklch,var(--color-live)_50%,transparent)]' : 'bg-surface-2 text-muted border-border'}`}>
                  {r.status === 'live' ? 'LIVE' : 'ended'}
                </span>
              </td>
              <td className={`${td} text-right`}><b>{r.peak}</b></td>
              <td className={`${td} text-right`}>{r.joined}</td>
              <td className={`${td} text-right !text-subtle`}>{r.duration}</td>
              <td className={`${td} text-right !text-subtle`}>{r.ended || '—'}</td>
            </tr>
          ))}
          {sorted.length === 0 && <EmptyRow cols={7}>no matches</EmptyRow>}
        </tbody>
      </table></div>
    </div>
  );
};

const TopUsersTable = ({ users, label, onOpenProfile }) => (
  <div className={`${card} overflow-hidden`}>
    <div className="flex items-baseline justify-between px-4 py-3 border-b border-border-subtle bg-canvas">
      <h4 className="m-0 text-xs font-bold tracking-[-0.005em]">{label}</h4>
      <MonoCaps>top 6</MonoCaps>
    </div>
    <div className="flex flex-col">
      {users.map((u, i) => (
        <button key={u.username} onClick={() => onOpenProfile(u.username)}
          className="group grid grid-cols-[28px_28px_1fr_auto] grid-rows-[auto_auto] gap-x-3 items-center px-4 py-2.5 border-b border-border-subtle last:border-b-0 text-left cursor-pointer transition-colors hover:bg-surface-2">
          <span className="row-span-2 text-[10.5px] font-bold text-subtle tracking-[0.05em] group-hover:text-primary">#{i + 1}</span>
          <Avatar name={u.username} size="sm" ring={i === 0} className="row-span-2"/>
          <span className="col-start-3 text-[12.5px] font-semibold text-fg">{u.username}</span>
          <span className="col-start-4 row-start-1 text-[13px] font-bold text-primary tracking-[-0.01em]">{u.value.toFixed(1)}<span className="text-subtle font-medium text-[11px]">h</span></span>
          <span className="col-start-3 col-span-2 row-start-2 h-[3px] mt-1 rounded-full bg-surface-3 overflow-hidden"><span className={barFill} style={{ width: (u.pct * 100) + '%' }}/></span>
        </button>
      ))}
    </div>
  </div>
);

const ChartCard = ({ title, legend, children }) => (
  <div className={`${card} px-[18px] py-4`}>
    <div className="flex items-center justify-between mb-2">
      <h3 className="m-0 text-[13px] font-bold">{title}</h3>
      <div className="flex gap-3 text-[10.5px] text-muted">
        {legend.map(([c, l]) => (
          <span key={l} className="inline-flex items-center gap-[5px]"><i className="inline-block w-2 h-2 rounded-[2px]" style={{ background: c }}/> {l}</span>
        ))}
      </div>
    </div>
    {children}
  </div>
);

// ——— Main page ———

const AdminPage = ({ liveRooms, onEnter, onOpenProfile }) => {
  const P = Object.values(USER_PROFILES);
  const totalHoursStreamed = P.reduce((s, p) => s + p.stats.hoursStreamed, 0);
  const totalHoursWatched = P.reduce((s, p) => s + p.stats.hoursWatched, 0);
  const totalRoomsHosted = P.reduce((s, p) => s + p.stats.roomsHosted, 0);
  const totalUsers = P.length;
  const newUsers30d = USER_GROWTH.reduce((s, d) => s + d.new_users, 0);
  const roomsCreated30d = ROOM_ACTIVITY.reduce((s, d) => s + d.created, 0);

  const top = (key) => {
    const list = P.map(p => ({ username: p.username, value: p.stats[key] })).sort((a, b) => b.value - a.value).slice(0, 6);
    const max = list[0]?.value || 1;
    return list.map(u => ({ ...u, pct: u.value / max }));
  };

  return (
    <div className="overflow-auto min-h-0 h-full">
      <div className="px-4 sm:px-8 pt-5 sm:pt-6 pb-[60px] max-w-[1400px] mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-5 mb-6 border-b border-border-subtle">
          <div>
            <div className="mb-1"><MonoCaps>/admin</MonoCaps></div>
            <h1 className="m-0 mb-1 text-[22px] sm:text-[26px] font-extrabold tracking-[-0.02em]">Dashboard</h1>
            <p className="m-0 text-xs text-muted">full platform overview · restricted to admins</p>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[color-mix(in_oklch,var(--color-primary)_15%,var(--color-surface))] border border-[color-mix(in_oklch,var(--color-primary)_40%,transparent)] text-[11px] tracking-[0.06em] uppercase font-semibold text-primary shadow-[0_0_16px_var(--color-primary-glow)]">
            <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary-glow)] animate-bc-pulse"/>
            <span>admin access</span>
          </div>
        </div>

        <AdminSectionHead dot="accent" title="platform stats" sub="all-time" className="mt-0"/>
        <div className="grid grid-cols-2 min-[720px]:grid-cols-3 min-[1100px]:grid-cols-5 gap-2.5">
          <AdminStatCard label="total users" value={totalUsers} delta={12} tone="accent"/>
          <AdminStatCard label="hours streamed" value={totalHoursStreamed.toFixed(0)} unit="h" delta={18}/>
          <AdminStatCard label="hours watched" value={totalHoursWatched.toFixed(0)} unit="h" delta={23}/>
          <AdminStatCard label="rooms hosted" value={totalRoomsHosted} delta={9}/>
          <AdminStatCard label="live now" value={liveRooms.length} tone="live"/>
        </div>

        <AdminSectionHead dot="ok" title="last 30 days" sub="rolling window"/>
        <div className="grid grid-cols-2 min-[900px]:grid-cols-4 gap-2.5">
          <AdminStatCard label="new users (30d)" value={newUsers30d} delta={7}/>
          <AdminStatCard label="rooms created (30d)" value={roomsCreated30d} delta={14}/>
          <AdminStatCard label="avg peak viewers" value={8.4} delta={-3}/>
          <AdminStatCard label="active streamers" value={9} delta={2}/>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-3.5 mt-3.5">
          <ChartCard title="user growth" legend={[['var(--color-primary)', 'new users'], ['oklch(0.78 0.18 150)', 'cumulative']]}>
            <LineChart data={USER_GROWTH} xKey="date" height={200}
              series={[{ key: 'new_users', color: 'oklch(0.78 0.19 265)' }, { key: 'cumulative', color: 'oklch(0.78 0.18 150)' }]}/>
          </ChartCard>
          <ChartCard title="room activity" legend={[['oklch(0.72 0.18 220)', 'created'], ['oklch(0.72 0.22 25)', 'ended']]}>
            <BarChart data={ROOM_ACTIVITY} xKey="date" height={200}
              series={[{ key: 'created', color: 'oklch(0.72 0.18 220)' }, { key: 'ended', color: 'oklch(0.72 0.22 25)' }]}/>
          </ChartCard>
        </div>

        <AdminSectionHead dot="live" title="live rooms" sub={`${liveRooms.length} streaming now`}/>
        <div className={`${card} overflow-hidden`}><LiveRoomsTable rooms={liveRooms} onEnter={onEnter}/></div>

        <AdminSectionHead dot="muted" title="all-time rooms" sub="searchable · sortable"/>
        <div className={`${card} overflow-hidden`}><AllTimeRoomsTable rooms={ALLTIME_ROOMS}/></div>

        <AdminSectionHead dot="accent" title="top users" sub="leaderboards"/>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] gap-3.5">
          <TopUsersTable users={top('hoursStreamed')} label="hours streamed" onOpenProfile={onOpenProfile}/>
          <TopUsersTable users={top('hoursWatched')} label="hours watched" onOpenProfile={onOpenProfile}/>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { AdminPage });
