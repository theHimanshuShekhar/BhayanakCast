// Room view — stage + mosaic + controls + sidebar

const Tile = ({ p, onPin, pinned, onReaction }) => {
  const [reactions, setReactions] = React.useState([])

  React.useEffect(() => {
    if (!p.streaming) return
    const iv = setInterval(() => {
      if (Math.random() > 0.75) {
        const emojis = ['🔥', '💯', '✨', '🎧', '⚡', '🫡']
        const id = Date.now() + Math.random()
        const dx = (Math.random() - 0.5) * 60
        const e = emojis[Math.floor(Math.random() * emojis.length)]
        setReactions((r) => [...r, { id, e, dx }])
        setTimeout(
          () => setReactions((r) => r.filter((x) => x.id !== id)),
          2400,
        )
      }
    }, 3200)
    return () => clearInterval(iv)
  }, [p.streaming])

  if (p.viewerOnly) {
    return (
      <div className={`tile viewer-only`}>
        <div className="viewer-tile">
          <Avatar name={p.name} size="md" ring={p.speaking} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="name">
              {p.name}
              {p.you && ' (you)'}
            </div>
            <div className="role">viewer</div>
          </div>
          <div style={{ color: 'var(--ink-2)' }}>
            {p.muted ? <Icon.MicOff size={14} /> : <Icon.Mic size={14} />}
          </div>
        </div>
      </div>
    )
  }

  const cls = `tile size-${p.size} ${p.streaming ? 'streaming' : ''} ${p.speaking ? 'speaking' : ''}`
  const screenKind = p.screen || 'ableton'

  return (
    <div className={cls}>
      {p.streaming ? (
        <ScreenPlaceholder kind={screenKind} />
      ) : (
        <div className="tile-preview placeholder">
          <div className="stripe-bg" />
          <div
            style={{
              position: 'relative',
              zIndex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Avatar name={p.name} size="lg" ring={p.speaking} />
            <div className="stripe-label">
              {p.camera ? 'CAM · NO SHARE' : 'AUDIO ONLY'}
            </div>
          </div>
        </div>
      )}

      <div className="tile-overlay" />

      <div className="tile-badges">
        {p.streaming && (
          <Chip kind="live" dot>
            LIVE
          </Chip>
        )}
        {p.role === 'streamer' && !p.streaming && <Chip dot>streamer</Chip>}
      </div>

      <div className="tile-badges-right">
        {p.streaming && (
          <span className="viewer-count">
            <Icon.Eye size={11} /> {Math.floor(60 + Math.random() * 800)}
          </span>
        )}
      </div>

      <div className="hover-actions">
        <button className="icon-btn" title="Pin" onClick={() => onPin(p.id)}>
          <Icon.Pin size={14} />
        </button>
        <button className="icon-btn" title="Mute">
          <Icon.Headset size={14} />
        </button>
        <button className="icon-btn" title="Fullscreen">
          <Icon.Maximize size={14} />
        </button>
        <button className="icon-btn" title="More">
          <Icon.More size={14} />
        </button>
      </div>

      {p.streaming && p.camera && (
        <div className="tile-cam">
          <div
            className="cam-bg"
            style={{
              background: `linear-gradient(135deg, ${avatarFor(p.name).c1}, ${avatarFor(p.name).c2})`,
            }}
          >
            <Avatar name={p.name} size="sm" />
          </div>
        </div>
      )}

      <div className="tile-meta">
        <span className="name-plate">
          <Avatar name={p.name} size="sm" />
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {p.name}
            {p.you && ' (you)'}
            {p.speaking ? (
              <Wave on />
            ) : p.muted ? (
              <Icon.MicOff size={12} />
            ) : null}
          </span>
        </span>
      </div>

      {reactions.map((r) => (
        <span key={r.id} className="reaction" style={{ '--dx': `${r.dx}px` }}>
          {r.e}
        </span>
      ))}
    </div>
  )
}

const ChatMessage = ({ m }) => {
  if (m.system) return <div className="chat-system">— {m.text} —</div>
  const roleCls =
    m.role === 'mod' ? 'role-mod' : m.role === 'streamer' ? 'role-streamer' : ''
  return (
    <div className="chat-msg">
      <Avatar name={m.user} size="sm" />
      <div className="bubble">
        <div className="top">
          <span className={`who ${roleCls}`}>{m.user}</span>
          {m.role === 'mod' && <span className="role-badge mod">mod</span>}
          {m.role === 'streamer' && (
            <span className="role-badge streamer">host</span>
          )}
          <span className="ts">{m.ts}</span>
        </div>
        <div
          className="txt"
          dangerouslySetInnerHTML={{
            __html: m.text.replace(
              /@(\w+)/g,
              '<span class="mention">@$1</span>',
            ),
          }}
        />
      </div>
    </div>
  )
}

const RoomSide = ({ room, chat, onSend }) => {
  const [tab, setTab] = React.useState('chat')
  const [draft, setDraft] = React.useState('')
  const bodyRef = React.useRef(null)

  React.useEffect(() => {
    if (bodyRef.current)
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [chat.length, tab])

  const submit = (e) => {
    e?.preventDefault()
    if (!draft.trim()) return
    onSend(draft.trim())
    setDraft('')
  }

  const grouped = {
    streamer: room.participants.filter((p) => p.role === 'streamer'),
    mod: room.participants.filter((p) => p.role === 'mod'),
    member: room.participants.filter((p) => p.role === 'member'),
  }

  return (
    <aside className="side">
      <div className="side-tabs">
        <button
          className={tab === 'chat' ? 'active' : ''}
          onClick={() => setTab('chat')}
        >
          <Icon.Chat size={13} /> chat
        </button>
        <button
          className={tab === 'people' ? 'active' : ''}
          onClick={() => setTab('people')}
        >
          <Icon.Users size={13} /> people · {room.participants.length}
        </button>
        <button
          className={tab === 'activity' ? 'active' : ''}
          onClick={() => setTab('activity')}
        >
          <Icon.Activity size={13} /> feed
        </button>
      </div>

      {tab === 'chat' && (
        <>
          <div className="side-body" ref={bodyRef}>
            {chat.map((m) => (
              <ChatMessage key={m.id} m={m} />
            ))}
          </div>
          <div className="side-foot">
            <form className="chat-input" onSubmit={submit}>
              <input
                placeholder="say something…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="button" className="icon-btn">
                <Icon.Gif size={14} />
              </button>
              <button type="button" className="icon-btn">
                <Icon.Smile size={14} />
              </button>
              <button
                type="submit"
                className="icon-btn"
                style={{ color: 'var(--accent)' }}
              >
                <Icon.Send size={14} />
              </button>
            </form>
          </div>
        </>
      )}

      {tab === 'people' && (
        <div className="side-body">
          {grouped.streamer.length > 0 && (
            <>
              <div className="group-head">
                streaming{' '}
                <span className="count">{grouped.streamer.length}</span>
              </div>
              {grouped.streamer.map((p) => (
                <ParticipantRow key={p.id} p={p} />
              ))}
            </>
          )}
          {grouped.mod.length > 0 && (
            <>
              <div className="group-head">
                mods <span className="count">{grouped.mod.length}</span>
              </div>
              {grouped.mod.map((p) => (
                <ParticipantRow key={p.id} p={p} />
              ))}
            </>
          )}
          {grouped.member.length > 0 && (
            <>
              <div className="group-head">
                viewers <span className="count">{grouped.member.length}</span>
              </div>
              {grouped.member.map((p) => (
                <ParticipantRow key={p.id} p={p} />
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'activity' && (
        <div className="side-body">
          {[...ACTIVITY, ...ACTIVITY].map((a, i) => (
            <div key={i} className="activity-item">
              <span className="dot" />
              <div className="txt">
                <span className="who">{a.who}</span> {a.what}
                <span className="when">{a.when}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}

const ParticipantRow = ({ p }) => (
  <div className="participant">
    <Avatar name={p.name} size="md" ring={p.speaking} />
    <div className="grow" style={{ minWidth: 0 }}>
      <div
        className="name"
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {p.name}
        {p.you && ' (you)'}
      </div>
      <div className="meta">
        {p.role === 'streamer' && (
          <span className="role-badge streamer">host</span>
        )}
        {p.role === 'mod' && <span className="role-badge mod">mod</span>}
        {p.streaming && (
          <Chip kind="live" dot>
            live
          </Chip>
        )}
      </div>
    </div>
    <div className="indicators">
      {p.muted ? <Icon.MicOff size={13} /> : <Icon.Mic size={13} />}
      {p.camera ? <Icon.Cam size={13} /> : <Icon.CamOff size={13} />}
    </div>
  </div>
)

const RoomPage = ({ room, onLeave, tweaks }) => {
  const [showViewers, setShowViewers] = React.useState(true)
  const [mic, setMic] = React.useState(false)
  const [cam, setCam] = React.useState(false)
  const [share, setShare] = React.useState(false)
  const [chat, setChat] = React.useState(CHAT_SEED)

  const send = (text) => {
    const now = new Date()
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    setChat((c) => [
      ...c,
      { id: 'c' + Date.now(), user: 'you', role: 'member', ts, text },
    ])
  }

  const participants = showViewers
    ? room.participants
    : room.participants.filter((p) => !p.viewerOnly)

  return (
    <div className="room-view">
      <div className="stage">
        <div className="stage-head">
          <div className="trail">
            <span onClick={onLeave} style={{ cursor: 'pointer' }}>
              home
            </span>
            <span className="sep">/</span>
            <span className="cur">{room.name}</span>
          </div>
          <div className="grow" />
          <div className="stage-toolbar">
            <span className="chip" style={{ background: 'var(--depth-2)' }}>
              <Icon.Users size={11} /> {room.participants.length}
            </span>
            <span className="chip live">
              <span className="dot" /> BROADCASTING · 1h 42m
            </span>
            <button
              className={`toolbar-toggle ${showViewers ? 'on' : ''}`}
              onClick={() => setShowViewers((v) => !v)}
            >
              <span className="box">
                {showViewers && <Icon.Check size={10} />}
              </span>
              show non-video participants
            </button>
          </div>
        </div>

        <div
          className="mosaic"
          data-density={tweaks.density}
          data-layout={tweaks.layout}
        >
          {participants.map((p) => (
            <Tile key={p.id} p={p} />
          ))}
        </div>

        <div className="controls">
          <div className="left">
            <button className="btn ghost sm" title="Room info">
              <Icon.Hash size={12} /> room info
            </button>
          </div>

          <div className="group">
            <button
              className={`control-btn ${cam ? 'active' : 'muted'}`}
              onClick={() => setCam((c) => !c)}
              title="Camera"
            >
              {cam ? <Icon.Cam size={16} /> : <Icon.CamOff size={16} />}
            </button>
            <button
              className={`control-btn ${mic ? 'active' : 'muted'}`}
              onClick={() => setMic((m) => !m)}
              title="Mic"
            >
              {mic ? <Icon.Mic size={16} /> : <Icon.MicOff size={16} />}
            </button>
            <button
              className={`control-btn ${share ? 'active' : ''}`}
              onClick={() => setShare((s) => !s)}
              title="Screen share"
            >
              <Icon.Screen size={16} />
            </button>
            <button className="control-btn" title="Reactions">
              <Icon.Smile size={16} />
            </button>
            <button
              className="control-btn leave"
              onClick={onLeave}
              title="Leave"
            >
              <Icon.Leave size={14} /> leave
            </button>
          </div>

          <div className="right">
            <button className="btn ghost icon sm" title="Settings">
              <Icon.Gear size={14} />
            </button>
            <button className="btn ghost icon sm" title="Fullscreen">
              <Icon.Maximize size={14} />
            </button>
          </div>
        </div>
      </div>

      {tweaks.showChat && <RoomSide room={room} chat={chat} onSend={send} />}
    </div>
  )
}

Object.assign(window, { RoomPage })
