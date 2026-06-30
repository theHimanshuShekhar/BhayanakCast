import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { MessageSquare, UsersRound, Zap } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { loadRoomSummary } from '#/lib/room-summary'
import type { RoomSummary } from '#/lib/room-summary'
import { RoomStreamPanel } from '#/components/room-stream-panel'
import type { LiveRoomMember, LiveRoomStream } from '#/components/room-stream-panel'

export const Route = createFileRoute('/rooms/$roomId')({
  loader: ({ params }) => loadRoomSummary({ data: { roomId: params.roomId } }),
  component: RoomPage,
})

type Tab = 'chat' | 'people' | 'feed'

type ChatMessage = {
  messageId: string
  user?: { id?: string; name?: string | null }
  body: string
  userId?: string
  createdAt: string
}

type RoomJoinAck = {
  ok: boolean
  code?: string
  message?: string
  data?: {
    room?: RoomSummary
    members?: RawMember[]
    streams?: RawStream[]
    recentMessages?: ChatMessage[]
  }
}

type RoomJoinState =
  | { status: 'auth-required' }
  | { status: 'not-found' }
  | { status: 'joining'; room: RoomSummary }
  | { status: 'password-required'; room: RoomSummary; message?: string }
  | { status: 'duplicate-client'; room: RoomSummary }
  | { status: 'room-full'; room: RoomSummary }
  | { status: 'room-banned'; room: RoomSummary }
  | { status: 'room-ended'; room: RoomSummary }
  | { status: 'connection-failed'; room: RoomSummary; message?: string }
  | {
      status: 'joined'
      room: RoomSummary
      socket: Socket
      members: LiveRoomMember[]
      streams: LiveRoomStream[]
      messages: ChatMessage[]
    }
  | { status: 'protocol-error'; room?: RoomSummary; message?: string }

type JoinIntent = 'join' | 'takeover'

const JOIN_CODE_TO_STATE: Record<
  string,
  Exclude<RoomJoinState['status'], 'auth-required' | 'not-found' | 'joining' | 'joined'>
> = {
  PASSWORD_REQUIRED: 'password-required',
  INVALID_PASSWORD: 'password-required',
  ROOM_FULL: 'room-full',
  ROOM_BANNED: 'room-banned',
  ROOM_ENDED: 'room-ended',
  DUPLICATE_CLIENT: 'duplicate-client',
  CONNECTION_FAILED: 'connection-failed',
  JOIN_FAILED: 'connection-failed',
}

function mapJoinFailure(room: RoomSummary, ack: RoomJoinAck): RoomJoinState {
  const status = JOIN_CODE_TO_STATE[ack.code ?? ''] ?? 'protocol-error'
  if (status === 'protocol-error') {
    return { status, room, message: ack.message ?? ack.code }
  }
  return { status, room, message: ack.message ?? ack.code }
}

function joinedState(room: RoomSummary, socket: Socket, ack: RoomJoinAck): RoomJoinState {
  if (!ack.data) return { status: 'protocol-error', room }
  return {
    status: 'joined',
    room: ack.data.room ?? room,
    socket,
    members: (ack.data.members ?? []).map(normalizeMember),
    streams: (ack.data.streams ?? []).map(normalizeStream),
    messages: (ack.data.recentMessages ?? []).map(normalizeMessage),
  }
}

function roomStatusCopy(code: string | undefined, fallback: string) {
  switch (code) {
    case 'INVALID_PASSWORD':
      return 'That password did not open the room.'
    case 'PASSWORD_REQUIRED':
      return 'Enter the shared room password to join.'
    case 'ROOM_FULL':
      return 'This room is already at its 10-member capacity.'
    case 'ROOM_BANNED':
      return 'The host has blocked this account from rejoining this room.'
    case 'ROOM_ENDED':
      return 'This room has ended.'
    case 'DUPLICATE_CLIENT':
      return 'This room is already active in another tab or device.'
    case 'CONNECTION_FAILED':
    case 'JOIN_FAILED':
      return "We couldn't reach the room server. Check your connection and try again."
    case 'CHAT_FAILED':
      return "We couldn't send that message. Try again."
    default:
      return fallback
  }
}

type FeedItem = { id: string; text: string }

type RawMember = Partial<LiveRoomMember> & {
  id?: string
  userId?: string
}

type RawStream = Partial<LiveRoomStream> & {
  id?: string
  userId?: string
}

function RoomPage() {
  const { roomId } = Route.useParams()
  const room = Route.useLoaderData()
  const navigate = useNavigate()
  const initialRoom = room.room
  const [password, setPassword] = useState<string | undefined>()
  const [joinIntent, setJoinIntent] = useState<JoinIntent>('join')
  const [joinState, setJoinState] = useState<RoomJoinState>(() => {
    if (!room.authenticated) return { status: 'auth-required' }
    if (!initialRoom) return { status: 'not-found' }
    return { status: 'joining', room: initialRoom }
  })
  const [feedItems, setFeedItems] = useState<FeedItem[]>([])
  const [chatBody, setChatBody] = useState('')
  const [status, setStatus] = useState('Requesting room admission')
  const mediaCleanupRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    setPassword(sessionStorage.getItem(`room-password:${roomId}`) ?? undefined)
  }, [roomId])

  useEffect(() => {
    if (!room.authenticated) {
      setJoinState({ status: 'auth-required' })
      return
    }
    if (!room.room) {
      setJoinState({ status: 'not-found' })
      return
    }

    const currentRoom = room.room
    const socket = io({ transports: ['websocket'] })
    setJoinState({ status: 'joining', room: currentRoom })
    setStatus(
      joinIntent === 'takeover'
        ? 'Taking over room session'
        : 'Requesting room admission',
    )

    const addFeed = (text: string) => {
      setFeedItems((items) => [
        { id: `${Date.now()}-${items.length}`, text },
        ...items,
      ].slice(0, 50))
    }

    socket.emit(
      'room:join',
      { roomId, password, takeover: joinIntent === 'takeover' },
      (ack: RoomJoinAck) => {
        if (!ack.ok) {
          setJoinState(mapJoinFailure(currentRoom, ack))
          setStatus(roomStatusCopy(ack.code, 'Room admission failed. Try again from Active Rooms.'))
          return
        }

        const nextState = joinedState(currentRoom, socket, ack)
        setJoinState(nextState)
        setStatus(nextState.status === 'joined' ? 'Ready' : roomStatusCopy(undefined, 'Room admission failed. Try again from Active Rooms.'))
      },
    )

    socket.on('member:joined', (event: { room?: RoomSummary; member: RawMember }) => {
      const member = normalizeMember(event.member)
      setJoinState((current) => {
        if (current.status !== 'joined') return current
        return {
          ...current,
          room: event.room ?? current.room,
          members: current.members.some((item) => memberId(item) === memberId(member))
            ? current.members
            : [...current.members, member],
        }
      })
      addFeed(`${displayName(member.user)} joined`)
    })

    socket.on('member:left', (event: { room?: RoomSummary; userId: string }) => {
      setJoinState((current) => {
        if (current.status !== 'joined') return current
        return {
          ...current,
          room: event.room ?? current.room,
          members: current.members.filter((member) => memberId(member) !== event.userId),
          streams: current.streams.filter((stream) => streamUserId(stream) !== event.userId),
        }
      })
      addFeed('A room member left')
    })

    socket.on('chat:message', (event: { message: ChatMessage }) => {
      setJoinState((current) =>
        current.status === 'joined'
          ? { ...current, messages: [...current.messages, normalizeMessage(event.message)] }
          : current,
      )
    })

    socket.on('stream:started', (event: { room?: RoomSummary; stream: RawStream }) => {
      const stream = normalizeStream(event.stream)
      setJoinState((current) => {
        if (current.status !== 'joined') return current
        return {
          ...current,
          room: event.room ?? current.room,
          streams: mergeStream(current.streams, stream),
          members: markStreaming(current.members, streamUserId(stream), true),
        }
      })
      addFeed(`${displayName(stream.user)} went live`)
    })

    socket.on('stream:stopped', (event: { room?: RoomSummary; streamSessionId: string; userId: string }) => {
      setJoinState((current) => {
        if (current.status !== 'joined') return current
        return {
          ...current,
          room: event.room ?? current.room,
          streams: current.streams.filter((stream) => streamId(stream) !== event.streamSessionId),
          members: markStreaming(current.members, event.userId, false),
        }
      })
      addFeed('A stream stopped')
    })

    return () => {
      socket.close()
    }
  }, [joinIntent, password, room.authenticated, room.room, roomId])

  if (joinState.status !== 'joined') {
    return (
      <AdmissionGate
        joinState={joinState}
        onBack={() => void navigate({ to: '/' })}
        onPasswordSubmit={(nextPassword) => {
          sessionStorage.setItem(`room-password:${roomId}`, nextPassword)
          setPassword(nextPassword)
        }}
        onTakeover={() => setJoinIntent('takeover')}
      />
    )
  }

  const joinedRoomState = joinState

  function sendChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = chatBody.trim()
    if (!body) return

    joinedRoomState.socket.emit('chat:send', { roomId, body }, (ack: { ok: boolean; code?: string }) => {
      if (!ack.ok) {
        setStatus(roomStatusCopy(ack.code, "We couldn't send that message. Try again."))
        return
      }
      setChatBody('')
    })
  }

  async function leaveCurrentRoom() {
    const socket = joinedRoomState.socket
    try {
      await mediaCleanupRef.current?.()
    } finally {
      socket.emit('room:leave', { roomId }, () => {
        socket.close()
        void navigate({ to: '/' })
      })
    }
  }

  return (
    <LiveRoomShell
      chatBody={chatBody}
      feedItems={feedItems}
      joinState={joinedRoomState}
      onChatBodyChange={setChatBody}
      onChatSubmit={sendChat}
      onLeave={leaveCurrentRoom}
      onMediaCleanupReady={(cleanup) => {
        mediaCleanupRef.current = cleanup
      }}
      roomId={roomId}
      status={status}
    />
  )
}

function LiveRoomShell({
  chatBody,
  feedItems,
  joinState,
  onChatBodyChange,
  onChatSubmit,
  onLeave,
  onMediaCleanupReady,
  roomId,
  status,
}: {
  chatBody: string
  feedItems: FeedItem[]
  joinState: Extract<RoomJoinState, { status: 'joined' }>
  onChatBodyChange: (value: string) => void
  onChatSubmit: (event: FormEvent<HTMLFormElement>) => void
  onLeave: () => void
  onMediaCleanupReady: (cleanup: () => Promise<void>) => void
  roomId: string
  status: string
}) {
  const summary = joinState.room
  const topbarMembers = joinState.members.length || summary.members
  const topbarStreams = joinState.streams.length || summary.streams

  return (
    <div className="room-mosaic-shell min-h-screen bg-[#080d18] text-slate-100">
      <header className="flex h-12 items-center justify-between border-b border-white/10 bg-[#0b1220]/95 px-4 text-sm shadow-[0_8px_30px_rgba(0,0,0,0.28)]">
        <div className="flex items-center gap-2 font-black text-white">
          <span className="text-violet-300">◈</span>
          <span>{summary.name}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span>{topbarMembers}/10 members</span>
          <span className="rounded-full bg-rose-400/15 px-2 py-1 text-rose-100">
            ● {topbarStreams} live
          </span>
          <Button className="h-8 rounded-lg bg-violet-500/25 px-3 text-xs text-violet-100 ring-1 ring-violet-300/20 hover:bg-violet-500/35">
            <MessageSquare className="mr-2 h-4 w-4" /> Chat
          </Button>
          <Button className="h-8 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-slate-200 hover:bg-white/10" onClick={onLeave}>
            Leave room
          </Button>
        </div>
      </header>

      <div className="grid h-[calc(100vh-3rem)] grid-cols-[minmax(0,1fr)_320px] overflow-hidden bg-[#080d18] max-lg:grid-cols-1">
        <main className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#080d18]">
          <RoomStreamPanel
            members={joinState.members}
            roomId={roomId}
            socket={joinState.socket}
            streams={joinState.streams}
            status={status}
            onMediaCleanupReady={onMediaCleanupReady}
          />
        </main>
        <RoomSide
          feedItems={feedItems}
          messages={joinState.messages}
          members={joinState.members}
          onChatBodyChange={onChatBodyChange}
          onChatSubmit={onChatSubmit}
          peopleFallbackCount={summary.members}
          value={chatBody}
        />
      </div>
    </div>
  )
}

function AdmissionGate({
  joinState,
  onBack,
  onPasswordSubmit,
  onTakeover,
}: {
  joinState: Exclude<RoomJoinState, { status: 'joined' }>
  onBack: () => void
  onPasswordSubmit: (password: string) => void
  onTakeover: () => void
}) {
  switch (joinState.status) {
    case 'auth-required':
      return <AuthRequiredState onBack={onBack} />
    case 'not-found':
      return <RoomNotFoundState onBack={onBack} />
    case 'joining':
      return (
        <RoomGateShell
          action={<Button onClick={onBack}>Back to Active Rooms</Button>}
          description="Requesting room admission from the room server."
          title="Joining room"
        />
      )
    case 'password-required':
      return (
        <PrivatePasswordGate
          message={joinState.message}
          onBack={onBack}
          onPasswordSubmit={onPasswordSubmit}
        />
      )
    case 'duplicate-client':
      return <DuplicateClientGate onBack={onBack} onTakeover={onTakeover} />
    case 'room-full':
      return <RoomFullGate onBack={onBack} />
    case 'room-banned':
      return <RoomBannedGate onBack={onBack} />
    case 'room-ended':
      return <RoomEndedGate onBack={onBack} room={joinState.room} />
    case 'connection-failed':
      return <ConnectionFailedGate onBack={onBack} message={joinState.message} />
    case 'protocol-error':
      return <ProtocolErrorGate onBack={onBack} message={joinState.message} />
  }
}

function RoomGateShell({
  action,
  description,
  title,
}: {
  action: React.ReactNode
  description: string
  title: string
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#080d18] px-5 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1220] p-6 text-center shadow-[0_8px_30px_rgba(0,0,0,0.28)]">
        <div className="text-xl font-black text-white">{title}</div>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          {description}
        </p>
        <div className="mt-5 flex justify-center gap-3">{action}</div>
      </section>
    </main>
  )
}

function PrivatePasswordGate({
  message,
  onBack,
  onPasswordSubmit,
}: {
  message?: string
  onBack: () => void
  onPasswordSubmit: (password: string) => void
}) {
  const [nextPassword, setNextPassword] = useState('')
  const error = message === 'INVALID_PASSWORD' ? 'That password did not open the room.' : ''

  return (
    <main className="grid min-h-screen place-items-center bg-[#080d18] px-5 text-slate-100">
      <form
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1220] p-6 text-center shadow-[0_8px_30px_rgba(0,0,0,0.28)]"
        onSubmit={(event) => {
          event.preventDefault()
          const trimmed = nextPassword.trim()
          if (trimmed) onPasswordSubmit(trimmed)
        }}
      >
        <div className="text-xl font-black text-white">Room password required</div>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          This private room is listed publicly, but admission needs the shared room password.
        </p>
        <Input
          className="mt-5 border-white/10 bg-[#101725] text-sm text-slate-100 placeholder:text-slate-300"
          onChange={(event) => setNextPassword(event.currentTarget.value)}
          placeholder="Enter room password"
          type="password"
          value={nextPassword}
        />
        {error ? <p className="mt-3 text-sm text-rose-200">{error}</p> : null}
        <div className="mt-5 flex justify-center gap-3">
          <Button type="submit">Join private room</Button>
          <Button onClick={onBack} type="button" variant="outline">
            Back to Active Rooms
          </Button>
        </div>
      </form>
    </main>
  )
}

function DuplicateClientGate({
  onBack,
  onTakeover,
}: {
  onBack: () => void
  onTakeover: () => void
}) {
  return (
    <RoomGateShell
      action={
        <>
          <Button onClick={onTakeover}>Take over this room session</Button>
          <Button onClick={onBack} variant="outline">
            Cancel
          </Button>
        </>
      }
      description="This account is already active in this room on another tab or device."
      title="Room already open"
    />
  )
}

function RoomFullGate({ onBack }: { onBack: () => void }) {
  return (
    <RoomGateShell
      action={<Button onClick={onBack}>Back to Active Rooms</Button>}
      description="This room is at its 10-member capacity."
      title="Room is full"
    />
  )
}

function RoomBannedGate({ onBack }: { onBack: () => void }) {
  return (
    <RoomGateShell
      action={<Button onClick={onBack}>Back to Active Rooms</Button>}
      description="The host has blocked this account from rejoining this room."
      title="You cannot join this room"
    />
  )
}

function RoomEndedGate({ onBack, room }: { onBack: () => void; room: RoomSummary }) {
  return (
    <RoomGateShell
      action={<Button onClick={onBack}>Back to Active Rooms</Button>}
      description={`${room.name} has ended. Past Streams are history records, not replayable recordings.`}
      title="Room has ended"
    />
  )
}

function ConnectionFailedGate({
  message,
  onBack,
}: {
  message?: string
  onBack: () => void
}) {
  return (
    <RoomGateShell
      action={<Button onClick={onBack}>Back to Active Rooms</Button>}
      description={message ?? "We couldn't reach the room server. Check your connection and try again from Active Rooms."}
      title="Room connection failed"
    />
  )
}

function ProtocolErrorGate({
  message,
  onBack,
}: {
  message?: string
  onBack: () => void
}) {
  return (
    <RoomGateShell
      action={<Button onClick={onBack}>Back to Active Rooms</Button>}
      description={message ?? 'The room server returned an unexpected response. We kept live controls hidden to protect the room state.'}
      title="Room state unavailable"
    />
  )
}

function RoomSide({
  feedItems,
  members,
  messages,
  onChatBodyChange,
  onChatSubmit,
  peopleFallbackCount,
  value,
}: {
  feedItems: FeedItem[]
  members: LiveRoomMember[]
  messages: ChatMessage[]
  onChatBodyChange: (value: string) => void
  onChatSubmit: (event: FormEvent<HTMLFormElement>) => void
  peopleFallbackCount: number
  value: string
}) {
  const [tab, setTab] = useState<Tab>('chat')
  const people = useMemo(
    () => members.map((member) => displayName(member.user)),
    [members],
  )
  const count = members.length || peopleFallbackCount

  return (
    <aside className="border-l border-white/10 bg-[#0b1220]">
      <div className="grid grid-cols-3 border-b border-white/10 text-[0.65rem] font-black uppercase tracking-[0.18em] text-slate-500">
        <SideTab active={tab === 'chat'} icon={<MessageSquare className="h-3 w-3" />} onClick={() => setTab('chat')}>
          chat
        </SideTab>
        <SideTab active={tab === 'people'} icon={<UsersRound className="h-3 w-3" />} onClick={() => setTab('people')}>
          people · {count}
        </SideTab>
        <SideTab active={tab === 'feed'} icon={<Zap className="h-3 w-3" />} onClick={() => setTab('feed')}>
          feed
        </SideTab>
      </div>

      {tab === 'people' ? (
        <div className="space-y-5 p-4">
          <div className="text-[0.65rem] font-black uppercase tracking-[0.18em] text-slate-500">
            room members · {count}
          </div>
          {(people.length ? people : ['Host']).map((person) => (
            <div className="flex items-center gap-3" key={person}>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-orange-300 to-rose-500 text-[0.65rem] font-black text-white">
                {person.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-black text-white">{person}</div>
                <div className="mt-1 flex gap-1">
                  <span className="rounded bg-cyan-400/20 px-1 text-[0.55rem] text-cyan-200">
                    ROOM MEMBER
                  </span>
                </div>
              </div>
              <span className="text-slate-500">⚙︎ ⌁</span>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'chat' ? (
        <form className="flex h-[calc(100vh-5.5rem)] flex-col p-4" onSubmit={onChatSubmit}>
          <div className="flex-1 space-y-3 overflow-y-auto text-xs text-slate-300">
            {messages.length ? messages.map((message) => (
              <div className="rounded-xl bg-white/5 p-3" key={message.messageId}>
                <div className="mb-1 font-black text-white">{displayName(message.user)}</div>
                <div>{message.body}</div>
              </div>
            )) : <div className="text-slate-500">Room chat appears here.</div>}
          </div>
          <Input
            className="border-white/10 bg-[#0b1220] text-xs"
            onChange={(event) => onChatBodyChange(event.currentTarget.value)}
            placeholder="say something..."
            value={value}
          />
        </form>
      ) : null}

      {tab === 'feed' ? (
        <div className="space-y-3 p-4 text-xs text-slate-400">
          {feedItems.length ? feedItems.map((item) => (
            <div className="rounded-xl border border-white/10 bg-white/5 p-3" key={item.id}>{item.text}</div>
          )) : <div>room activity appears here</div>}
        </div>
      ) : null}
    </aside>
  )
}

function SideTab({
  active,
  children,
  icon,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      className={`flex items-center justify-center gap-2 px-3 py-3 ${
        active ? 'bg-violet-500/15 text-violet-100' : 'text-slate-500'
      }`}
      onClick={onClick}
      type="button"
    >
      {icon}
      {children}
    </button>
  )
}


function AuthRequiredState({ onBack }: { onBack: () => void }) {
  return (
    <RoomGateShell
      action={
        <Button onClick={onBack}>
          Back to Active Rooms
        </Button>
      }
      description="Join the room after signing in with Discord."
      title="Sign in required"
    />
  )
}

function RoomNotFoundState({ onBack }: { onBack: () => void }) {
  return (
    <RoomGateShell
      action={<Button onClick={onBack}>Back to Active Rooms</Button>}
      description="This room does not exist or is not available to join."
      title="Room unavailable"
    />
  )
}


function displayName(user: { name?: string | null; id?: string } | undefined) {
  if (user?.name && user.name !== user.id) return user.name
  return user?.id ? `Member ${user.id.slice(0, 4)}` : 'Room member'
}

function memberId(member: LiveRoomMember) {
  return member.user.id
}

function streamUserId(stream: LiveRoomStream) {
  return stream.user.id
}

function streamId(stream: LiveRoomStream) {
  return stream.streamSessionId ?? stream.id
}

function normalizeMember(member: RawMember): LiveRoomMember {
  const id = member.user?.id ?? member.userId ?? member.id ?? 'unknown-member'
  return {
    ...member,
    user: { id, name: member.user?.name ?? id },
  }
}

function normalizeStream(stream: RawStream): LiveRoomStream {
  const id = stream.user?.id ?? stream.userId ?? 'unknown-streamer'
  return {
    ...stream,
    user: { id, name: stream.user?.name ?? id },
  }
}

function normalizeMessage(message: ChatMessage): ChatMessage {
  const id = message.user?.id ?? message.userId
  return {
    ...message,
    user: id ? { id, name: message.user?.name ?? id } : message.user,
  }
}

function mergeStream(streams: LiveRoomStream[], stream: LiveRoomStream) {
  const id = streamId(stream)
  return streams.some((item) => streamId(item) === id)
    ? streams.map((item) => (streamId(item) === id ? stream : item))
    : [...streams, stream]
}

function markStreaming(members: LiveRoomMember[], userId: string, isStreaming: boolean) {
  return members.map((member) =>
    memberId(member) === userId ? { ...member, isStreaming } : member,
  )
}
