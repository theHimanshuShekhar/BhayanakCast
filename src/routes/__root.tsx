import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useNavigate,
  useRouter,
  useSearch,
} from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import {
  CreateRoomDialog,
  ProfileMenu,
  SettingsDialog,
  type SignInPrompt,
  SignInPromptDialog,
} from "~/components/overlays";
import { SideNav } from "~/components/sidenav";
import { SignInButton } from "~/components/sign-in-button";
import { AppActionsContext } from "~/lib/app-actions";
import { signOut } from "~/lib/auth-client";
import { loadCurrentSession, useCurrentSession } from "~/lib/current-user";
import type { CreateRoomInput } from "~/lib/rooms";
import { createRoomFn } from "~/lib/rooms.functions";
import { liveRoomsQuery, roomKeys, roomQuery } from "~/lib/rooms.queries";
import { SettingsProvider } from "~/lib/settings";
import type { RouterContext } from "~/router";
import appCss from "~/styles/app.css?url";

export const Route = createRootRouteWithContext<RouterContext>()({
  // Runs on the server for SSR and again on each client navigation (via the server fn).
  beforeLoad: async () => ({ session: await loadCurrentSession() }),
  // The rail's live-room badge is on every page.
  loader: ({ context }) => context.queryClient.ensureQueryData(liveRoomsQuery()),
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
  const queryClient = useQueryClient();
  const { user, role } = useCurrentSession();
  const liveCount = useQuery(liveRoomsQuery()).data?.length ?? 0;
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prompt, setPrompt] = useState<SignInPrompt | null>(null);
  // A visitor sent home from a room URL arrives with ?join=<roomId>, which opens the prompt.
  // Home's loader prefetches that room, so its name is there on first paint.
  const { join } = useSearch({ strict: false });
  const joinRoom = useQuery({ ...roomQuery(join ?? ""), enabled: !user && !!join }).data;
  const joinPrompt: SignInPrompt | null =
    !user && join ? { kind: "join", roomName: joinRoom?.name } : null;
  const closePrompt = () => {
    setPrompt(null);
    if (join) navigate({ to: "/", replace: true });
  };

  // End the session, then reload the session in router context and land on the public home.
  // Cached reads were made as the old caller (private rooms, say): drop or refetch them all.
  const signOutToHome = async () => {
    await signOut();
    await navigate({ to: "/" });
    queryClient.removeQueries({ type: "inactive" });
    await Promise.all([queryClient.invalidateQueries(), router.invalidate()]);
  };

  const createRoom = useMutation({
    mutationFn: (input: CreateRoomInput) => createRoomFn({ data: input }),
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: roomKeys.all });
      setCreateOpen(false);
      await navigate({ to: "/room/$roomId", params: { roomId: id } });
    },
  });

  const actions = useMemo(
    () => ({
      // Visitors can't start a room, so they are asked to sign in instead of filling in the form.
      openCreateRoom: () => (user ? setCreateOpen(true) : setPrompt({ kind: "create" })),
      openSettings: () => setSettingsOpen(true),
      promptSignIn: (roomName?: string) => setPrompt({ kind: "join", roomName }),
    }),
    [user],
  );

  return (
    <AppActionsContext value={actions}>
      <div className="grid grid-rows-1 h-[100dvh] bg-bg text-fg">
        <div className="grid grid-cols-[64px_minmax(0,1fr)] max-sm:grid-cols-1 max-sm:grid-rows-[minmax(0,1fr)_auto] min-h-0 overflow-hidden">
          <SideNav
            liveCount={liveCount}
            isAdmin={role === "admin"}
            onCreate={actions.openCreateRoom}
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
          onCreate={createRoom.mutateAsync}
        />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <SignInPromptDialog
          prompt={prompt ?? joinPrompt}
          onOpenChange={(open) => !open && closePrompt()}
        />
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
