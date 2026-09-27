// Room view — stage + mosaic + controls + sidebar — Tailwind v4 utilities

const DENSITY_CLS = {
  compact: 'gap-2 p-2.5 auto-rows-[minmax(120px,auto)]',
  comfortable: 'gap-3 p-4 auto-rows-[minmax(140px,auto)]',
  spacious: 'gap-[18px] p-[22px] auto-rows-[minmax(180px,auto)]',
};

const tileSpan = (p, layout) => {
  const small = p.viewerOnly || p.size === 'xs';
  // phones/tablets: 2-col grid — hero tiles full width, others half
  const m = small ? ' max-md:col-span-1 max-md:row-span-1' : p.size === 'l' ? ' max-md:col-span-2 max-md:row-span-2' : ' max-md:col-span-1 max-md:row-span-2';
  return tileSpanDesktop(p, layout, small) + m;
};
const tileSpanDesktop = (p, layout, small) => {
  if (small) return 'col-span-2 row-span-1';
  if (layout === 'grid') return 'col-span-3 row-span-2';
  if (layout === 'spotlight') return p.size === 'l' ? 'col-span-8 row-span-4' : 'col-span-4 row-span-2';
  return { l: 'col-span-6 row-span-3', m: 'col-span-4 row-span-2', s: 'col-span-3 row-span-2' }[p.size] || 'col-span-4 row-span-2';
};

const tileBase = '@container group relative bg-surface border border-border rounded-[var(--radius)] overflow-hidden flex flex-col min-w-0 min-h-0';
const glassPill = 'bg-black/55 backdrop-blur-[8px] text-white';
const overlayBtn = 'w-[26px] h-[26px] inline-flex items-center justify-center rounded-[var(--radius-sm)] text-white cursor-pointer hover:bg-white/20 transition-colors';

const Tile = ({ p, layout, onPin }) => {
  const [reactions, setReactions] = React.useState([]);
  const [viewers] = React.useState(() => Math.floor(60 + Math.random() * 800));

  React.useEffect(() => {
    if (!p.streaming) return;
    const iv = setInterval(() => {
      if (Math.random() > 0.75) {
        const emojis = ['🔥', '💯', '✨', '🎧', '⚡', '🫡'];
        const id = Date.now() + Math.random();
        const dx = (Math.random() - 0.5) * 60;
        const e = emojis[Math.floor(Math.random() * emojis.length)];
        setReactions(r => [...r, { id, e, dx }]);
        setTimeout(() => setReactions(r => r.filter(x => x.id !== id)), 2400);
      }
    }, 3200);
    return () => clearInterval(iv);
  }, [p.streaming]);

  const span = tileSpan(p, layout);

  if (p.viewerOnly) {
    return (
      <div className={`${tileBase} ${span} shadow-pop`}>
        <div className="flex items-center gap-2.5 px-3 py-2.5 h-full">
          <Avatar name={p.name} size="md" ring={p.speaking}/>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold truncate">{p.name}{p.you && p.name !== 'you' && ' (you)'}</div>
            <div className="text-[10.5px] text-muted">viewer</div>
          </div>
          <div className="text-muted">{p.muted ? <Icon.MicOff size={14}/> : <Icon.Mic size={14}/>}</div>
        </div>
      </div>
    );
  }

  const ring = p.speaking
    ? 'shadow-[var(--shadow-pop),0_0_0_2px_var(--color-primary),0_0_24px_var(--color-primary-glow)]'
    : p.streaming
      ? 'shadow-[var(--shadow-pop),0_0_0_1px_color-mix(in_oklch,var(--color-live)_40%,transparent),0_0_26px_color-mix(in_oklch,var(--color-live)_25%,transparent)]'
      : 'shadow-pop';

  return (
    <div className={`${tileBase} ${span} ${ring}`}>
      {p.streaming ? (
        <ScreenPlaceholder kind={p.screen || 'ableton'}/>
      ) : (
        <div className="flex-1 relative min-h-0 overflow-hidden grid place-items-center bg-[oklch(0.22_0.02_260)]">
          <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,oklch(0.26_0.02_260)_0,oklch(0.26_0.02_260)_12px,oklch(0.20_0.02_260)_12px,oklch(0.20_0.02_260)_24px)]"/>
          <div className="relative z-[1] flex flex-col items-center gap-2.5">
            <Avatar name={p.name} size="lg" ring={p.speaking}/>
            <div className="text-[10px] tracking-[0.14em] px-2 py-[3px] rounded-full text-[oklch(0.85_0.01_260)] bg-black/45 border border-white/12">{p.camera ? 'CAM · NO SHARE' : 'AUDIO ONLY'}</div>
          </div>
        </div>
      )}

      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(180deg,oklch(0_0_0/0)_40%,oklch(0_0_0/0.55))]"/>

      <div className="absolute top-2.5 left-2.5 z-[3] flex gap-1.5">
        {p.streaming && <Chip kind="liveSolid" dot>LIVE</Chip>}
        {p.role === 'host' && <Chip kind="accent">host</Chip>}
        {p.pinned && <Chip className="!bg-black/55 !text-white !border-transparent"><Icon.Pin size={10}/> pinned</Chip>}
      </div>

      {p.streaming && (
        <div className="absolute top-2.5 right-2.5 z-[3] flex gap-1.5 transition-opacity group-hover:opacity-0">
          <span className={`inline-flex items-center gap-[5px] px-2 py-[3px] rounded-full text-[10.5px] ${glassPill}`}><Icon.Eye size={11}/> {viewers}</span>
        </div>
      )}

      <div className={`absolute top-2.5 right-2.5 z-[4] flex gap-1 p-[3px] rounded-[10px] border border-white/14 opacity-0 -translate-y-1 transition-[opacity,transform] duration-[160ms] group-hover:opacity-100 group-hover:translate-y-0 ${glassPill}`}>
        <button className={overlayBtn} title={p.pinned ? 'Unpin' : 'Pin'} onClick={() => onPin && onPin(p.id)}><Icon.Pin size={14}/></button>
        <button className={overlayBtn} title="Mute"><Icon.Headset size={14}/></button>
        <button className={overlayBtn} title="Fullscreen"><Icon.Maximize size={14}/></button>
        <button className={overlayBtn} title="More"><Icon.More size={14}/></button>
      </div>

      {p.streaming && p.camera && (
        <div className="absolute bottom-2.5 right-2.5 z-[3] w-14 aspect-[4/3] hidden @[300px]:grid rounded-lg overflow-hidden border border-border-strong shadow-pop grid place-items-center"
          style={{ background: `linear-gradient(135deg, ${avatarFor(p.name).c1}, ${avatarFor(p.name).c2})` }}>
          <Avatar name={p.name} size="sm"/>
        </div>
      )}

      <div className={`absolute bottom-2.5 left-2.5 z-[3] ${p.camera ? 'right-2.5 @[300px]:right-[76px]' : 'right-2.5'} flex items-center gap-2`}>
        <span className={`inline-flex items-center gap-2 max-w-full py-[5px] pl-[5px] pr-[9px] rounded-full text-[11px] font-semibold truncate ${glassPill}`}>
          <Avatar name={p.name} size="sm"/>
          <span className="inline-flex items-center gap-1.5">
            {p.name}{p.you && p.name !== 'you' && ' (you)'}
            {p.speaking ? <Wave on/> : p.muted ? <Icon.MicOff size={12}/> : null}
          </span>
        </span>
      </div>

      {reactions.map(r => (
        <span key={r.id} className="absolute bottom-4 left-1/2 z-[5] text-[22px] pointer-events-none animate-bc-float drop-shadow-[0_0_8px_var(--color-primary-glow)]" style={{ '--dx': `${r.dx}px` }}>{r.e}</span>
      ))}
    </div>
  );
};

const ROLE_BADGE = {
  mod: 'bg-primary-soft text-primary-strong border border-[color-mix(in_oklch,var(--color-primary)_35%,transparent)]',
  streamer: 'bg-primary text-primary-ink border border-transparent',
};
const RoleBadge = ({ role, children }) => (
  <span className={`text-[9.5px] px-[5px] py-px rounded tracking-[0.05em] uppercase ${ROLE_BADGE[role] || 'bg-surface-2 text-muted border border-border'}`}>{children}</span>
);

const renderMentions = (text) => text.split(/(@\w+)/g).map((part, i) =>
  part.startsWith('@') ? <span key={i} className="text-primary font-semibold">{part}</span> : part
);

const ChatMessage = ({ m, host, onOpenProfile }) => {
  if (m.system) return (
    <div className="my-1.5 py-1.5 text-center text-[10.5px] text-muted tracking-[0.04em] border-y border-dashed border-border">— {m.text} —</div>
  );
  const isHost = m.user === host;
  const whoCls = isHost ? 'text-primary-strong' : m.role === 'mod' ? 'text-primary-strong' : '';
  return (
    <div className="flex gap-2 py-1.5">
      <button type="button" onClick={() => onOpenProfile(m.user)} className="self-start rounded-full cursor-pointer"><Avatar name={m.user} size="sm"/></button>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <button type="button" onClick={() => onOpenProfile(m.user)} className={`font-semibold text-[11.5px] cursor-pointer hover:underline underline-offset-2 ${whoCls}`}>{m.user}</button>
          {isHost ? <RoleBadge role="streamer">host</RoleBadge> : m.role === 'mod' && <RoleBadge role="mod">mod</RoleBadge>}
          <span className="text-[10px] text-subtle">{m.ts}</span>
        </div>
        <div className="text-xs text-fg break-words">{renderMentions(m.text)}</div>
      </div>
    </div>
  );
};

const GroupHead = ({ children, count }) => (
  <div className="flex items-center gap-2 mt-2.5 mb-1.5 mx-1 text-[10px] uppercase tracking-[0.12em] text-muted">
    {children} <span className="bg-surface-2 px-1.5 py-px rounded-full text-[9.5px] text-muted">{count}</span>
  </div>
);

const SideTab = ({ active, onClick, children }) => (
  <button onClick={onClick} className={`flex-1 h-8 text-[11px] rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer ${active ? 'bg-surface-2 text-fg shadow-card' : 'text-muted hover:text-fg'}`}>
    {children}
  </button>
);

const RoomSide = ({ room, chat, onSend, onOpenProfile, open, onClose }) => {
  const [tab, setTab] = React.useState('chat');
  const [draft, setDraft] = React.useState('');
  const bodyRef = React.useRef(null);

  React.useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [chat.length, tab]);

  const submit = (e) => {
    e?.preventDefault();
    if (!draft.trim()) return;
    onSend(draft.trim());
    setDraft('');
  };

  const groups = [
    ['streaming', room.participants.filter(p => p.streaming)],
    ['host & mods', room.participants.filter(p => !p.streaming && (p.role === 'mod' || p.role === 'host'))],
    ['viewers', room.participants.filter(p => !p.streaming && p.role === 'member')],
  ];
  const body = 'flex-1 min-h-0 overflow-auto px-3 py-2.5';

  return (
    <aside className={`flex flex-col min-w-0 min-h-0 bg-canvas border-l border-border-subtle max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-[120] max-lg:w-[min(380px,100%)] max-lg:shadow-deep ${open ? '' : 'max-lg:hidden'}`}>
      <div className="flex items-center gap-0.5 p-2.5 pb-0">
        <SideTab active={tab === 'chat'} onClick={() => setTab('chat')}><Icon.Chat size={13}/> chat</SideTab>
        <SideTab active={tab === 'people'} onClick={() => setTab('people')}><Icon.Users size={13}/> people · {room.participants.length}</SideTab>
        <SideTab active={tab === 'activity'} onClick={() => setTab('activity')}><Icon.Activity size={13}/> feed</SideTab>
        <IconBtn onClick={onClose} aria-label="Close panel" className="lg:hidden !w-8 !h-8 flex-shrink-0"><Icon.Close size={14}/></IconBtn>
      </div>

      {tab === 'chat' && (
        <>
          <div className={body} ref={bodyRef}>
            {chat.map(m => <ChatMessage key={m.id} m={m} host={room.host} onOpenProfile={onOpenProfile}/>)}
          </div>
          <div className="px-3 py-2.5 border-t border-border-subtle bg-canvas">
            <form className="flex items-center gap-1.5 bg-surface border border-border rounded-xl py-1 pr-1 pl-3" onSubmit={submit}>
              <input className="flex-1 min-w-0 bg-transparent border-0 outline-0 h-8 text-xs" placeholder="say something…" value={draft} onChange={e => setDraft(e.target.value)}/>
              <IconBtn type="button" className="!w-7 !h-7"><Icon.Gif size={14}/></IconBtn>
              <IconBtn type="button" className="!w-7 !h-7"><Icon.Smile size={14}/></IconBtn>
              <IconBtn type="submit" className="!w-7 !h-7 !text-primary"><Icon.Send size={14}/></IconBtn>
            </form>
          </div>
        </>
      )}

      {tab === 'people' && (
        <div className={body}>
          {groups.map(([label, list]) => list.length > 0 && (
            <React.Fragment key={label}>
              <GroupHead count={list.length}>{label}</GroupHead>
              {list.map(p => <ParticipantRow key={p.id} p={p} onOpenProfile={onOpenProfile}/>)}
            </React.Fragment>
          ))}
        </div>
      )}

      {tab === 'activity' && (
        <div className={body}>
          {[...ACTIVITY, ...ACTIVITY].map((a, i) => (
            <div key={i} className="flex gap-2.5 py-2 border-t border-dashed border-border-subtle first:border-t-0">
              <span className="w-[7px] h-[7px] mt-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary-glow)] flex-shrink-0"/>
              <div className="text-[11.5px] text-fg-muted leading-normal">
                <span className="text-fg font-semibold">{a.who}</span> {a.what}
                <span className="block mt-0.5 text-[10.5px] text-subtle">{a.when}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
};

const ParticipantRow = ({ p, onOpenProfile }) => (
  <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface">
    <button type="button" onClick={() => onOpenProfile(p.name)} title={`View ${p.name}'s profile`} className="rounded-full cursor-pointer hover:brightness-110"><Avatar name={p.name} size="md" ring={p.speaking}/></button>
    <div className="flex-1 min-w-0">
      <button type="button" onClick={() => onOpenProfile(p.name)} className="block max-w-full text-left text-xs font-medium truncate cursor-pointer hover:text-primary-strong hover:underline underline-offset-2">{p.name}{p.you && p.name !== 'you' && ' (you)'}</button>
      <div className="flex items-center gap-1.5 text-[10.5px] text-muted">
        {p.role === 'host' && <RoleBadge role="streamer">host</RoleBadge>}
        {p.role === 'mod' && <RoleBadge role="mod">mod</RoleBadge>}
        {p.streaming && <Chip kind="live" dot>live</Chip>}
      </div>
    </div>
    <div className="flex gap-1 text-muted">
      {p.muted ? <Icon.MicOff size={13}/> : <Icon.Mic size={13}/>}
      {p.camera ? <Icon.Cam size={13}/> : <Icon.CamOff size={13}/>}
    </div>
  </div>
);

const ControlBtn = ({ state, className = '', children, ...rest }) => {
  const st = state === 'active'
    ? 'bg-primary text-primary-ink border-transparent shadow-[0_0_18px_var(--color-primary-glow)]'
    : state === 'muted'
      ? 'bg-[color-mix(in_oklch,var(--color-live)_22%,var(--color-surface-2))] text-live-ink border-[color-mix(in_oklch,var(--color-live)_40%,transparent)]'
      : 'bg-surface-2 text-fg border-border hover:bg-surface-3';
  return (
    <button className={`w-10 h-10 rounded-full grid place-items-center border cursor-pointer transition-all duration-[120ms] ${st} ${className}`} {...rest}>
      {children}
    </button>
  );
};

const RoomPage = ({ room, onLeave, tweaks, onOpenProfile = () => {} }) => {
  const [showViewers, setShowViewers] = React.useState(true);
  const [mic, setMic] = React.useState(false);
  const [cam, setCam] = React.useState(false);
  const [share, setShare] = React.useState(false);
  const [chat, setChat] = React.useState(room.chat || CHAT_SEED);
  const [pinnedId, setPinnedId] = React.useState(null);
  const [sideOpen, setSideOpen] = React.useState(false);
  React.useEffect(() => { setChat(room.chat || CHAT_SEED); setPinnedId(null); }, [room.id]);
  const togglePin = (id) => setPinnedId(p => p === id ? null : id);

  const send = (text) => {
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    setChat(c => [...c, { id: 'c' + Date.now(), user: 'you', role: 'member', ts, text }]);
  };

  const base = showViewers ? room.participants : room.participants.filter(p => !p.viewerOnly);
  const participants = pinnedId
    ? [...base.filter(p => p.id === pinnedId).map(p => ({ ...p, pinned: true, viewerOnly: false, size: 'l' })),
       ...base.filter(p => p.id !== pinnedId).map(p => (p.size === 'l' ? { ...p, size: 'm' } : p))]
    : base;

  return (
    <div className={`grid h-full overflow-hidden ${tweaks.showChat ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : ''} grid-cols-1`}>
      <div className="flex flex-col min-w-0 min-h-0 bg-bg relative">
        <div className="flex items-center gap-3 px-[18px] max-sm:px-3 py-3 border-b border-border-subtle">
          <div className="flex-1 min-w-0 flex items-center gap-2 text-[11.5px] text-muted whitespace-nowrap">
            <button onClick={onLeave} className="cursor-pointer hover:text-fg">home</button>
            <span className="text-subtle">/</span>
            <span className="text-fg font-semibold truncate">{room.name}</span>
          </div>
          <div className="flex gap-1.5 items-center flex-shrink-0">
            <Chip className="!bg-surface max-sm:!hidden"><Icon.Users size={11}/> {room.participants.length}</Chip>
            <Chip kind="live" dot>LIVE · 1h 42m</Chip>
            <button
              title="Show participants without video" className={`inline-flex items-center gap-2 h-7 px-2.5 rounded-lg border text-[11px] whitespace-nowrap cursor-pointer ${showViewers ? 'bg-primary-soft border-[color-mix(in_oklch,var(--color-primary)_45%,transparent)] text-primary' : 'bg-surface border-border text-fg-muted'}`}
              onClick={() => setShowViewers(v => !v)}>
              <span className={`w-3 h-3 rounded-[3px] border grid place-items-center ${showViewers ? 'bg-primary border-transparent text-primary-ink' : 'border-border-strong'}`}>
                {showViewers && <Icon.Check size={10}/>}
              </span>
              <span className="max-sm:sr-only">viewers</span>
            </button>
          </div>
        </div>

        <div className={`flex-1 min-h-0 overflow-auto grid grid-cols-12 max-md:grid-cols-2 max-md:auto-rows-[minmax(88px,auto)] content-start ${DENSITY_CLS[tweaks.density] || DENSITY_CLS.comfortable}`}>
          {participants.map(p => <Tile key={p.id} p={p} layout={tweaks.layout} onPin={togglePin}/>)}
        </div>

        <div className="relative flex items-center justify-center gap-2.5 px-[18px] py-3.5 max-sm:px-2 max-sm:py-2.5 bg-canvas border-t border-border-subtle">
          <div className="absolute left-[18px] flex gap-2 max-lg:hidden">
            <Btn variant="ghost" size="sm" title="Room info"><Icon.Hash size={12}/> room info</Btn>
          </div>

          <div className="flex gap-2 max-sm:gap-1.5 p-1.5 bg-surface border border-border rounded-full shadow-card">
            <ControlBtn state={cam ? 'active' : 'muted'} onClick={() => setCam(c => !c)} title="Camera">
              {cam ? <Icon.Cam size={16}/> : <Icon.CamOff size={16}/>}
            </ControlBtn>
            <ControlBtn state={mic ? 'active' : 'muted'} onClick={() => setMic(m => !m)} title="Mic">
              {mic ? <Icon.Mic size={16}/> : <Icon.MicOff size={16}/>}
            </ControlBtn>
            <ControlBtn state={share ? 'active' : ''} onClick={() => setShare(s => !s)} title="Screen share">
              <Icon.Screen size={16}/>
            </ControlBtn>
            <ControlBtn title="Reactions" className="max-[380px]:hidden"><Icon.Smile size={16}/></ControlBtn>
            {tweaks.showChat && (
              <ControlBtn state={sideOpen ? 'active' : ''} onClick={() => setSideOpen(o => !o)} title="Chat & people" className="lg:hidden" aria-expanded={sideOpen}>
                <Icon.Chat size={16}/>
              </ControlBtn>
            )}
            <button onClick={onLeave} title="Leave" className="inline-flex items-center gap-2 h-10 px-4 max-sm:px-3 rounded-full bg-live text-white font-semibold text-xs cursor-pointer hover:brightness-110">
              <Icon.Leave size={14}/> <span className="max-sm:sr-only">leave</span>
            </button>
          </div>

          <div className="absolute right-[18px] flex gap-2 max-lg:hidden">
            <Btn variant="ghost" size="sm" className="!w-7 !px-0" title="Settings"><Icon.Gear size={14}/></Btn>
            <Btn variant="ghost" size="sm" className="!w-7 !px-0" title="Fullscreen"><Icon.Maximize size={14}/></Btn>
          </div>
        </div>
      </div>

      {tweaks.showChat && sideOpen && <div className="lg:hidden fixed inset-0 z-[110] bg-black/45 animate-bc-fade" onClick={() => setSideOpen(false)}/>}
      {tweaks.showChat && <RoomSide room={room} chat={chat} onSend={send} onOpenProfile={onOpenProfile} open={sideOpen} onClose={() => setSideOpen(false)}/>}
    </div>
  );
};

Object.assign(window, { RoomPage });
