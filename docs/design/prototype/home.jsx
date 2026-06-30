// Home — Active Rooms view (public discovery, intimate 10-15 person rooms)

const LiveCard = ({ room, onClick }) => {
  const members = room.members || []
  return (
    <article className="live-card" onClick={() => onClick(room)}>
      <div className="lc-head">
        <div className="lc-title">{room.name}</div>
        <Chip kind="live" dot>
          LIVE
        </Chip>
      </div>
      <div className="lc-streamer">
        <AvatarStack names={members} max={4} size="md" />
        <div className="lc-streamer-txt">
          <div className="lc-streamer-name">{room.streamer}</div>
          <div className="lc-streamer-sub">
            Streamer · {members.length - 1} viewer
            {members.length - 1 === 1 ? '' : 's'}
          </div>
        </div>
      </div>
      <div className="lc-foot">
        <span className="item">
          <Icon.Users size={12} /> {room.viewers}/{room.capacity}
        </span>
        <span className="streaming-chip">
          <span className="d" /> Streaming
        </span>
      </div>
    </article>
  )
}

const PastCard = ({ room, onClick }) => {
  const members = room.members || []
  return (
    <article className="past-card" onClick={() => onClick && onClick(room)}>
      <div className="pc-title">{room.name}</div>
      <div className="pc-avatars">
        <AvatarStack names={members} max={3} size="md" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="pc-joined">{members.length} joined</div>
          <div className="pc-sub">Stream participants</div>
        </div>
      </div>
      <div className="pc-foot">
        <span className="item">
          <Icon.Users size={11} /> {members.length} joined
        </span>
        <span className="item">
          <Icon.Eye size={11} /> Ended · {room.started}
        </span>
      </div>
    </article>
  )
}

const HomePage = ({ rooms, pastRooms, onEnter, onCreate, isEmpty }) => {
  const [q, setQ] = React.useState('')
  const filtered = rooms.filter((r) =>
    r.name.toLowerCase().includes(q.toLowerCase()),
  )
  const past = (pastRooms || []).filter((r) =>
    r.name.toLowerCase().includes(q.toLowerCase()),
  )

  return (
    <div className="home">
      <div className="home-main">
        <h1 className="page-title">Active Rooms</h1>
        <div className="page-sub">
          Join live streams or browse past broadcasts
        </div>

        <div className="search-wide">
          <Icon.Search size={14} />
          <input
            placeholder="Search rooms…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="showing-count">
          Showing {filtered.length + past.length} rooms
        </div>

        {isEmpty ? (
          <div style={{ padding: '40px 0' }}>
            <EmptyBrowse onCreate={onCreate} />
          </div>
        ) : (
          <>
            <div className="section-bar">
              <h3>
                <span className="dot" /> Live Now
              </h3>
              <span className="count">({filtered.length})</span>
            </div>
            <div className="live-grid">
              {filtered.map((r) => (
                <LiveCard key={r.id} room={r} onClick={onEnter} />
              ))}
            </div>

            {past.length > 0 && (
              <>
                <div className="section-bar past">
                  <h3>
                    <span className="dot" /> Past Streams
                  </h3>
                  <span className="count">({past.length})</span>
                </div>
                <div className="past-grid">
                  {past.map((r) => (
                    <PastCard key={r.id} room={r} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <aside className="stats-side">
        <div className="panel">
          <div className="panel-head">
            <span className="ico">
              <Icon.Sparkle size={12} />
            </span>{' '}
            Global Stats
          </div>
          <div className="stats-grid">
            <div className="stat-mini">
              <div className="k">
                <Icon.Users size={10} /> Online
              </div>
              <div className="v">
                {CREW.filter((c) => c.status !== 'offline').length}
              </div>
            </div>
            <div className="stat-mini">
              <div className="k">
                <Icon.Broadcast size={10} /> Rooms
              </div>
              <div className="v">{rooms.length}</div>
            </div>
            <div className="stat-mini">
              <div className="k">
                <Icon.Eye size={10} /> Hours Today
              </div>
              <div className="v">
                42<span className="unit">h</span>
              </div>
            </div>
            <div className="stat-mini">
              <div className="k">
                <Icon.Trend size={10} /> Peak Users
              </div>
              <div className="v">
                {rooms.reduce((s, r) => s + r.viewers, 0)}
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="ico">
              <Icon.Bolt size={12} />
            </span>{' '}
            Trending Now
          </div>
          {rooms.slice(0, 3).map((r) => (
            <div key={r.id} className="trend-row" onClick={() => onEnter(r)}>
              <Avatar name={r.streamer} size="md" />
              <div className="t">
                <div className="n">{r.name}</div>
                <div className="m">{r.streamer}</div>
              </div>
              <span className="delta">+{Math.floor(r.viewers / 2)}</span>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="ico">
              <Icon.Users size={12} />
            </span>{' '}
            Community
          </div>
          <div className="community-row">
            <span className="k">
              <span className="ico">
                <Icon.Users size={11} />
              </span>{' '}
              Total Users
            </span>
            <span className="v">{CREW.length}</span>
          </div>
          <div className="community-row">
            <span className="k">
              <span className="ico">
                <Icon.Eye size={11} />
              </span>{' '}
              Watch Time (Week)
            </span>
            <span className="v accent">&lt;1h</span>
          </div>
          <div className="community-row">
            <span className="k">
              <span className="ico">
                <Icon.Broadcast size={11} />
              </span>{' '}
              Active Streamers (30d)
            </span>
            <span className="v">3</span>
          </div>
          <div className="community-row">
            <span className="k">
              <span className="ico">
                <Icon.Plus size={11} />
              </span>{' '}
              New This Week
            </span>
            <span className="v">+0</span>
          </div>
        </div>

        <div className="join-card">
          <h4>Join BhayanakCast</h4>
          <p>
            Create your own rooms, track your watch time, and connect with other
            viewers.
          </p>
          <button
            className="btn primary sm"
            style={{ width: '100%' }}
            onClick={onCreate}
          >
            Get Started
          </button>
        </div>
      </aside>
    </div>
  )
}

const EmptyBrowse = ({ onCreate }) => (
  <div className="empty">
    <div className="empty-card">
      <div className="big">
        <Icon.Broadcast size={32} />
      </div>
      <h2>No live rooms right now</h2>
      <p>
        Rooms cap at 10–15 people so whoever shows up will actually vibe. Start
        one and invite your crew.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button className="btn primary" onClick={onCreate}>
          <Icon.Plus size={14} /> Start a Room
        </button>
        <button className="btn">
          <Icon.Bell size={14} /> Notify Me
        </button>
      </div>
    </div>
  </div>
)

Object.assign(window, { HomePage, EmptyBrowse, LiveCard, PastCard })
