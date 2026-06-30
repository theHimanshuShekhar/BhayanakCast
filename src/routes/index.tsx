import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Eye, Search, UsersRound, X } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { authClient } from '#/lib/auth-client'
import type { DiscoveryRoom } from '#/lib/discovery'
import {
  filterDiscoveryRooms,
  loadDiscoveryRooms,
  splitDiscoveryRooms,
} from '#/lib/discovery'
import { createRoomAction } from '#/lib/room-actions'

export const Route = createFileRoute('/')({
  loader: () => loadDiscoveryRooms(),
  component: Home,
})

function signInDiscord() {
  void authClient.signIn.social({ provider: 'discord', callbackURL: '/' })
}

async function signInDevUser() {
  const response = await fetch('/api/dev/session', { method: 'POST' })
  if (response.ok) window.location.reload()
}

function Home() {
  const discoveryRooms = Route.useLoaderData()
  const { liveRooms, pastRooms } = splitDiscoveryRooms(discoveryRooms)
  const navigate = useNavigate()
  const session = authClient.useSession()
  const [createStatus, setCreateStatus] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [privateRoom, setPrivateRoom] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [privateJoinRoom, setPrivateJoinRoom] = useState<DiscoveryRoom | null>(
    null,
  )
  const [privateJoinPassword, setPrivateJoinPassword] = useState('')
  const [privateJoinError, setPrivateJoinError] = useState('')

  useEffect(() => {
    function openCreateRoom() {
      setCreateOpen(true)
    }

    window.addEventListener('bhayanakcast:create-room', openCreateRoom)
    return () => {
      window.removeEventListener('bhayanakcast:create-room', openCreateRoom)
    }
  }, [])

  const filteredRooms = filterDiscoveryRooms(liveRooms, searchQuery)
  const filteredPastRooms = filterDiscoveryRooms(pastRooms, searchQuery)
  const totalMembers = liveRooms.reduce((sum, room) => sum + room.members, 0)
  const activeStreams = liveRooms.reduce((sum, room) => sum + room.streams, 0)
  const trendingRooms = [...liveRooms]
    .sort(
      (left, right) =>
        right.members + right.streams - (left.members + left.streams),
    )
    .slice(0, 3)

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const result = await createRoomAction({
      data: {
        name: String(form.get('name') ?? ''),
        category: String(form.get('category') ?? 'Just chatting'),
        tags: form.getAll('tags').map(String),
        visibility: privateRoom ? 'private' : 'public',
        password: privateRoom ? String(form.get('password') ?? '') : undefined,
      },
    })

    if (!result.ok) {
      setCreateStatus('sign in to create a room')
      return
    }

    await navigate({ to: '/rooms/$roomId', params: { roomId: result.roomId } })
  }

  function openPrivateJoin(room: DiscoveryRoom) {
    setPrivateJoinRoom(room)
    setPrivateJoinPassword('')
    setPrivateJoinError('')
  }

  async function joinPrivateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!privateJoinRoom) return
    const password = privateJoinPassword.trim()
    if (!password) {
      setPrivateJoinError('enter room password')
      return
    }
    sessionStorage.setItem(`room-password:${privateJoinRoom.id}`, password)
    await navigate({
      to: '/rooms/$roomId',
      params: { roomId: privateJoinRoom.id },
    })
  }

  return (
    <div className="min-h-screen bg-[#080d18] text-slate-100">
      <h1 className="sr-only">Watch together</h1>
      <div className="grid min-h-screen gap-5 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-5">
          <div className="border-b border-white/10 pb-5">
            <h2 className="text-2xl font-black tracking-tight text-white">
              Active Rooms
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Join live streams or browse past broadcasts
            </p>
            <div className="relative mt-4">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                className="h-11 rounded-xl border-white/10 bg-[#101725] pl-11 text-sm text-slate-100 placeholder:text-slate-500"
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
                placeholder="Search rooms..."
                value={searchQuery}
              />
            </div>
            <p className="mt-4 text-[0.7rem] text-slate-500">
              Showing {filteredRooms.length + filteredPastRooms.length} rooms
            </p>
          </div>

          <RoomSection count={filteredRooms.length} live title="Live Now">
            {filteredRooms.length ? (
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-5">
                {filteredRooms.map((room) => (
                  <RoomCard
                    key={room.id}
                    joinPrivate={() => openPrivateJoin(room)}
                    room={room}
                  />
                ))}
              </div>
            ) : null}
          </RoomSection>

          {filteredPastRooms.length ? (
            <RoomSection count={filteredPastRooms.length} title="Past Streams">
              <div className="grid gap-4 md:grid-cols-3 2xl:grid-cols-6">
                {filteredPastRooms.map((room) => (
                  <PastRoomCard key={room.id} room={room} />
                ))}
              </div>
            </RoomSection>
          ) : null}
        </section>

        <aside className="hidden space-y-5 xl:block">
          <Panel title="Global Stats">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Online" value={totalMembers} />
              <Stat label="Active Rooms" value={liveRooms.length} />
            </div>
          </Panel>
          <Panel title="Trending Now">
            <div className="space-y-3">
              {trendingRooms.map((room, index) => (
                <Link
                  className="flex items-center justify-between gap-3 text-xs"
                  key={room.id}
                  params={{ roomId: room.id }}
                  to="/rooms/$roomId"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-orange-300 to-rose-500 text-[0.62rem] font-black text-white">
                    {initials(room.host)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold text-slate-100">
                      {room.name}
                    </span>
                    <span className="block truncate text-[0.65rem] text-slate-500">
                      {room.host}
                    </span>
                  </span>
                  <span className="rounded-md bg-emerald-400/10 px-1.5 py-0.5 text-[0.65rem] text-emerald-300">
                    +{index + 2}
                  </span>
                </Link>
              ))}
            </div>
          </Panel>
          <Panel title="Community">
            <dl className="space-y-3 text-xs">
              <Metric label="Total Users" value={String(totalMembers)} />
              <Metric
                label="Active Streamers (30d)"
                value={String(activeStreams)}
              />
            </dl>
          </Panel>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <Panel title="Join BhayanakCast">
              <p className="mb-3 text-xs leading-relaxed text-slate-400">
                Create your own rooms, track your watch time, and connect with
                other viewers.
              </p>
              <DialogTrigger asChild>
                <Button
                  aria-label="Create room"
                  className="h-8 w-full rounded-lg bg-violet-500 text-xs font-bold text-white shadow-[0_0_18px_rgba(192,108,255,0.45)] hover:bg-violet-400"
                >
                  Get Started
                </Button>
              </DialogTrigger>
            </Panel>
            <CreateRoomDialog
              createRoom={createRoom}
              createStatus={createStatus}
              privateRoom={privateRoom}
              setPrivateRoom={setPrivateRoom}
            />
          </Dialog>
          {import.meta.env.DEV ? (
            <Button
              className="w-full bg-emerald-500 text-[#06140d] hover:bg-emerald-400"
              onClick={() => void signInDevUser()}
            >
              Continue as Dev User
            </Button>
          ) : null}
          {!session.data?.user ? (
            <Button
              className="w-full bg-indigo-500 text-white hover:bg-indigo-400"
              onClick={signInDiscord}
            >
              Continue with Discord
            </Button>
          ) : null}
        </aside>
      </div>

      <Dialog
        open={Boolean(privateJoinRoom)}
        onOpenChange={(open) => !open && setPrivateJoinRoom(null)}
      >
        <DialogContent className="border-white/10 bg-[#151d2e] text-slate-100">
          <DialogHeader>
            <DialogTitle>private room</DialogTitle>
            <DialogDescription>
              enter password for {privateJoinRoom?.name}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => void joinPrivateRoom(event)}
          >
            <Input
              className="border-white/10 bg-[#0b1220]"
              onChange={(event) =>
                setPrivateJoinPassword(event.currentTarget.value)
              }
              placeholder="room password"
              type="password"
              value={privateJoinPassword}
            />
            {privateJoinError ? (
              <p className="text-xs text-rose-300">{privateJoinError}</p>
            ) : null}
            <DialogFooter>
              <Button className="bg-violet-500 text-white" type="submit">
                Join
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function CreateRoomDialog({
  createRoom,
  createStatus,
  privateRoom,
  setPrivateRoom,
}: {
  createRoom: (event: FormEvent<HTMLFormElement>) => void | Promise<void>
  createStatus: string
  privateRoom: boolean
  setPrivateRoom: (value: boolean) => void
}) {
  const categories = [
    'Gaming',
    'Coding',
    'Music',
    'Art',
    'Watch party',
    'Just chatting',
  ]
  const tags = [
    '#chill',
    '#gaming',
    '#coding',
    '#music',
    '#art',
    '#cozy',
    '#speedrun',
    '#watch-party',
    '#learning',
  ]
  const [selectedCategory, setSelectedCategory] = useState('Just chatting')
  const [selectedTags, setSelectedTags] = useState<string[]>([])


  return (
    <DialogContent
      className="max-w-[650px] overflow-hidden rounded-3xl border-white/15 bg-[#151d2e] p-0 font-mono text-slate-100 shadow-2xl"
      showCloseButton={false}
    >
      <DialogHeader className="border-b border-white/10 px-7 py-5">
        <div className="flex items-center justify-between">
          <DialogTitle className="text-lg font-black lowercase">
            start a hang
          </DialogTitle>
          <DialogClose className="rounded-full p-1 text-slate-300 hover:bg-white/10">
            <X className="h-4 w-4" />
          </DialogClose>
        </div>
        <DialogDescription className="sr-only">
          Create a live room.
        </DialogDescription>
      </DialogHeader>
      <form
        className="space-y-4 px-7 py-5"
        onSubmit={(event) => void createRoom(event)}
      >
        <label className="block space-y-2">
          <span className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-slate-500">
            Room Name
          </span>
          <Input
            className="h-12 rounded-xl border-white/10 bg-[#0d1424] text-slate-100 placeholder:text-slate-500"
            name="name"
            placeholder="e.g. sunday synth jams"
            required
          />
        </label>
        <input name="category" type="hidden" value={selectedCategory} />
        <div className="space-y-2">
          <div className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-slate-500">
            What kind of room
          </div>
          <div className="flex flex-wrap gap-2 text-sm font-black text-slate-100">
            {categories.map((category) => (
              <button
                className={`rounded-full px-3 py-1.5 ${selectedCategory === category ? 'bg-violet-500 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
                key={category}
                onClick={() => setSelectedCategory(category)}
                type="button"
              >
                {category}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-slate-500">
            Tags · pick a few
          </div>
          <div className="flex flex-wrap gap-2 text-sm font-black text-slate-100">
            {tags.map((tag) => {
              const value = tag.slice(1)
              const checked = selectedTags.includes(value)

              return (
                <label
                  className={`cursor-pointer rounded-full px-3 py-1.5 ${checked ? 'bg-violet-500 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
                  key={tag}
                >
                  <input
                    checked={checked}
                    className="sr-only"
                    name="tags"
                    onChange={() =>
                      setSelectedTags((current) =>
                        checked
                          ? current.filter((selected) => selected !== value)
                          : [...current, value].slice(0, 5),
                      )
                    }
                    type="checkbox"
                    value={value}
                  />
                  {tag}
                </label>
              )
            })}
          </div>
        </div>
        <label className="block space-y-2">
          <span className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-slate-500">
            Description (optional)
          </span>
          <textarea
            className="min-h-16 w-full rounded-xl border border-white/10 bg-[#0d1424] px-4 py-3 text-sm outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-violet-400/40"
            placeholder="what's going down in this room..."
          />
        </label>
        <RoomToggle
          checked={privateRoom}
          label="private room"
          onChange={setPrivateRoom}
          sub="only people with the invite link can join"
        />
        {privateRoom ? (
          <Input
            className="border-white/10 bg-[#0d1424]"
            name="password"
            placeholder="password"
            type="password"
          />
        ) : null}
        <RoomToggle
          checked
          label="start muted"
          onChange={() => undefined}
          sub="join without broadcasting mic or cam"
        />
        {createStatus ? (
          <p className="text-xs text-rose-300">{createStatus}</p>
        ) : null}
        <DialogFooter className="-mx-7 -mb-5 mt-5 border-t border-white/10 bg-[#111827] px-7 py-4">
          <DialogClose asChild>
            <Button
              className="rounded-xl border-white/25 bg-transparent text-slate-100 hover:bg-white/10"
              variant="outline"
            >
              cancel
            </Button>
          </DialogClose>
          <Button
            className="rounded-xl bg-[#15142a] text-slate-400 ring-1 ring-white/10 hover:bg-violet-500 hover:text-white"
            type="submit"
          >
            start hang
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function RoomToggle({
  checked,
  label,
  onChange,
  sub,
}: {
  checked: boolean
  label: string
  onChange: (value: boolean) => void
  sub: string
}) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span>
        <span className="block text-sm font-black text-slate-100">{label}</span>
        <span className="text-xs text-slate-500">{sub}</span>
      </span>
      <button
        className={[
          'relative h-6 w-11 rounded-full border border-white/10 transition',
          checked ? 'bg-violet-500' : 'bg-slate-700',
        ].join(' ')}
        onClick={() => onChange(!checked)}
        type="button"
      >
        <span
          className={[
            'absolute top-0.5 h-5 w-5 rounded-full bg-white transition',
            checked ? 'left-5' : 'left-0.5',
          ].join(' ')}
        />
      </button>
    </label>
  )
}

function RoomSection({
  children,
  count,
  live = false,
  title,
}: {
  children: React.ReactNode
  count: number
  live?: boolean
  title: string
}) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-lg font-black text-white">
        <span
          className={[
            'h-2 w-2 rounded-full',
            live
              ? 'bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.8)]'
              : 'bg-slate-500',
          ].join(' ')}
        />
        {title}{' '}
        <span className="text-sm font-normal text-slate-500">({count})</span>
      </h3>
      {count ? null : (
        <div className="rounded-2xl border border-dashed border-violet-300/20 bg-violet-500/5 p-6 text-sm text-slate-300">
          <p className="font-black text-white">
            No rooms are haunting the hallway yet.
          </p>
          <p className="mt-2 text-slate-400">
            Start a tiny watch coven, summon a cozy stream, and let the goblins
            know where to bring snacks.
          </p>
        </div>
      )}
      {children}
    </section>
  )
}

function RoomCard({
  joinPrivate,
  room,
}: {
  joinPrivate: () => void
  room: DiscoveryRoom
}) {
  const content = (
    <div className="group rounded-2xl border border-white/10 bg-[#171f30] p-4 shadow-lg shadow-black/20 transition hover:border-violet-300/35 hover:shadow-violet-950/30">
      <div className="flex items-start justify-between gap-3">
        <h4 className="min-w-0 truncate text-sm font-black text-white">
          {room.name}
        </h4>
        <span className="rounded-full bg-rose-400/20 px-2 py-0.5 text-[0.58rem] font-black uppercase text-rose-100 ring-1 ring-rose-300/30">
          Live
        </span>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <AvatarStack room={room} />
        <div className="min-w-0 text-xs">
          <div className="truncate font-black text-white">{room.host}</div>
          <div className="text-slate-500">
            Streamer · {room.members} viewers
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-white/5 pt-3 text-xs text-slate-400">
        <UsersRound className="h-3.5 w-3.5" />
        {room.members} / 15{' '}
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{' '}
        <span className="text-emerald-400">Streaming</span>
      </div>
    </div>
  )

  if (room.private)
    return (
      <button
        className="block w-full text-left"
        onClick={joinPrivate}
        type="button"
      >
        {content}
      </button>
    )
  return (
    <Link params={{ roomId: room.id }} to="/rooms/$roomId">
      {content}
    </Link>
  )
}

function PastRoomCard({ room }: { room: DiscoveryRoom }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#171f30] p-4">
      <h4 className="truncate text-sm font-black text-white">{room.name}</h4>
      <div className="mt-4 flex items-center gap-3">
        <AvatarStack room={room} />
        <div className="text-xs">
          <div className="font-black text-white">{room.host}</div>
          <div className="text-slate-500">Stream participants</div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-white/5 pt-3 text-xs text-slate-500">
        <UsersRound className="h-3.5 w-3.5" />
        {room.members} joined <Eye className="h-3.5 w-3.5" />
        Ended · 53m
      </div>
    </div>
  )
}

function AvatarStack({ room }: { room: DiscoveryRoom }) {
  const colors = [
    'from-sky-400 to-cyan-400',
    'from-orange-300 to-rose-500',
    'from-yellow-300 to-amber-500',
    'from-teal-300 to-cyan-500',
  ]
  return (
    <div className="flex -space-x-2">
      {colors
        .slice(0, Math.min(4, Math.max(2, room.streams + 2)))
        .map((color, index) => (
          <span
            className={`grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br ${color} text-[0.58rem] font-black text-white ring-2 ring-[#171f30]`}
            key={color}
          >
            {['KO', 'BI', 'NE', 'MI'][index]}
          </span>
        ))}
      {room.members > 4 ? (
        <span className="grid h-7 w-7 place-items-center rounded-full bg-[#243047] text-[0.58rem] font-black text-white ring-2 ring-[#171f30]">
          +{room.members - 4}
        </span>
      ) : null}
    </div>
  )
}

function Panel({
  children,
  title,
}: {
  children: React.ReactNode
  title: string
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#111827] p-4 shadow-lg shadow-black/20">
      <h3 className="mb-4 text-xs font-black uppercase tracking-wider text-slate-300">
        ✣ {title}
      </h3>
      {children}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/5 bg-[#151d2e] p-3">
      <div className="text-[0.62rem] uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-black text-white">{value}</div>
    </div>
  )
}

function Metric({
  label,
  purple = false,
  value,
}: {
  label: string
  purple?: boolean
  value: string
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">⌁ {label}</dt>
      <dd
        className={[
          'rounded-md px-1.5 py-0.5 font-black',
          purple ? 'bg-violet-500 text-white' : 'bg-white/5 text-slate-200',
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
  )
}

function initials(value: string) {
  return value.slice(0, 2).toUpperCase()
}
