import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { io } from 'socket.io-client'
import { LogOut, Moon, Plus, Radio, Shield, UsersRound } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { authClient } from '#/lib/auth-client'

function RailButton({
  label,
  to,
  onClick,
  children,
}: {
  label: string
  to: '/' | '/admin' | '/profile'
  onClick?: () => void
  children: ReactNode
}) {
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname
  const current =
    to === '/'
      ? pathname === '/' && label === 'Active rooms'
      : pathname.startsWith(to)

  const className = [
    'relative grid h-10 w-10 place-items-center rounded-2xl text-slate-400 transition',
    'hover:bg-white/[0.06] hover:text-white',
    current
      ? 'bg-[#201b33] text-white shadow-[0_0_24px_rgba(192,108,255,0.55)] ring-1 ring-violet-300/35 before:absolute before:-left-3 before:h-7 before:w-1 before:rounded-r before:bg-violet-400'
      : '',
  ].join(' ')

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {onClick ? (
          <button
            aria-label={label}
            className={className}
            onClick={onClick}
            type="button"
          >
            {children}
          </button>
        ) : (
          <a
            aria-current={current ? 'page' : undefined}
            aria-label={label}
            className={className}
            href={to}
          >
            {children}
          </a>
        )}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function MiniRailButton({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
          type="button"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

export function AppShell({
  children,
  showAdminLink = false,
}: {
  children: ReactNode
  showAdminLink?: boolean
}) {
  const [connectedUsers, setConnectedUsers] = useState(0)
  const [profileOpen, setProfileOpen] = useState(false)
  const session = authClient.useSession()
  const profile = session.data?.user
  const profileName = profile?.name ?? 'You'
  const profileEmail = profile?.email ?? 'connected via oauth'
  const profileImage = profile?.image
  const profileInitials = profileName.slice(0, 2).toUpperCase()

  function signInDiscord() {
    void authClient.signIn.social({
      provider: 'discord',
      callbackURL: window.location.pathname,
    })
  }

  function openCreateRoom() {
    window.dispatchEvent(new Event('bhayanakcast:create-room'))
  }

  useEffect(() => {
    if (import.meta.env.MODE === 'test') return
    const key = 'bhayanakcast:visitor-id'
    const existing = window.localStorage.getItem(key)
    const visitorId = existing ?? window.crypto.randomUUID()
    if (!existing) window.localStorage.setItem(key, visitorId)

    const socket = io({
      auth: { visitorId },
      transports: ['websocket'],
    })
    socket.on('site:presence', (event: { connectedUsers: number }) => {
      setConnectedUsers(event.connectedUsers)
    })
    return () => {
      socket.close()
    }
  }, [])

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[#080d18] font-mono text-slate-100">
        <aside className="fixed inset-y-0 left-0 z-30 flex w-14 flex-col items-center border-r border-white/10 bg-[#0b1220] py-3">
          <a
            aria-label="BhayanakCast home"
            className="grid h-11 w-11 place-items-center rounded-xl border border-white/15 bg-[#0d1628] text-[0.62rem] font-extrabold tracking-tight text-white"
            href="/"
          >
            <span aria-hidden>BC</span>
            <span className="sr-only">bhayanak::cast</span>
          </a>
          <div
            aria-label="Connected Users"
            className="mt-3 flex h-5 min-w-8 items-center justify-center gap-1 rounded-full bg-violet-500 px-1.5 text-[0.62rem] font-bold text-white shadow-[0_0_18px_rgba(192,108,255,0.7)]"
          >
            <UsersRound aria-hidden className="h-3 w-3" />
            {connectedUsers}
          </div>

          <nav className="mt-2 flex flex-1 flex-col items-center gap-2">
            <RailButton label="Active rooms" to="/">
              <Radio className="h-4 w-4" />
            </RailButton>
            <RailButton label="Create room" onClick={openCreateRoom} to="/">
              <Plus className="h-4 w-4" />
            </RailButton>
            {showAdminLink ? (
              <RailButton label="Admin dashboard" to="/admin">
                <Shield className="h-4 w-4" />
              </RailButton>
            ) : null}
          </nav>

          <div className="mb-2 flex flex-col items-center gap-2 border-t border-white/10 pt-2">
            <MiniRailButton label="Toggle theme">
              <Moon className="h-4 w-4" />
            </MiniRailButton>
            <button
              aria-label="Current user profile"
              className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-orange-300 to-rose-500 text-[0.65rem] font-black text-white shadow-[0_0_18px_rgba(255,107,129,0.5)] ring-2 ring-violet-300/45"
              onClick={
                profile ? () => setProfileOpen((open) => !open) : signInDiscord
              }
              type="button"
            >
              {profileImage ? (
                <img
                  alt={profileName}
                  className="h-full w-full object-cover"
                  src={profileImage}
                />
              ) : (
                profileInitials
              )}
            </button>
          </div>
        </aside>

        {profileOpen ? (
          <div className="fixed bottom-4 left-[4.5rem] z-40 w-[330px] overflow-hidden rounded-3xl border border-white/20 bg-[#151d2e] text-slate-100 shadow-2xl shadow-black/50">
            <div className="flex items-center gap-3 p-4">
              <span className="grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-orange-300 to-rose-500 text-sm font-black text-white ring-2 ring-violet-300/60">
                {profileImage ? (
                  <img
                    alt={profileName}
                    className="h-full w-full object-cover"
                    src={profileImage}
                  />
                ) : (
                  profileInitials
                )}
              </span>
              <div>
                <div className="text-sm font-bold">{profileName}</div>
                <div className="text-[0.68rem] text-slate-400">
                  {profileEmail}
                </div>
              </div>
            </div>
            <div className="space-y-1 border-t border-white/10 bg-white/[0.03] p-3 text-sm font-semibold">
              <a
                className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.06]"
                href="/profile"
              >
                <UsersRound className="h-4 w-4" />
                my profile
              </a>
              <div className="my-2 border-t border-white/10" />
              <button
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/[0.06]"
                type="button"
              >
                <LogOut className="h-4 w-4" />
                sign out
              </button>
            </div>
          </div>
        ) : null}

        <main className="min-h-screen pl-14">{children}</main>
      </div>
    </TooltipProvider>
  )
}
