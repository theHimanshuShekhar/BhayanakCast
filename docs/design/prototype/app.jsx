// App shell

const DEFAULT_TWEAKS = /*EDITMODE-BEGIN*/{
  "accentHue": 265,
  "radius": 12,
  "density": "comfortable",
  "layout": "mosaic",
  "showChat": true,
  "theme": "dark"
}/*EDITMODE-END*/;

const CURRENT_USER = 'you';
const ACCENT_CYCLE = [
  { h: 265, name: 'violet' }, { h: 190, name: 'cyan' }, { h: 145, name: 'lime' },
  { h: 85, name: 'amber' }, { h: 30, name: 'coral' }, { h: 310, name: 'magenta' },
];

function App() {
  const [tweaks, setTweaks] = React.useState(() => {
    try {
      const saved = localStorage.getItem('bc_tweaks');
      if (saved) return { ...DEFAULT_TWEAKS, ...JSON.parse(saved) };
    } catch (e) {}
    return DEFAULT_TWEAKS;
  });
  const [view, setView] = React.useState(() => localStorage.getItem('bc_view') || 'home');
  const [profileUser, setProfileUser] = React.useState(null);
  const [favorites, setFavorites] = React.useState(() => {
    try {
      const saved = localStorage.getItem('bc_favorites');
      if (saved) return new Set(JSON.parse(saved));
    } catch (e) {}
    return new Set(['kodama_jpg', 'bitreverb']);
  });
  const [activeRoom, setActiveRoom] = React.useState(() => buildRoomDetail(ROOM_SEED.find(r => r.id === localStorage.getItem('bc_room')) || ROOM_SEED[0]));
  const [showSettings, setShowSettings] = React.useState(false);
  const [signedOut, setSignedOut] = React.useState(false);
  const [rooms, setRooms] = React.useState(ROOM_SEED);
  const [isEmpty, setIsEmpty] = React.useState(false);
  const [showCreate, setShowCreate] = React.useState(false);
  const [showProfile, setShowProfile] = React.useState(false);
  const [tweaksOpen, setTweaksOpen] = React.useState(false);

  // Apply tweaks to CSS vars
  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent-h', tweaks.accentHue);
    root.style.setProperty('--radius', tweaks.radius + 'px');
    root.style.setProperty('--radius-sm', Math.max(4, tweaks.radius - 6) + 'px');
    root.style.setProperty('--radius-lg', (tweaks.radius + 6) + 'px');
    if (tweaks.theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try { localStorage.setItem('bc_tweaks', JSON.stringify(tweaks)); } catch (e) {}
    // Persist to parent if tweak-host available
    try {
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: tweaks }, '*');
    } catch (e) {}
  }, [tweaks]);

  React.useEffect(() => {
    try { localStorage.setItem('bc_view', view); } catch (e) {}
  }, [view]);

  // Tweak host wiring
  React.useEffect(() => {
    const handler = (e) => {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === '__activate_edit_mode') setTweaksOpen(true);
      if (e.data.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', handler);
    try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch (e) {}
    return () => window.removeEventListener('message', handler);
  }, []);

  // Keyboard: esc closes overlays
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setShowCreate(false);
        setShowProfile(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const enterRoom = (r) => {
    setActiveRoom(buildRoomDetail(r));
    setView('room');
    try { localStorage.setItem('bc_room', r.id); } catch (e) {}
  };

  const [pastRoom, setPastRoom] = React.useState(() => PAST_ROOMS.find(p => p.id === localStorage.getItem('bc_past')) || null);
  const openPast = (r) => { setPastRoom(r); setView('past'); try { localStorage.setItem('bc_past', r.id); } catch (e) {} };
  React.useEffect(() => { if (view === 'past' && !pastRoom) setView('home'); }, [view, pastRoom]);

  const openProfile = (username) => {
    setProfileUser(username || CURRENT_USER);
    setView('profile');
  };

  const toggleFavorite = (username) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username); else next.add(username);
      try { localStorage.setItem('bc_favorites', JSON.stringify(Array.from(next))); } catch (e) {}
      return next;
    });
  };

  const createRoom = (r) => {
    const room = { capacity: 12, members: ['you'], streams: [{ user: 'you', screen: 'browser' }], ...r };
    setRooms([room, ...rooms]);
    setIsEmpty(false);
    setShowCreate(false);
    enterRoom(room);
  };

  const toggleTheme = () => {
    setTweaks(t => ({ ...t, theme: t.theme === 'dark' ? 'light' : 'dark' }));
  };

  return (
    <div className="grid grid-rows-1 h-full h-[100dvh] bg-bg text-fg">
        <div className="grid grid-cols-[64px_minmax(0,1fr)] max-sm:grid-cols-1 max-sm:grid-rows-[minmax(0,1fr)_auto] min-h-0 overflow-hidden">
        <SideNav
          view={view}
          onNav={setView}
          rooms={isEmpty ? [] : rooms}
          onCreate={() => setShowCreate(true)}
          onProfile={() => setShowProfile(s => !s)}
          theme={tweaks.theme}
          onThemeToggle={toggleTheme}
          accentName={(ACCENT_CYCLE.find(a => a.h === tweaks.accentHue) || { name: 'custom' }).name}
          onAccentCycle={() => setTweaks(t => {
            const i = ACCENT_CYCLE.findIndex(a => a.h === t.accentHue);
            return { ...t, accentHue: ACCENT_CYCLE[(i + 1) % ACCENT_CYCLE.length].h };
          })}
        />

        <main className="overflow-hidden min-h-0 relative">
          {view === 'home' && (
            <HomePage
              rooms={isEmpty ? [] : rooms}
              pastRooms={isEmpty ? [] : PAST_ROOMS}
              isEmpty={isEmpty}
              onEnter={enterRoom}
              onCreate={() => setShowCreate(true)}
              onOpenProfile={openProfile}
              onOpenPast={openPast}
            />
          )}
          {view === 'past' && pastRoom && (
            <PastStreamPage room={pastRoom} onBack={() => setView('home')} onOpenProfile={openProfile}/>
          )}
          {view === 'room' && (
            <RoomPage
              room={activeRoom}
              onOpenProfile={openProfile}
              onLeave={() => setView('home')}
              tweaks={tweaks}
            />
          )}
          {view === 'profile' && (
            <ProfilePage
              username={profileUser || CURRENT_USER}
              isSelf={(profileUser || CURRENT_USER) === CURRENT_USER}
              isFavorite={favorites.has(profileUser || CURRENT_USER)}
              onToggleFavorite={toggleFavorite}
              onOpenProfile={openProfile}
              onOpenPast={openPast}
              onEditProfile={() => setShowSettings(true)}
              onBack={() => setView('home')}
            />
          )}
          {view === 'admin' && (
            CURRENT_USER_ADMIN ? (
              <AdminPage
                liveRooms={isEmpty ? [] : rooms}
                onEnter={enterRoom}
                onOpenProfile={openProfile}
              />
            ) : (
              (() => { setTimeout(() => setView('home'), 0); return null; })()
            )
          )}
        </main>
      </div>

      {showCreate && (
        <CreateRoomModal
          onClose={() => setShowCreate(false)}
          onCreate={createRoom}
        />
      )}

      {showProfile && (
        <ProfileMenu
          onClose={() => setShowProfile(false)}
          onOpenProfile={() => { setShowProfile(false); openProfile(CURRENT_USER); }}
          onSettings={() => { setShowProfile(false); setShowSettings(true); }}
          onSignOut={() => { setShowProfile(false); setSignedOut(true); }}
        />
      )}

      {tweaksOpen && (
        <TweaksPanel tweaks={tweaks} setTweaks={setTweaks} onClose={() => setTweaksOpen(false)}
          isEmpty={isEmpty} onToggleEmpty={() => { setIsEmpty(e => !e); setView('home'); }}/>
      )}

      {showSettings && (
        <SettingsModal tweaks={tweaks} setTweaks={setTweaks} onClose={() => setShowSettings(false)}/>
      )}

      {signedOut && <SignedOutScreen onSignIn={() => { setSignedOut(false); setView('home'); }}/>}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App/>);
