// Past stream recap — /past/:id — who joined, for how long, who streamed. No chat history.

const parseMins = (s = '') => {
  const h = /(\d+)\s*h/.exec(s), m = /(\d+)\s*m/.exec(s);
  return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) || 30;
};
const fmtMins = (m) => {
  m = Math.max(1, Math.round(m));
  const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
};
const seeded = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
};

// Deterministic session recap derived from the room record
const buildRecap = (room) => {
  const total = parseMins(room.started);
  const rnd = seeded(room.id + room.name);
  const streams = room.streams || [{ user: room.streamer, screen: 'browser' }];
  const names = Array.from(new Set([room.streamer, ...(room.members || []), ...streams.map(s => s.user)]));
  const people = names.map(name => {
    const host = name === room.streamer;
    const start = host ? 0 : rnd() * 0.35;
    const end = host ? 1 : Math.min(1, start + (0.4 + rnd() * 0.6) * (1 - start));
    const st = streams.find(s => s.user === name);
    let stream = null;
    if (st) {
      const len = end - start;
      const s0 = host ? start : start + rnd() * len * 0.3;
      const s1 = host ? end : Math.min(end, s0 + len * (0.4 + rnd() * 0.5));
      stream = { start: s0, end: s1, screen: st.screen, mins: (s1 - s0) * total };
    }
    return { name, host, start, end, mins: (end - start) * total, stream };
  }).sort((a, b) => (b.host - a.host) || (a.start - b.start));
  return { total, people, streamers: people.filter(p => p.stream).sort((a, b) => b.stream.mins - a.stream.mins) };
};

const RecapStat = ({ icon: I, label, value, tone }) => (
  <div className={`bg-surface border rounded-[var(--radius)] px-4 py-3.5 shadow-card flex flex-col gap-2 ${tone === 'accent' ? 'border-[color-mix(in_oklch,var(--color-primary)_45%,var(--color-border))] bg-[linear-gradient(135deg,var(--color-primary-soft),var(--color-surface)_65%)]' : 'border-border'}`}>
    <div className="flex items-center gap-2">
      <span className={`w-[22px] h-[22px] grid place-items-center rounded-md ${tone === 'accent' ? 'bg-primary text-primary-ink' : 'bg-surface-2 text-fg-muted'}`}><I size={12}/></span>
      <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-semibold">{label}</span>
    </div>
    <div className="text-2xl font-extrabold tracking-[-0.02em] leading-none">{value}</div>
  </div>
);

const RecapHead = ({ title, sub, dot = 'bg-primary shadow-[0_0_8px_var(--color-primary-glow)]' }) => (
  <div className="flex items-baseline gap-2.5 mb-3">
    <h3 className="m-0 text-[15px] font-bold inline-flex items-center gap-2 tracking-[-0.005em]">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`}/> {title}
    </h3>
    <MonoCaps>{sub}</MonoCaps>
  </div>
);

const NameLink = ({ name, onOpen, className = '' }) => (
  <button type="button" onClick={() => onOpen(name)} className={`text-left truncate cursor-pointer hover:text-primary-strong hover:underline underline-offset-2 ${className}`}>{name}</button>
);

const PastStreamPage = ({ room, onBack, onOpenProfile }) => {
  const recap = React.useMemo(() => buildRecap(room), [room.id]);
  const { total, people, streamers } = recap;
  const watchSum = people.reduce((s, p) => s + p.mins, 0);
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="overflow-auto min-h-0 h-full">
      <div className="px-4 sm:px-8 pt-5 sm:pt-6 pb-12 max-w-[1100px] mx-auto">
        <div className="flex items-center gap-2 mb-3 text-[11.5px] text-muted whitespace-nowrap min-w-0 [&>span:last-child]:truncate">
          <button onClick={onBack} className="cursor-pointer hover:text-fg">home</button>
          <span className="text-subtle">/</span>
          <span>past streams</span>
          <span className="text-subtle">/</span>
          <span className="text-fg font-semibold">{room.name}</span>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4 pb-5 mb-6 border-b border-border-subtle">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 mb-1.5">
              <h1 className="m-0 text-[20px] sm:text-[26px] font-extrabold tracking-[-0.02em] truncate">{room.name}</h1>
              <Chip>ended</Chip>
            </div>
            <div className="flex items-center gap-x-2 gap-y-1 text-xs text-muted flex-wrap [&>span]:whitespace-nowrap">
              <span>hosted by</span>
              <Avatar name={room.streamer} size="sm"/>
              <NameLink name={room.streamer} onOpen={onOpenProfile} className="text-fg-muted font-semibold"/>
              <span className="w-[3px] h-[3px] rounded-full bg-subtle"/>
              <span>lasted {fmtMins(total)}</span>
              <span className="w-[3px] h-[3px] rounded-full bg-subtle"/>
              <span>ended {room.cachedAgo || 'earlier'}</span>
            </div>
          </div>
          <Btn onClick={onBack}>back to rooms</Btn>
        </div>

        <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4 max-[820px]:grid-cols-1">
          <div className="flex flex-col gap-2">
            <StreamMosaic streams={room.streams || [{ user: room.streamer, screen: 'browser' }]} cached freshness={`last cached · ${room.cachedAgo || 'earlier'}`}/>
          </div>
          <div className="grid grid-cols-2 gap-2.5 content-start">
            <RecapStat icon={Icon.Clock || Icon.Activity} label="duration" value={fmtMins(total)} tone="accent"/>
            <RecapStat icon={Icon.Users} label="joined" value={people.length}/>
            <RecapStat icon={Icon.Screen} label="streamers" value={streamers.length}/>
            <RecapStat icon={Icon.Eye} label="watch time" value={fmtMins(watchSum)}/>
          </div>
        </div>

        <section className="mt-8">
          <RecapHead title="who streamed" sub="screen share duration" dot="bg-live shadow-[0_0_8px_var(--color-live)]"/>
          <div className="flex flex-col bg-surface border border-border rounded-[var(--radius)] overflow-hidden">
            {streamers.map(p => {
              const k = SCREEN_KINDS[p.stream.screen] || SCREEN_KINDS.browser;
              return (
                <div key={p.name} className="flex items-center gap-3 sm:gap-3.5 px-3 sm:px-4 py-3 border-b border-border-subtle last:border-b-0">
                  <button type="button" onClick={() => onOpenProfile(p.name)} className="rounded-full cursor-pointer"><Avatar name={p.name} size="md" ring={p.host}/></button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <NameLink name={p.name} onOpen={onOpenProfile} className="text-[13px] font-semibold"/>
                      {p.host && <span className="text-[9.5px] px-[5px] py-px rounded tracking-[0.05em] uppercase bg-primary text-primary-ink">host</span>}
                    </div>
                    <div className="text-[10.5px] text-subtle tracking-[0.04em] truncate">{k.label}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 sm:min-w-[140px]">
                    <div className="text-[13px] font-bold text-primary-strong">{fmtMins(p.stream.mins)}</div>
                    <div className="w-20 sm:w-[120px] h-1 rounded-full bg-surface-3 overflow-hidden">
                      <span className="block h-full rounded-full bg-live" style={{ width: (p.stream.mins / total * 100) + '%' }}/>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-8">
          <RecapHead title="who joined" sub="time in room" dot="bg-success shadow-[0_0_8px_color-mix(in_oklch,var(--color-success)_60%,transparent)]"/>
          <div className="bg-surface border border-border rounded-[var(--radius)] overflow-hidden">
            <div className="grid grid-cols-[100px_minmax(0,1fr)_52px] sm:grid-cols-[180px_minmax(0,1fr)_72px] gap-3 sm:gap-4 items-center px-3 sm:px-4 py-2 bg-canvas border-b border-border-subtle text-[10px] uppercase tracking-[0.1em] text-subtle font-semibold">
              <span>user</span>
              <div className="relative h-3">
                {ticks.map(t => (
                  <span key={t} className={`${t === 0.25 || t === 0.75 ? 'max-sm:hidden ' : ''}absolute top-0 -translate-x-1/2 normal-case tracking-normal first:translate-x-0 last:-translate-x-full`} style={{ left: t * 100 + '%' }}>{t === 0 ? '0m' : fmtMins(t * total)}</span>
                ))}
              </div>
              <span className="text-right">in room</span>
            </div>
            {people.map(p => (
              <div key={p.name} className="grid grid-cols-[100px_minmax(0,1fr)_52px] sm:grid-cols-[180px_minmax(0,1fr)_72px] gap-3 sm:gap-4 items-center px-3 sm:px-4 py-2.5 border-b border-border-subtle last:border-b-0 hover:bg-surface-2">
                <div className="flex items-center gap-2 min-w-0">
                  <button type="button" onClick={() => onOpenProfile(p.name)} className="rounded-full cursor-pointer flex-shrink-0"><Avatar name={p.name} size="sm"/></button>
                  <NameLink name={p.name} onOpen={onOpenProfile} className="text-xs font-medium"/>
                </div>
                <div className="relative h-2.5 rounded-full bg-surface-3">
                  <span className="absolute inset-y-0 rounded-full bg-[color-mix(in_oklch,var(--color-primary)_55%,transparent)]" style={{ left: p.start * 100 + '%', width: (p.end - p.start) * 100 + '%' }}/>
                  {p.stream && (
                    <span className="absolute inset-y-0 rounded-full bg-live shadow-[0_0_6px_var(--color-live)]" title={`streamed ${fmtMins(p.stream.mins)}`} style={{ left: p.stream.start * 100 + '%', width: (p.stream.end - p.stream.start) * 100 + '%' }}/>
                  )}
                </div>
                <span className="text-right text-xs font-semibold tabular-nums">{fmtMins(p.mins)}</span>
              </div>
            ))}
            <div className="flex items-center gap-4 px-4 py-2 bg-canvas border-t border-border-subtle text-[10.5px] text-muted">
              <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-[color-mix(in_oklch,var(--color-primary)_55%,transparent)]"/> in room</span>
              <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-live"/> streaming</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

Object.assign(window, { PastStreamPage });
