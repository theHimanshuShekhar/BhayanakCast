// Create-room modal + profile menu + tweaks panel — Tailwind v4 utilities

const fieldInput = "bg-canvas border border-border rounded-[var(--radius-sm)] px-3 py-2.5 outline-0 text-fg text-[12.5px] focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-soft)] transition-shadow";
const fieldLabel = "text-[11px] text-muted tracking-[0.06em] uppercase";

const tagBtn = (active) => `h-[26px] px-2.5 rounded-full text-[11px] border cursor-pointer select-none transition-colors ${
  active
    ? 'bg-primary text-primary-ink border-transparent font-semibold'
    : 'bg-canvas border-border text-fg-muted hover:text-fg hover:border-border-strong'
}`;

const Switch = ({ on }) => (
  <span className={`relative w-[34px] h-5 rounded-full border transition-colors duration-150 cursor-pointer ${on ? 'bg-primary border-transparent' : 'bg-surface-2 border-border'}`}>
    <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-[left,background-color] duration-150 ${on ? 'left-4 bg-primary-ink' : 'left-0.5 bg-fg-muted'}`}/>
  </span>
);

const Toggle = ({ k, d, on, onClick, surface = false }) => (
  <button
    onClick={onClick}
    className={`flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-[var(--radius-sm)] w-full text-left ${surface ? 'bg-canvas' : 'bg-surface-2 border border-border'}`}>
    <div>
      <div className="text-[12px] font-medium">{k}</div>
      <div className="text-[11px] text-muted">{d}</div>
    </div>
    <Switch on={on}/>
  </button>
);

const CreateRoomModal = ({ onClose, onCreate }) => {
  const [name, setName] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [tags, setTags] = React.useState(new Set(['chill']));
  const [kind, setKind] = React.useState('gaming');
  const [privateRoom, setPrivateRoom] = React.useState(false);
  const [startMuted, setStartMuted] = React.useState(true);

  const toggleTag = (t) => {
    const n = new Set(tags);
    n.has(t) ? n.delete(t) : n.add(t);
    setTags(n);
  };

  const submit = () => {
    if (!name.trim()) return;
    onCreate({
      id: 'r' + Date.now(),
      name: name.trim(),
      slug: name.trim().toLowerCase().replace(/\s+/g, '-'),
      streamer: 'you',
      viewers: 1,
      tags: Array.from(tags),
      kind,
      started: 'just now',
    });
  };

  const allTags = ['chill', 'gaming', 'coding', 'music', 'art', 'cozy', 'speedrun', 'watch-party', 'learning'];
  const kinds = [
    { id: 'gaming', label: 'Gaming' },
    { id: 'code', label: 'Coding' },
    { id: 'music', label: 'Music' },
    { id: 'art', label: 'Art' },
    { id: 'watch', label: 'Watch party' },
    { id: 'chat', label: 'Just chatting' },
  ];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[200] grid place-items-center p-4 max-sm:p-0 max-sm:place-items-end bg-black/55 backdrop-blur-[3px] animate-bc-fade">
      <div
        onClick={e => e.stopPropagation()}
        className="w-[min(520px,94vw)] max-h-full flex flex-col bg-surface border border-border rounded-[var(--radius)] shadow-deep overflow-hidden max-sm:w-full max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:border-b-0">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border-subtle">
          <h3 className="m-0 text-[15px] tracking-[-0.005em] font-bold flex-1">start a hang</h3>
          <IconBtn onClick={onClose}><Icon.Close size={14}/></IconBtn>
        </div>
        <div className="px-5 py-4 flex flex-col gap-4 min-h-0 overflow-auto">
          <div className="flex flex-col gap-1.5">
            <label className={fieldLabel}>room name</label>
            <input
              type="text"
              placeholder="e.g. sunday synth jams"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              className={fieldInput}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={fieldLabel}>what kind of room</label>
            <div className="flex flex-wrap gap-1.5">
              {kinds.map(k => (
                <button key={k.id} type="button" aria-pressed={kind === k.id} className={tagBtn(kind === k.id)} onClick={() => setKind(k.id)}>
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={fieldLabel}>tags · pick a few</label>
            <div className="flex flex-wrap gap-1.5">
              {allTags.map(t => (
                <button key={t} type="button" aria-pressed={tags.has(t)} className={tagBtn(tags.has(t))} onClick={() => toggleTag(t)}>
                  #{t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={fieldLabel}>description (optional)</label>
            <textarea
              rows={2}
              placeholder="what's going down in this room…"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              className={fieldInput + ' resize-none font-[inherit]'}
            />
          </div>

          <Toggle
            k="private room"
            d="only people with the invite link can join"
            on={privateRoom}
            onClick={() => setPrivateRoom(p => !p)}
          />

          <Toggle
            k="start muted"
            d="join without broadcasting mic or cam"
            on={startMuted}
            onClick={() => setStartMuted(s => !s)}
          />
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-border-subtle bg-canvas">
          <Btn onClick={onClose}>cancel</Btn>
          <Btn variant="primary" onClick={submit} disabled={!name.trim()}>
            <Icon.Broadcast size={13}/> start hang
          </Btn>
        </div>
      </div>
    </div>
  );
};

const ProfileMenu = ({ onClose, onOpenProfile, onSettings, onSignOut }) => {
  React.useEffect(() => {
    const onDown = (e) => {
      if (!e.target.closest('[data-menu]') && !e.target.closest('[data-profile-trigger]')) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const item = "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12px] text-fg-muted hover:bg-surface-2 hover:text-fg transition-colors";

  return (
    <div data-menu className="absolute left-[72px] bottom-3 w-[260px] max-sm:left-2 max-sm:right-2 max-sm:w-auto max-sm:bottom-[64px] bg-surface border border-border-strong rounded-[var(--radius)] shadow-deep overflow-hidden z-[150]">
      <div className="flex items-center gap-2.5 px-3 py-3 border-b border-border-subtle bg-canvas">
        <Avatar name="you" size="lg" ring/>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[13px]">nelly.jpg</div>
          <div className="text-[11px] text-muted">· connected via oauth</div>
        </div>
      </div>
      <ul className="list-none m-0 p-1.5">
        <li><button className={item} onClick={onOpenProfile}><Icon.Users size={14}/> my profile</button></li>
        <li><button className={item} onClick={onSettings}><Icon.Gear size={14}/> settings</button></li>
        <li className="h-px bg-border-subtle my-1.5 mx-1"/>
        <li><button className={item + ' !text-live-ink'} onClick={onSignOut}><Icon.Logout size={14}/> sign out</button></li>
      </ul>
    </div>
  );
};

const Seg = ({ value, options, onChange }) => (
  <div className="flex gap-0.5 p-[3px] bg-canvas border border-border rounded-lg">
    {options.map(o => {
      const v = typeof o === 'object' ? o.v : o;
      const k = typeof o === 'object' ? o.k : o;
      const active = value === v;
      return (
        <button
          key={k}
          onClick={() => onChange(v)}
          className={`flex-1 h-[26px] text-[11px] rounded-md transition-colors ${active ? 'bg-surface-2 text-fg shadow-card' : 'text-muted hover:text-fg'}`}>
          {k}
        </button>
      );
    })}
  </div>
);

const TweaksPanel = ({ tweaks, setTweaks, onClose, isEmpty, onToggleEmpty }) => {
  const hues = [
    { h: 85,  name: 'amber' },
    { h: 145, name: 'lime' },
    { h: 190, name: 'cyan' },
    { h: 250, name: 'violet' },
    { h: 310, name: 'magenta' },
    { h: 30,  name: 'coral' },
  ];
  const tweakRowLabel = "text-[10.5px] tracking-[0.08em] uppercase text-subtle";

  return (
    <div className="fixed right-4 bottom-4 z-[100] w-[280px] max-sm:left-2 max-sm:right-2 max-sm:w-auto max-sm:bottom-[64px] max-h-[calc(100dvh-80px)] overflow-auto bg-surface border border-border-strong rounded-[var(--radius)] shadow-deep overflow-hidden font-mono">
      <div className="flex items-center px-3 py-2.5 border-b border-border-subtle bg-canvas">
        <h4 className="m-0 text-[11px] tracking-[0.14em] uppercase flex-1 text-fg-muted">tweaks</h4>
        <IconBtn onClick={onClose}><Icon.Close size={12}/></IconBtn>
      </div>
      <div className="p-3 flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <label className={tweakRowLabel}>accent hue</label>
          <div className="flex gap-1.5">
            {hues.map(h => (
              <button
                key={h.h}
                onClick={() => setTweaks({ ...tweaks, accentHue: h.h })}
                title={h.name}
                className={`w-6 h-6 rounded-lg border border-border-strong cursor-pointer transition-transform hover:scale-[1.08] ${tweaks.accentHue === h.h ? 'outline outline-2 outline-fg outline-offset-2' : ''}`}
                style={{ background: `oklch(0.82 0.17 ${h.h})`, boxShadow: `0 0 12px oklch(0.82 0.17 ${h.h} / 0.6)` }}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={tweakRowLabel}>corner radius</label>
          <Seg
            value={tweaks.radius}
            options={[{k:'sharp',v:4},{k:'soft',v:16},{k:'round',v:24}]}
            onChange={v => setTweaks({ ...tweaks, radius: v })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={tweakRowLabel}>tile density</label>
          <Seg
            value={tweaks.density}
            options={['compact', 'comfortable', 'spacious']}
            onChange={v => setTweaks({ ...tweaks, density: v })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={tweakRowLabel}>mosaic layout</label>
          <Seg
            value={tweaks.layout}
            options={['mosaic', 'grid', 'spotlight']}
            onChange={v => setTweaks({ ...tweaks, layout: v })}
          />
        </div>

        <Toggle
          k="sidebar chat"
          d="show/hide chat panel"
          on={tweaks.showChat}
          onClick={() => setTweaks({ ...tweaks, showChat: !tweaks.showChat })}
          surface
        />
        <Toggle k="empty state" d="preview home with no live rooms" on={isEmpty} onClick={onToggleEmpty} surface/>
      </div>
    </div>
  );
};

const ACCENTS = [
  { h: 265, name: 'violet' }, { h: 190, name: 'cyan' }, { h: 145, name: 'lime' },
  { h: 85, name: 'amber' }, { h: 30, name: 'coral' }, { h: 310, name: 'magenta' },
];

const SettingsModal = ({ tweaks, setTweaks, onClose }) => {
  const me = USER_PROFILES.you;
  const [name, setName] = React.useState('nelly.jpg');
  const set = (k, v) => setTweaks({ ...tweaks, [k]: v });
  const row = 'flex flex-col gap-1.5';
  return (
    <div onClick={onClose} className="fixed inset-0 z-[200] grid place-items-center p-4 max-sm:p-0 max-sm:place-items-end bg-black/55 backdrop-blur-[3px] animate-bc-fade">
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Settings"
        className="w-[min(480px,94vw)] max-h-full flex flex-col bg-surface border border-border rounded-[var(--radius)] shadow-deep overflow-hidden max-sm:w-full max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:border-b-0">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border-subtle">
          <h3 className="m-0 text-[15px] tracking-[-0.005em] font-bold flex-1">settings</h3>
          <IconBtn onClick={onClose} aria-label="Close"><Icon.Close size={14}/></IconBtn>
        </div>
        <div className="px-5 py-4 flex flex-col gap-5 min-h-0 overflow-auto">
          <MonoCaps>profile</MonoCaps>
          <div className="flex items-center gap-3 -mt-2">
            <Avatar name="you" size="lg" ring/>
            <div className="flex-1 min-w-0 text-[11px] text-muted">discord <span className="text-fg-muted font-medium">{me.discord}</span> · joined {me.joined}</div>
          </div>
          <div className={row}>
            <label className={fieldLabel}>display name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} className={fieldInput}/>
          </div>
          <MonoCaps>appearance</MonoCaps>
          <div className={row + ' -mt-2'}>
            <label className={fieldLabel}>theme</label>
            <Seg value={tweaks.theme} options={['light', 'dark']} onChange={v => set('theme', v)}/>
          </div>
          <div className={row}>
            <label className={fieldLabel}>accent</label>
            <div className="flex gap-2">
              {ACCENTS.map(a => (
                <button key={a.h} title={a.name} aria-label={a.name} aria-pressed={tweaks.accentHue === a.h} onClick={() => set('accentHue', a.h)}
                  className={`w-7 h-7 rounded-lg border border-border-strong cursor-pointer transition-transform hover:scale-[1.08] ${tweaks.accentHue === a.h ? 'outline-2 outline-fg outline-offset-2' : ''}`}
                  style={{ background: `oklch(0.68 0.19 ${a.h})` }}/>
              ))}
            </div>
          </div>
          <MonoCaps>rooms</MonoCaps>
          <div className={row + ' -mt-2'}>
            <label className={fieldLabel}>tile density</label>
            <Seg value={tweaks.density} options={['compact', 'comfortable', 'spacious']} onChange={v => set('density', v)}/>
          </div>
          <Toggle k="chat panel" d="show chat, people and feed beside the stage" on={tweaks.showChat} onClick={() => set('showChat', !tweaks.showChat)}/>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-border-subtle bg-canvas">
          <Btn variant="primary" onClick={onClose}>done</Btn>
        </div>
      </div>
    </div>
  );
};

const SignedOutScreen = ({ onSignIn }) => (
  <div className="fixed inset-0 z-[300] grid place-items-center p-6 bg-bg">
    <div className="relative overflow-hidden text-center max-w-[400px] w-full px-6 sm:px-8 py-10 bg-canvas border border-border rounded-[var(--radius-lg)] shadow-pop">
      <div className="absolute -inset-px pointer-events-none bg-[radial-gradient(200px_120px_at_50%_0%,var(--color-primary-soft),transparent_60%)]"/>
      <div className="relative w-14 h-14 mx-auto mb-4 rounded-2xl grid place-items-center bg-surface-2 border border-border font-extrabold text-sm tracking-[0.08em] text-primary">BC</div>
      <h2 className="relative m-0 mb-2 text-lg tracking-[-0.01em]">you're signed out</h2>
      <p className="relative m-0 mb-6 text-muted text-[12.5px]">sign back in to join rooms and pick up where your crew left off.</p>
      <Btn variant="primary" className="relative w-full" onClick={onSignIn}>sign in with discord</Btn>
    </div>
  </div>
);

Object.assign(window, { CreateRoomModal, ProfileMenu, TweaksPanel, SettingsModal, SignedOutScreen });
