import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { CreateRoomDialog, ProfileMenu, SettingsDialog } from "~/components/overlays";
import { SideNav } from "~/components/sidenav";
import { SignInButton } from "~/components/sign-in-button";
import { AppActionsContext } from "~/lib/app-actions";
import { signOut } from "~/lib/auth-client";
import { loadCurrentSession, useCurrentSession } from "~/lib/current-user";
import { createRoom, useLiveRooms } from "~/lib/rooms-store";
import { SettingsProvider } from "~/lib/settings";
import appCss from "~/styles/app.css?url";

export const Route = createRootRoute({
  // Runs on the server for SSR and again on each client navigation (via the server fn).
  beforeLoad: async () => ({ session: await loadCurrentSession() }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "BhayanakCast — live screen sharing" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <SettingsProvider>
        <AppShell />
      </SettingsProvider>
    </RootDocument>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const router = useRouter();
  const { user, role } = useCurrentSession();
  const rooms = useLiveRooms();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // End the session, then reload the session in router context and land on the public home.
  const signOutToHome = async () => {
    await signOut();
    await navigate({ to: "/" });
    await router.invalidate();
  };

  const actions = useMemo(
    () => ({
      openCreateRoom: () => setCreateOpen(true),
      openSettings: () => setSettingsOpen(true),
    }),
    [],
  );

  return (
    <AppActionsContext value={actions}>
      <div className="grid grid-rows-1 h-[100dvh] bg-bg text-fg">
        <div className="grid grid-cols-[64px_minmax(0,1fr)] max-sm:grid-cols-1 max-sm:grid-rows-[minmax(0,1fr)_auto] min-h-0 overflow-hidden">
          <SideNav
            liveCount={rooms.length}
            isAdmin={role === "admin"}
            onCreate={() => setCreateOpen(true)}
            profileMenu={
              user ? (
                <ProfileMenu
                  username={user.username}
                  onOpenProfile={() =>
                    navigate({ to: "/profile/$userId", params: { userId: user.id } })
                  }
                  onSettings={() => setSettingsOpen(true)}
                  onSignOut={signOutToHome}
                />
              ) : (
                <SignInButton variant="rail" />
              )
            }
          />
          <main className="overflow-hidden min-h-0 relative">
            <Outlet />
          </main>
        </div>

        <CreateRoomDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreate={(input) => {
            if (!user) return;
            const room = createRoom(input, user);
            setCreateOpen(false);
            navigate({ to: "/room/$roomId", params: { roomId: room.id } });
          }}
        />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </div>
    </AppActionsContext>
  );
}

// TODO(ADR 13 addendum): derive the theme class and --accent-h from the bc_theme cookie during SSR.
function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
