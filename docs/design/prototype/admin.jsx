// Admin Dashboard — /admin (requires is_admin)

// ——— Custom SVG charts (lighter than recharts, fits the neon/mono aesthetic) ———

const LineChart = ({ data, xKey, series, height = 160, showDots = true }) => {
  const W = 600,
    H = height,
    pad = { t: 12, r: 12, b: 24, l: 32 }
  const w = W - pad.l - pad.r
  const h = H - pad.t - pad.b
  const xs = data.map((_, i) => i)
  const allY = series.flatMap((s) => data.map((d) => d[s.key]))
  const maxY = Math.max(...allY, 1)
  const scaleX = (i) => pad.l + (w * i) / Math.max(1, data.length - 1)
  const scaleY = (v) => pad.t + h - (h * v) / maxY

  const path = (key) =>
    data
      .map(
        (d, i) =>
          `${i === 0 ? 'M' : 'L'} ${scaleX(i).toFixed(1)} ${scaleY(d[key]).toFixed(1)}`,
      )
      .join(' ')
  const area = (key) =>
    `${path(key)} L ${scaleX(data.length - 1)} ${pad.t + h} L ${pad.l} ${pad.t + h} Z`

  const yTicks = 4
  const yVals = Array.from(
    { length: yTicks + 1 },
    (_, i) => (maxY * i) / yTicks,
  )
  const xStep = Math.ceil(data.length / 6)

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
    >
      <defs>
        {series.map((s, si) => (
          <linearGradient
            key={si}
            id={`lg-${s.key}`}
            x1="0"
            x2="0"
            y1="0"
            y2="1"
          >
            <stop offset="0%" stopColor={s.color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      {/* Grid */}
      {yVals.map((v, i) => (
        <g key={i}>
          <line
            x1={pad.l}
            x2={pad.l + w}
            y1={scaleY(v)}
            y2={scaleY(v)}
            stroke="oklch(1 0 0 / 0.06)"
            strokeDasharray="2 3"
          />
          <text
            x={pad.l - 6}
            y={scaleY(v)}
            dy="3"
            textAnchor="end"
            fill="oklch(0.55 0.012 260)"
            fontSize="9"
            fontFamily="inherit"
            letterSpacing="0.05em"
          >
            {Math.round(v)}
          </text>
        </g>
      ))}
      {/* X labels */}
      {data.map(
        (d, i) =>
          (i % xStep === 0 || i === data.length - 1) && (
            <text
              key={i}
              x={scaleX(i)}
              y={pad.t + h + 14}
              textAnchor="middle"
              fill="oklch(0.55 0.012 260)"
              fontSize="9"
              fontFamily="inherit"
              letterSpacing="0.05em"
            >
              {d[xKey]}
            </text>
          ),
      )}
      {/* Series */}
      {series.map((s, si) => (
        <g key={si}>
          <path d={area(s.key)} fill={`url(#lg-${s.key})`} />
          <path
            d={path(s.key)}
            fill="none"
            stroke={s.color}
            strokeWidth="1.5"
          />
          {showDots &&
            data.map((d, i) => (
              <circle
                key={i}
                cx={scaleX(i)}
                cy={scaleY(d[s.key])}
                r="2"
                fill={s.color}
              />
            ))}
        </g>
      ))}
    </svg>
  )
}

const BarChart = ({ data, xKey, series, height = 160 }) => {
  const W = 600,
    H = height,
    pad = { t: 12, r: 12, b: 24, l: 32 }
  const w = W - pad.l - pad.r
  const h = H - pad.t - pad.b
  const allY = series.flatMap((s) => data.map((d) => d[s.key]))
  const maxY = Math.max(...allY, 1)
  const group = w / data.length
  const barW = (group - 4) / series.length
  const scaleY = (v) => pad.t + h - (h * v) / maxY

  const yTicks = 4
  const yVals = Array.from(
    { length: yTicks + 1 },
    (_, i) => (maxY * i) / yTicks,
  )
  const xStep = Math.ceil(data.length / 6)

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
    >
      {yVals.map((v, i) => (
        <g key={i}>
          <line
            x1={pad.l}
            x2={pad.l + w}
            y1={scaleY(v)}
            y2={scaleY(v)}
            stroke="oklch(1 0 0 / 0.06)"
            strokeDasharray="2 3"
          />
          <text
            x={pad.l - 6}
            y={scaleY(v)}
            dy="3"
            textAnchor="end"
            fill="oklch(0.55 0.012 260)"
            fontSize="9"
            fontFamily="inherit"
          >
            {Math.round(v)}
          </text>
        </g>
      ))}
      {data.map((d, i) => (
        <g key={i}>
          {series.map((s, si) => {
            const x = pad.l + i * group + 2 + si * barW
            const y = scaleY(d[s.key])
            const bh = Math.max(1, pad.t + h - y)
            return (
              <rect
                key={si}
                x={x}
                y={y}
                width={barW - 1}
                height={bh}
                fill={s.color}
                rx="1"
              />
            )
          })}
          {(i % xStep === 0 || i === data.length - 1) && (
            <text
              x={pad.l + i * group + group / 2}
              y={pad.t + h + 14}
              textAnchor="middle"
              fill="oklch(0.55 0.012 260)"
              fontSize="9"
              fontFamily="inherit"
            >
              {d[xKey]}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

// ——— Tables ———

const AdminStatCard = ({ label, value, unit, delta, tone }) => (
  <div className={`admin-stat ${tone || ''}`}>
    <div className="as-label">{label}</div>
    <div className="as-value">
      {value}
      {unit && <span className="as-unit">{unit}</span>}
    </div>
    {delta !== undefined && (
      <div className={`as-delta ${delta >= 0 ? 'up' : 'down'}`}>
        {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% <span>vs prev 30d</span>
      </div>
    )}
  </div>
)

const SortHeader = ({ label, sortKey, sort, setSort, align = 'left' }) => {
  const active = sort.key === sortKey
  return (
    <th
      className={`sortable ${active ? 'active' : ''}`}
      style={{ textAlign: align }}
      onClick={() =>
        setSort({
          key: sortKey,
          dir: active && sort.dir === 'desc' ? 'asc' : 'desc',
        })
      }
    >
      {label}
      <span className="sort-arrow">
        {active ? (sort.dir === 'desc' ? '▼' : '▲') : '↕'}
      </span>
    </th>
  )
}

const LiveRoomsTable = ({ rooms, onEnter }) => (
  <table className="admin-table">
    <thead>
      <tr>
        <th>room</th>
        <th>streamer</th>
        <th style={{ textAlign: 'right' }}>viewers</th>
        <th style={{ textAlign: 'right' }}>capacity</th>
        <th style={{ textAlign: 'right' }}>duration</th>
        <th style={{ width: 60 }}></th>
      </tr>
    </thead>
    <tbody>
      {rooms.map((r) => (
        <tr key={r.id}>
          <td>
            <div className="cell-room">
              <span className="live-dot" />
              <span>{r.name}</span>
            </div>
          </td>
          <td>
            <div className="cell-user">
              <Avatar name={r.streamer} size="sm" /> {r.streamer}
            </div>
          </td>
          <td style={{ textAlign: 'right' }}>
            <b>{r.viewers}</b>
            <span className="mut">/{r.capacity}</span>
          </td>
          <td style={{ textAlign: 'right' }}>{r.capacity}</td>
          <td style={{ textAlign: 'right' }}>{r.started}</td>
          <td>
            <button className="btn sm" onClick={() => onEnter(r)}>
              open
            </button>
          </td>
        </tr>
      ))}
      {rooms.length === 0 && (
        <tr>
          <td colSpan={6} className="empty-cell">
            no live rooms
          </td>
        </tr>
      )}
    </tbody>
  </table>
)

const AllTimeRoomsTable = ({ rooms }) => {
  const [q, setQ] = React.useState('')
  const [sort, setSort] = React.useState({ key: 'ended', dir: 'desc' })
  const filtered = rooms.filter(
    (r) =>
      r.name.toLowerCase().includes(q.toLowerCase()) ||
      r.streamer.toLowerCase().includes(q.toLowerCase()),
  )
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sort.key]
    const bv = b[sort.key]
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'number') return sort.dir === 'desc' ? bv - av : av - bv
    return sort.dir === 'desc'
      ? String(bv).localeCompare(String(av))
      : String(av).localeCompare(String(bv))
  })

  return (
    <div>
      <div className="table-toolbar">
        <div className="search-inline">
          <Icon.Search size={12} />
          <input
            placeholder="search rooms or streamers…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="mono-caps">
          {sorted.length} of {rooms.length} rooms
        </div>
      </div>
      <table className="admin-table">
        <thead>
          <tr>
            <SortHeader
              label="room"
              sortKey="name"
              sort={sort}
              setSort={setSort}
            />
            <SortHeader
              label="streamer"
              sortKey="streamer"
              sort={sort}
              setSort={setSort}
            />
            <SortHeader
              label="status"
              sortKey="status"
              sort={sort}
              setSort={setSort}
            />
            <SortHeader
              label="peak"
              sortKey="peak"
              sort={sort}
              setSort={setSort}
              align="right"
            />
            <SortHeader
              label="joined"
              sortKey="joined"
              sort={sort}
              setSort={setSort}
              align="right"
            />
            <SortHeader
              label="duration"
              sortKey="duration"
              sort={sort}
              setSort={setSort}
              align="right"
            />
            <SortHeader
              label="ended"
              sortKey="ended"
              sort={sort}
              setSort={setSort}
              align="right"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td>
                <div className="cell-room">
                  <span
                    className={r.status === 'live' ? 'live-dot' : 'ended-dot'}
                  />
                  <span>{r.name}</span>
                </div>
              </td>
              <td>
                <div className="cell-user">
                  <Avatar name={r.streamer} size="sm" /> {r.streamer}
                </div>
              </td>
              <td>
                <span className={`status-chip ${r.status}`}>
                  {r.status === 'live' ? 'LIVE' : 'ended'}
                </span>
              </td>
              <td style={{ textAlign: 'right' }}>
                <b>{r.peak}</b>
              </td>
              <td style={{ textAlign: 'right' }}>{r.joined}</td>
              <td style={{ textAlign: 'right' }} className="mut">
                {r.duration}
              </td>
              <td style={{ textAlign: 'right' }} className="mut">
                {r.ended || '—'}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={7} className="empty-cell">
                no matches
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

const TopUsersTable = ({ users, metric, label, onOpenProfile }) => (
  <div className="top-users">
    <div className="tu-head">
      <h4>{label}</h4>
      <span className="mono-caps">top 6</span>
    </div>
    <div className="tu-list">
      {users.map((u, i) => (
        <button
          key={u.username}
          className="tu-row"
          onClick={() => onOpenProfile(u.username)}
        >
          <span className="tu-rank">#{i + 1}</span>
          <Avatar name={u.username} size="sm" ring={i === 0} />
          <span className="tu-name">{u.username}</span>
          <span className="tu-val">
            {u.value.toFixed(1)}
            <span className="mut">h</span>
          </span>
          <span className="tu-bar">
            <span style={{ width: u.pct * 100 + '%' }} />
          </span>
        </button>
      ))}
    </div>
  </div>
)

// ——— Main page ———

const AdminPage = ({ liveRooms, onEnter, onOpenProfile }) => {
  const totalHoursStreamed = Object.values(USER_PROFILES).reduce(
    (s, p) => s + p.stats.hoursStreamed,
    0,
  )
  const totalHoursWatched = Object.values(USER_PROFILES).reduce(
    (s, p) => s + p.stats.hoursWatched,
    0,
  )
  const totalRoomsHosted = Object.values(USER_PROFILES).reduce(
    (s, p) => s + p.stats.roomsHosted,
    0,
  )
  const totalUsers = Object.keys(USER_PROFILES).length
  const newUsers30d = USER_GROWTH.reduce((s, d) => s + d.new_users, 0)
  const roomsCreated30d = ROOM_ACTIVITY.reduce((s, d) => s + d.created, 0)

  const topStreamers = Object.values(USER_PROFILES)
    .map((p) => ({ username: p.username, value: p.stats.hoursStreamed }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)
  const topWatchersRaw = Object.values(USER_PROFILES)
    .map((p) => ({ username: p.username, value: p.stats.hoursWatched }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)

  const maxStream = topStreamers[0]?.value || 1
  const maxWatch = topWatchersRaw[0]?.value || 1
  const topStreamersWithPct = topStreamers.map((u) => ({
    ...u,
    pct: u.value / maxStream,
  }))
  const topWatchersWithPct = topWatchersRaw.map((u) => ({
    ...u,
    pct: u.value / maxWatch,
  }))

  return (
    <div className="admin">
      <div className="admin-head">
        <div>
          <div className="admin-crumb">
            <span className="mono-caps">/admin</span>
          </div>
          <h1 className="admin-title">Dashboard</h1>
          <p className="admin-sub">
            full platform overview · restricted to admins
          </p>
        </div>
        <div className="admin-badge">
          <span className="ab-dot" />
          <span>admin access</span>
        </div>
      </div>

      {/* Stats — all-time + 30d */}
      <div className="admin-section-head">
        <h3>
          <span className="dot accent" /> platform stats
        </h3>
        <span className="mono-caps">all-time</span>
      </div>
      <div className="admin-stats">
        <AdminStatCard
          label="total users"
          value={totalUsers}
          delta={12}
          tone="accent"
        />
        <AdminStatCard
          label="hours streamed"
          value={totalHoursStreamed.toFixed(0)}
          unit="h"
          delta={18}
        />
        <AdminStatCard
          label="hours watched"
          value={totalHoursWatched.toFixed(0)}
          unit="h"
          delta={23}
        />
        <AdminStatCard
          label="rooms hosted"
          value={totalRoomsHosted}
          delta={9}
        />
        <AdminStatCard label="live now" value={liveRooms.length} tone="live" />
      </div>

      <div className="admin-section-head" style={{ marginTop: 24 }}>
        <h3>
          <span className="dot ok" /> last 30 days
        </h3>
        <span className="mono-caps">rolling window</span>
      </div>
      <div className="admin-stats">
        <AdminStatCard label="new users (30d)" value={newUsers30d} delta={7} />
        <AdminStatCard
          label="rooms created (30d)"
          value={roomsCreated30d}
          delta={14}
        />
        <AdminStatCard label="avg peak viewers" value={8.4} delta={-3} />
        <AdminStatCard label="active streamers" value={9} delta={2} />
      </div>

      {/* Charts */}
      <div className="admin-charts">
        <div className="chart-card">
          <div className="chart-head">
            <h3>user growth</h3>
            <div className="chart-legend">
              <span>
                <i style={{ background: 'var(--accent)' }} /> new users
              </span>
              <span>
                <i style={{ background: 'oklch(0.78 0.18 150)' }} /> cumulative
              </span>
            </div>
          </div>
          <LineChart
            data={USER_GROWTH}
            xKey="date"
            series={[
              { key: 'new_users', color: 'oklch(0.78 0.19 265)' },
              { key: 'cumulative', color: 'oklch(0.78 0.18 150)' },
            ]}
            height={200}
          />
        </div>

        <div className="chart-card">
          <div className="chart-head">
            <h3>room activity</h3>
            <div className="chart-legend">
              <span>
                <i style={{ background: 'oklch(0.72 0.18 220)' }} /> created
              </span>
              <span>
                <i style={{ background: 'oklch(0.72 0.22 25)' }} /> ended
              </span>
            </div>
          </div>
          <BarChart
            data={ROOM_ACTIVITY}
            xKey="date"
            series={[
              { key: 'created', color: 'oklch(0.72 0.18 220)' },
              { key: 'ended', color: 'oklch(0.72 0.22 25)' },
            ]}
            height={200}
          />
        </div>
      </div>

      {/* Live rooms */}
      <div className="admin-section-head" style={{ marginTop: 8 }}>
        <h3>
          <span className="dot live" /> live rooms
        </h3>
        <span className="mono-caps">{liveRooms.length} streaming now</span>
      </div>
      <div className="table-card">
        <LiveRoomsTable rooms={liveRooms} onEnter={onEnter} />
      </div>

      {/* All-time rooms */}
      <div className="admin-section-head">
        <h3>
          <span className="dot" style={{ background: 'var(--ink-2)' }} />{' '}
          all-time rooms
        </h3>
        <span className="mono-caps">searchable · sortable</span>
      </div>
      <div className="table-card">
        <AllTimeRoomsTable rooms={ALLTIME_ROOMS} />
      </div>

      {/* Top users */}
      <div className="admin-section-head">
        <h3>
          <span className="dot accent" /> top users
        </h3>
        <span className="mono-caps">leaderboards</span>
      </div>
      <div className="admin-top-users">
        <TopUsersTable
          users={topStreamersWithPct}
          metric="hoursStreamed"
          label="hours streamed"
          onOpenProfile={onOpenProfile}
        />
        <TopUsersTable
          users={topWatchersWithPct}
          metric="hoursWatched"
          label="hours watched"
          onOpenProfile={onOpenProfile}
        />
      </div>
    </div>
  )
}

Object.assign(window, { AdminPage })
