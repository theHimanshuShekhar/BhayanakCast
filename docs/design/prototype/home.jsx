// Home — Active Rooms view — Tailwind v4 utilities

const cardBase = 'bg-surface border border-border rounded-[var(--radius)] p-3.5 cursor-pointer flex flex-col gap-2.5 min-w-0';
const cardFoot = 'flex items-center pt-2.5 border-t border-dashed border-border-subtle text-muted';
const panelCls = 'bg-canvas border border-border rounded-[var(--radius)] shadow-card p-3.5';

// Mosaic of live screen shares: 1 full · 2 split · 3 hero+stack · 4 quad
const MOSAIC_GRID = {
  1: 'grid-cols-1 grid-rows-1',
  2: 'grid-cols-2 grid-rows-1',
  3: 'grid-cols-2 grid-rows-2 [&>*:first-child]:row-span-2',
  4: 'grid-cols-2 grid-rows-2',
};

const pill = 'inline-flex items-center gap-1 px-2 py-[3px] rounded-full bg-black/55 backdrop-blur-[6px] text-[10px] text-white tracking-[0.04em]';

const StreamMosaic = ({ streams, cached = false, frame = 0, freshness }) => {
  const list = streams.slice(0, 4);
  const n = Math.max(1, list.length);
  return (
    <div className="relative aspect-video rounded-[var(--radius-sm)] overflow-hidden bg-[oklch(0.14_0.02_260)] border border-border-subtle">
      <div key={frame} className={`absolute inset-0 grid gap-[2px] animate-bc-fade ${MOSAIC_GRID[n]} ${cached ? 'saturate-[0.35] brightness-[0.8]' : ''}`}>
        {list.map((s, i) => (
          <div key={i} className="relative min-w-0 min-h-0 overflow-hidden">
            <ScreenPlaceholder kind={s.screen} label={false} frame={frame}/>
            {n > 1 && (
              <span className="absolute bottom-1.5 left-1.5 z-[2] inline-flex items-center gap-1 max-w-[calc(100%-12px)] pl-0.5 pr-1.5 py-0.5 rounded-full bg-black/55 backdrop-blur-[6px] text-[9.5px] font-semibold text-white">
                <Avatar name={s.user} size="sm" className="!w-3.5 !h-3.5 !text-[6px]"/>
                <span className="truncate">{s.user}</span>
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(180deg,oklch(0_0_0/0.35),transparent_35%)]"/>
      <div className="absolute top-2 left-2 right-2 z-[3] flex items-start justify-between">
        {cached
          ? <span className={`${pill} uppercase tracking-[0.08em]`}>ended</span>
          : <Chip kind="liveSolid" dot>LIVE</Chip>}
        <div className="flex flex-col items-end gap-1">
          <span className={pill}><Icon.Screen size={10}/> {n} {n === 1 ? 'stream' : 'streams'}</span>
          {freshness && <span className={`${pill} !text-[9.5px] !text-white/85`}>{freshness}</span>}
        </div>
      </div>
    </div>
  );
};

const SNAPSHOT_MS = 3 * 60 * 1000;
const useSnapshots = () => {
  const [frame, setFrame] = React.useState(0);
  const [at, setAt] = React.useState(Date.now());
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const snap = setInterval(() => { setFrame(f => f + 1); setAt(Date.now()); }, SNAPSHOT_MS);
    const clock = setInterval(() => tick(t => t + 1), 20000);
    return () => { clearInterval(snap); clearInterval(clock); };
  }, []);
  const mins = Math.floor((Date.now() - at) / 60000);
  return { frame, freshness: mins < 1 ? 'updated just now' : `updated ${mins}m ago` };
};

const LiveCard = ({ room, onClick, snap = {} }) => {
  const members = room.members || [];
  return (
    <article role="button" tabIndex={0} aria-label={`Join ${room.name}`} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick(room))} className={`${cardBase} shadow-pop transition-[transform,border-color] duration-[160ms] ease-[cubic-bezier(.2,.7,.2,1)] hover:-translate-y-0.5 hover:border-[color-mix(in_oklch,var(--color-primary)_40%,var(--color-border))]`} onClick={() => onClick(room)}>
      <StreamMosaic streams={room.streams || [{ user: room.streamer, screen: 'browser' }]} frame={snap.frame} freshness={snap.freshness}/>
      <div className="text-[15px] font-bold tracking-[-0.005em] truncate">{room.name}</div>
      <div className="flex items-center gap-2.5">
        <AvatarStack names={members} max={4} size="md"/>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold">{room.streamer}</div>
          <div className="text-[10.5px] text-muted">Streamer · {members.length - 1} viewer{members.length - 1 === 1 ? '' : 's'}</div>
        </div>
      </div>
      <div className={`${cardFoot} gap-3 text-[11px]`}>
        <span className="inline-flex items-center gap-1.5"><Icon.Users size={12}/> {room.viewers}/{room.capacity}</span>
        <span className="inline-flex items-center gap-1.5 text-success"><span className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_6px_var(--color-success)]"/> Streaming</span>
      </div>
    </article>
  );
};

const PastCard = ({ room, onClick }) => {
  const members = room.members || [];
  return (
    <article role="button" tabIndex={0} aria-label={`View recap of ${room.name}`} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onClick && (e.preventDefault(), onClick(room))} className={`${cardBase} shadow-card transition-[transform,border-color] duration-[120ms] hover:-translate-y-px hover:border-border-strong`} onClick={() => onClick && onClick(room)}>
      <StreamMosaic streams={room.streams || [{ user: room.streamer, screen: 'browser' }]} cached freshness={`cached · ${room.cachedAgo || 'earlier'}`}/>
      <div className="text-[13.5px] font-semibold">{room.name}</div>
      <div className="flex items-center gap-2.5">
        <AvatarStack names={members} max={3} size="md"/>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold">{members.length} joined</div>
          <div className="text-[10.5px] text-muted">Stream participants</div>
        </div>
      </div>
      <div className={`${cardFoot} gap-2.5 text-[10.5px]`}>
        <span className="inline-flex items-center gap-1"><Icon.Users size={11}/> {members.length} joined</span>
        <span className="inline-flex items-center gap-1"><Icon.Eye size={11}/> Ended · {room.started}</span>
      </div>
    </article>
  );
};

const SectionBar = ({ title, count, live }) => (
  <div className="flex items-center gap-2.5 mt-[18px] mb-3">
    <h3 className="m-0 text-[15px] font-bold tracking-[-0.005em] inline-flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${live ? 'bg-live shadow-[0_0_8px_var(--color-live)] animate-bc-pulse' : 'bg-subtle'}`}/>
      {title}
    </h3>
    <span className="text-xs text-subtle">({count})</span>
  </div>
);

const PanelHead = ({ icon: I, children }) => (
  <div className="flex items-center gap-[7px] mb-2.5 text-[11px] uppercase tracking-[0.1em] text-fg-muted font-semibold">
    <span className="inline-flex text-primary"><I size={12}/></span> {children}
  </div>
);

const StatMini = ({ icon: I, label, value, unit }) => (
  <div className="bg-surface border border-border rounded-[10px] px-3 py-2.5 shadow-card">
    <div className="inline-flex items-center gap-[5px] text-[10px] tracking-[0.06em] text-muted uppercase"><I size={10}/> {label}</div>
    <div className="mt-1 text-lg font-bold tracking-[-0.01em]">{value}{unit && <span className="ml-[3px] text-[11px] text-muted font-normal">{unit}</span>}</div>
  </div>
);

const CommunityRow = ({ icon: I, label, value, accent }) => (
  <div className="flex items-center justify-between py-2 [&+&]:border-t [&+&]:border-dashed [&+&]:border-border-subtle">
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-muted"><span className="inline-flex text-subtle"><I size={11}/></span> {label}</span>
    <span className={`text-[12.5px] font-semibold px-2 py-0.5 rounded-md ${accent ? 'bg-primary text-primary-ink' : 'bg-surface-2 text-fg'}`}>{value}</span>
  </div>
);

const UserResult = ({ user, liveRoom, onOpen }) => (
  <button onClick={() => onOpen(user.username)}
    className="flex items-center gap-3 p-3 text-left bg-surface border border-border rounded-[var(--radius)] shadow-card cursor-pointer transition-[transform,border-color] duration-[120ms] hover:-translate-y-px hover:border-border-strong min-w-0">
    <Avatar name={user.username} size="lg" ring={!!liveRoom}/>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold truncate">{user.username}</span>
        {liveRoom && <Chip kind="live" dot>LIVE</Chip>}
      </div>
      <div className="text-[10.5px] text-muted truncate">
        {liveRoom ? <>in <span className="text-fg-muted font-medium">{liveRoom.name}</span></> : user.discord}
      </div>
      <div className="flex gap-3 mt-1 text-[10.5px] text-subtle">
        <span className="inline-flex items-center gap-1"><Icon.Broadcast size={10}/> {user.stats.hoursStreamed.toFixed(0)}h</span>
        <span className="inline-flex items-center gap-1"><Icon.Eye size={10}/> {user.stats.hoursWatched.toFixed(0)}h</span>
      </div>
    </div>
  </button>
);

const HomePage = ({ rooms, pastRooms, onEnter, onCreate, onOpenProfile, onOpenPast, isEmpty }) => {
  const [q, setQ] = React.useState('');
  const snap = useSnapshots();
  const KIND_LABELS = { gaming: 'gaming', code: 'coding', music: 'music', art: 'art', watch: 'watch party', chat: 'just chatting' };
  const matches = (r) => {
    const term = q.trim().toLowerCase();
    if (!term) return true;
    const tags = (r.tags || []).map(t => t.toLowerCase());
    if (term.startsWith('#')) return tags.some(t => t.includes(term.slice(1)));
    const hay = [r.name, r.streamer, ...(r.members || []), ...tags, r.kind, KIND_LABELS[r.kind]]
      .filter(Boolean).map(s => s.toLowerCase());
    return hay.some(s => s.includes(term));
  };
  const filtered = rooms.filter(matches);
  const past = (pastRooms || []).filter(matches);
  const term = q.trim().toLowerCase();
  const users = term && !term.startsWith('#')
    ? Object.values(USER_PROFILES).filter(u => u.username.toLowerCase().includes(term) || u.discord.toLowerCase().includes(term))
    : [];
  const liveRoomOf = (name) => rooms.find(r => (r.streams || []).some(s => s.user === name)) || rooms.find(r => (r.members || []).includes(name));

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] content-start lg:content-stretch gap-6 px-6 py-5 max-sm:px-3.5 max-sm:py-4 h-full overflow-auto lg:overflow-hidden">
      <div className="lg:min-h-0 lg:overflow-auto min-w-0">
        <h1 className="m-0 mb-1 text-xl sm:text-2xl font-extrabold tracking-[-0.01em]">Active Rooms</h1>
        <div className="mb-4 text-[12.5px] text-muted">Join live streams or browse past broadcasts</div>

        <div className="flex items-center gap-2.5 h-10 px-3.5 mb-3.5 bg-canvas border border-border rounded-[10px] text-muted">
          <Icon.Search size={14}/>
          <input className="flex-1 bg-transparent border-0 outline-0 text-fg text-[12.5px]" placeholder="Search rooms, users, #tags or categories…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Escape' && setQ('')}/>
          {q && (
            <button type="button" onClick={() => setQ('')} title="Clear search" aria-label="Clear search"
              className="w-6 h-6 -mr-1.5 inline-flex items-center justify-center rounded-md text-muted cursor-pointer hover:bg-surface-2 hover:text-fg transition-colors">
              <Icon.Close size={12}/>
            </button>
          )}
        </div>

        <div className="mb-2.5 text-[11px] text-subtle tracking-[0.04em]">
          Showing {filtered.length + past.length} rooms{term && !term.startsWith('#') ? ` · ${users.length} users` : ''}
        </div>

        {users.length > 0 && (
          <>
            <div className="flex items-center gap-2.5 mt-[18px] mb-3">
              <h3 className="m-0 text-[15px] font-bold tracking-[-0.005em] inline-flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary-glow)]"/> Users
              </h3>
              <span className="text-xs text-subtle">({users.length})</span>
            </div>
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))]">
              {users.map(u => <UserResult key={u.username} user={u} liveRoom={liveRoomOf(u.username)} onOpen={onOpenProfile}/>)}
            </div>
          </>
        )}

        {isEmpty ? (
          <div className="py-10"><EmptyBrowse onCreate={onCreate}/></div>
        ) : (
          <>
            {(!term || filtered.length > 0) && <SectionBar title="Live Now" count={filtered.length} live/>}
            <div className="grid gap-3.5 grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))]">
              {filtered.map(r => <LiveCard key={r.id} room={r} onClick={onEnter} snap={snap}/>)}
            </div>
            {past.length > 0 && (
              <>
                <SectionBar title="Past Streams" count={past.length}/>
                <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(230px,100%),1fr))]">
                  {past.map(r => <PastCard key={r.id} room={r} onClick={onOpenPast}/>)}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <aside className="flex flex-col gap-3.5 lg:min-h-0 lg:overflow-auto [&>*]:shrink-0 max-lg:grid max-lg:sm:grid-cols-2 max-lg:items-start">
        {(() => {
          const P = Object.values(USER_PROFILES);
          const streamers = new Set(rooms.flatMap(r => (r.streams || []).map(s => s.user)));
          const watching = rooms.reduce((s, r) => s + (r.viewers || 0), 0);
          const trending = [...rooms].sort((a, b) => (b.viewers / (b.capacity || 1)) - (a.viewers / (a.capacity || 1))).slice(0, 3);
          return (
            <>
              <div className={panelCls}>
                <PanelHead icon={Icon.Sparkle}>Right Now</PanelHead>
                <div className="grid grid-cols-2 gap-2">
                  <StatMini icon={Icon.Users} label="Online" value={CREW.filter(c => c.status !== 'offline').length}/>
                  <StatMini icon={Icon.Broadcast} label="Live Rooms" value={rooms.length}/>
                  <StatMini icon={Icon.Eye} label="Watching" value={watching}/>
                  <StatMini icon={Icon.Screen} label="Streaming" value={streamers.size}/>
                </div>
              </div>

              <div className={panelCls}>
                <PanelHead icon={Icon.Bolt}>Filling Up</PanelHead>
                {trending.map(r => (
                  <div key={r.id} role="button" tabIndex={0} onClick={() => onEnter(r)} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onEnter(r))}
                    className="flex items-center gap-2.5 p-2 -mx-2 rounded-lg cursor-pointer hover:bg-surface">
                    <Avatar name={r.streamer} size="md"/>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{r.name}</div>
                      <div className="text-[10.5px] text-muted">{r.streamer}</div>
                    </div>
                    <span className="text-[10.5px] font-semibold text-success-ink px-1.5 py-0.5 rounded-md tabular-nums bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)]">{r.viewers}/{r.capacity}</span>
                  </div>
                ))}
              </div>

              <div className={panelCls}>
                <PanelHead icon={Icon.Users}>Community</PanelHead>
                <CommunityRow icon={Icon.Users} label="Members" value={P.length}/>
                <CommunityRow icon={Icon.Eye} label="Hours Watched" value={Math.round(P.reduce((s, p) => s + p.stats.hoursWatched, 0)) + 'h'} accent/>
                <CommunityRow icon={Icon.Broadcast} label="Hours Streamed" value={Math.round(P.reduce((s, p) => s + p.stats.hoursStreamed, 0)) + 'h'}/>
                <CommunityRow icon={Icon.Plus} label="Rooms Hosted" value={P.reduce((s, p) => s + p.stats.roomsHosted, 0)}/>
              </div>
            </>
          );
        })()}
      </aside>
    </div>
  );
};

const EmptyBrowse = ({ onCreate }) => (
  <div className="grid place-items-center h-full p-10">
    <div className="relative overflow-hidden text-center max-w-[440px] px-7 py-10 bg-canvas border border-border rounded-[var(--radius-lg)] shadow-pop">
      <div className="absolute -inset-px pointer-events-none bg-[radial-gradient(200px_120px_at_50%_0%,var(--color-primary-soft),transparent_60%)]"/>
      <div className="relative w-[72px] h-[72px] mx-auto mb-[18px] rounded-[20px] grid place-items-center bg-surface border border-border text-primary shadow-[var(--shadow-card),0_0_32px_var(--color-primary-glow)]"><Icon.Broadcast size={32}/></div>
      <h2 className="relative m-0 mb-2 text-lg tracking-[-0.01em]">No live rooms right now</h2>
      <p className="relative m-0 mb-[18px] text-muted text-[12.5px]">Rooms cap at 10–15 people so whoever shows up will actually vibe. Start one and invite your crew.</p>
      <div className="relative flex gap-2 justify-center">
        <Btn variant="primary" onClick={onCreate}><Icon.Plus size={14}/> Start a Room</Btn>
        <Btn><Icon.Bell size={14}/> Notify Me</Btn>
      </div>
    </div>
  </div>
);

Object.assign(window, { HomePage, EmptyBrowse, LiveCard, PastCard, StreamMosaic });
