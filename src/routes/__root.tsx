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
import { type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
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
import { SettingsProvider, useDocumentAppearance } from "~/lib/settings";
import { getSettings } from "~/lib/settings-fns";
import type { RouterContext } from "~/router";
import appCss from "~/styles/app.css?url";

export const Route = createRootRouteWithContext<RouterContext>()({
  // Runs on the server for SSR and again on each client navigation (via the server fn).
  beforeLoad: async () => ({ session: await loadCurrentSession() }),
  // Initial appearance settings, rendered into <html> during SSR. After that the client's copy
  // is authoritative, so this only reloads when the router is invalidated (e.g. sign-out).
  // It also seeds the live rooms behind the rail's badge (on every page); the badge then reads
  // the query cache, so it stays fresh even though this loader rarely reruns.
  loader: async ({ context }) => {
    const [settings] = await Promise.all([
      getSettings(),
      context.queryClient.ensureQueryData(liveRoomsQuery()),
    ]);
    return settings;
  },
  staleTime: Number.POSITIVE_INFINITY,
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
    <SettingsProvider initial={Route.useLoaderData()}>
      <RootDocument>
        <AppShell />
      </RootDocument>
    </SettingsProvider>
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
      // Mark every room read stale first, but don't wait for the lists to refetch: the new
      // room's page loads its own data.
      void queryClient.invalidateQueries({ queryKey: roomKeys.all });
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
            <Suspense>
              <HydrationMarker />
            </Suspense>
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

/**
 * Marks `<html data-hydrated>` once React has hydrated the server-rendered page, so e2e tests
 * wait for it before interacting (e2e/fixtures.ts): clicks and typing that land on the bare SSR
 * HTML are lost. The page's content sits in the Suspense boundary <Outlet /> renders, which
 * React hydrates in a later pass than the shell; this marker's own boundary hydrates in that
 * same pass, so its effect runs only once the page content is live too.
 */
function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);
  return null;
}

// The theme class and --accent-h come from the user's saved settings or, for a visitor, the
// bc_theme cookie (ADR 13 addendum), so the server-rendered first paint has the right theme.
function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const { className, style } = useDocumentAppearance();
  return (
    <html lang="en" className={className} style={style}>
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
