import { useEffect, useMemo, useState } from 'react'
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
  const [password, setPassword] = useState<string | undefined>()
  const [roomSocket, setRoomSocket] = useState<Socket | null>(null)
  const [liveRoom, setLiveRoom] = useState<RoomSummary | null>(room.room)
  const [members, setMembers] = useState<LiveRoomMember[]>([])
  const [streams, setStreams] = useState<LiveRoomStream[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [feedItems, setFeedItems] = useState<FeedItem[]>([])
  const [chatBody, setChatBody] = useState('')
  const [status, setStatus] = useState('Connecting')

  useEffect(() => {
    setPassword(sessionStorage.getItem(`room-password:${roomId}`) ?? undefined)
  }, [roomId])

  useEffect(() => {
    if (!room.authenticated || !room.room) return

    const socket = io({ transports: ['websocket'] })
    setRoomSocket(socket)

    const addFeed = (text: string) => {
      setFeedItems((items) => [
        { id: `${Date.now()}-${items.length}`, text },
        ...items,
      ].slice(0, 50))
    }

    socket.emit('room:join', { roomId, password }, (ack: RoomJoinAck) => {
      if (!ack.ok || !ack.data) {
        setStatus(ack.code ?? 'JOIN_FAILED')
        return
      }

      setLiveRoom(ack.data.room ?? room.room)
      setMembers((ack.data.members ?? []).map(normalizeMember))
      setStreams((ack.data.streams ?? []).map(normalizeStream))
      setMessages((ack.data.recentMessages ?? []).map(normalizeMessage))
      setStatus('Ready')
    })

    socket.on('member:joined', (event: { room?: RoomSummary; member: RawMember }) => {
      const member = normalizeMember(event.member)
      setLiveRoom(event.room ?? null)
      setMembers((current) =>
        current.some((item) => memberId(item) === memberId(member))
          ? current
          : [...current, member],
      )
      addFeed(`${displayName(member.user)} joined`)
    })

    socket.on('member:left', (event: { room?: RoomSummary; userId: string }) => {
      setLiveRoom(event.room ?? null)
      setMembers((current) => current.filter((member) => memberId(member) !== event.userId))
      setStreams((current) => current.filter((stream) => streamUserId(stream) !== event.userId))
      addFeed('A room member left')
    })

    socket.on('chat:message', (event: { message: ChatMessage }) => {
      setMessages((current) => [...current, normalizeMessage(event.message)])
    })

    socket.on('stream:started', (event: { room?: RoomSummary; stream: RawStream }) => {
      const stream = normalizeStream(event.stream)
      setLiveRoom(event.room ?? null)
      setStreams((current) => mergeStream(current, stream))
      setMembers((current) => markStreaming(current, streamUserId(stream), true))
      addFeed(`${displayName(stream.user)} went live`)
    })

    socket.on('stream:stopped', (event: { room?: RoomSummary; streamSessionId: string; userId: string }) => {
      setLiveRoom(event.room ?? null)
      setStreams((current) => current.filter((stream) => streamId(stream) !== event.streamSessionId))
      setMembers((current) => markStreaming(current, event.userId, false))
      addFeed('A stream stopped')
    })

    return () => {
      socket.close()
      setRoomSocket(null)
    }
  }, [password, room.authenticated, room.room, roomId])

  if (!room.authenticated) return <AuthRequiredState />
  if (!room.room) return <RoomNotFoundState />

  const summary = liveRoom ?? room.room
  const topbarMembers = members.length || summary.members
  const topbarStreams = streams.length || summary.streams

  function sendChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = chatBody.trim()
    const socket = roomSocket
    if (!body || !socket) return

    socket.emit('chat:send', { roomId, body }, (ack: { ok: boolean; code?: string }) => {
      if (!ack.ok) {
        setStatus(ack.code ?? 'CHAT_FAILED')
        return
      }
      setChatBody('')
    })
  }

  function leaveCurrentRoom() {
    const socket = roomSocket
    if (!socket) {
      void navigate({ to: '/' })
      return
    }
    socket.emit('room:leave', { roomId }, () => {
      socket.close()
      void navigate({ to: '/' })
    })
  }

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
            <Button className="h-8 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-slate-200 hover:bg-white/10" onClick={leaveCurrentRoom}>
              Leave room
            </Button>
        </div>
      </header>

      <div className="grid h-[calc(100vh-3rem)] grid-cols-[minmax(0,1fr)_320px] overflow-hidden bg-[#080d18] max-lg:grid-cols-1">
        <main className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#080d18]">
          <RoomStreamPanel
            members={members}
            roomId={roomId}
            socket={roomSocket}
            streams={streams}
            status={status}
          />
        </main>
        <RoomSide
          feedItems={feedItems}
          messages={messages}
          members={members}
          onChatBodyChange={setChatBody}
          onChatSubmit={sendChat}
          peopleFallbackCount={summary.members}
          value={chatBody}
        />
      </div>
    </div>
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


function AuthRequiredState() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#080d18] text-slate-100">
      <div className="rounded-3xl border border-white/10 bg-[#0b1220] p-8 text-center shadow-2xl">
        <div className="text-2xl font-black">Sign in required</div>
        <p className="mt-3 text-sm text-slate-400">Join the room after signing in with Discord.</p>
      </div>
    </main>
  )
}

function RoomNotFoundState() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#080d18] text-slate-100">
      <div className="rounded-3xl border border-white/10 bg-[#0b1220] p-8 text-center shadow-2xl">
        <div className="text-2xl font-black">Room unavailable</div>
        <p className="mt-3 text-sm text-slate-400">This room does not exist or is no longer live.</p>
      </div>
    </main>
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
