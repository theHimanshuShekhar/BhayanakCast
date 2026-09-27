import { createRootRoute, HeadContent, Outlet, Scripts, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import {
  CreateRoomDialog,
  ProfileMenu,
  SettingsDialog,
  SignedOutScreen,
} from "~/components/overlays";
import { SideNav } from "~/components/sidenav";
import { AppActionsContext } from "~/lib/app-actions";
import { CURRENT_USER, CURRENT_USER_ADMIN, userIdOf } from "~/lib/mock-data";
import { createRoom, useLiveRooms } from "~/lib/rooms-store";
import { SettingsProvider } from "~/lib/settings";
import appCss from "~/styles/app.css?url";

export const Route = createRootRoute({
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
  const rooms = useLiveRooms();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // TODO(ADR 7): replace with Better Auth session state.
  const [signedOut, setSignedOut] = useState(false);

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
            isAdmin={CURRENT_USER_ADMIN}
            onCreate={() => setCreateOpen(true)}
            profileMenu={
              <ProfileMenu
                onOpenProfile={() =>
                  navigate({ to: "/profile/$userId", params: { userId: userIdOf(CURRENT_USER) } })
                }
                onSettings={() => setSettingsOpen(true)}
                onSignOut={() => setSignedOut(true)}
              />
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
            const room = createRoom(input);
            setCreateOpen(false);
            navigate({ to: "/room/$roomId", params: { roomId: room.id } });
          }}
        />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        {signedOut && <SignedOutScreen onSignIn={() => setSignedOut(false)} />}
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
