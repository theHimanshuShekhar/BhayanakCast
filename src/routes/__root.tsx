import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useNavigate,
  useRouter,
  useRouterState,
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
import { siteMeta } from "~/lib/embed";
import { siteOrigin } from "~/lib/embed.functions";
import { useLobbyLive } from "~/lib/lobby-live";
import type { CreateRoomInput } from "~/lib/rooms";
import { createRoomFn } from "~/lib/rooms.functions";
import { roomKeys, roomQuery } from "~/lib/rooms.queries";
import { SettingsProvider, useDocumentAppearance } from "~/lib/settings";
import { getSettings } from "~/lib/settings-fns";
import type { RouterContext } from "~/router";
import appCss from "~/styles/app.css?url";

/** What `z.config({ jitless: true })` stores; zod reads this global as it loads. */
const ZOD_JITLESS_SCRIPT = "globalThis.__zod_globalConfig={jitless:true};";

export const Route = createRootRouteWithContext<RouterContext>()({
  // Runs on the server for SSR and again on each client navigation (via the server fn).
  // `origin` is the site's public URL, for the absolute URLs in every page's link-embed tags.
  beforeLoad: async () => {
    const [session, origin] = await Promise.all([loadCurrentSession(), siteOrigin()]);
    return { session, origin };
  },
  // Initial appearance settings, rendered into <html> during SSR. After that the client's copy
  // is authoritative, so this only reloads when the router is invalidated (e.g. sign-out).
  loader: () => getSettings(),
  staleTime: Number.POSITIVE_INFINITY,
  // The site's link-embed tags are the default; a page with its own (room, recap, profile,
  // invite) overrides them by name (src/lib/embed.ts).
  head: ({ match }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      ...siteMeta(match.context.origin),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      // Some unfurlers and browsers ignore an SVG icon.
      { rel: "icon", type: "image/png", sizes: "48x48", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
    // Zod 4 probes for `new Function` as each object schema is created, and a CSP without
    // `unsafe-eval` reports the caught throw as a violation (ADR 9 addendum on security headers).
    // Its setting has to exist before zod's module runs, which a module in our own bundle can't
    // promise (the chunk holding zod and the schemas evaluates before the entry's own code), so
    // this inline script, nonced like Start's own, runs first. The server keeps compiled parsers.
    scripts: [{ children: ZOD_JITLESS_SCRIPT }],
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
  // The page's realtime socket, reconnected as the session changes (ADR 20).
  useLobbyLive(user?.id ?? null);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prompt, setPrompt] = useState<SignInPrompt | null>(null);
  // A visitor sent home from a room URL arrives with ?join=<roomId>, which opens the prompt.
  // Home's loader prefetches that room, so its name is there on first paint.
  const { join } = useSearch({ strict: false });
  // In a room on a phone, the room's own control bar is the bottom bar.
  const inRoom = useRouterState({ select: (s) => s.location.pathname.startsWith("/room/") });
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
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:px-3 focus:py-2 focus:rounded-[var(--radius-sm)] focus:bg-surface-3 focus:text-fg focus:border focus:border-border-strong focus:shadow-pop"
        >
          skip to content
        </a>
        <div className="grid grid-cols-[64px_minmax(0,1fr)] max-sm:grid-cols-1 max-sm:grid-rows-[minmax(0,1fr)_auto] min-h-0 overflow-hidden">
          <SideNav
            inRoom={inRoom}
            isAdmin={role === "admin"}
            onCreate={actions.openCreateRoom}
            profileMenu={
              user ? (
                <ProfileMenu
                  username={user.username}
                  image={user.image}
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
          <main id="main" tabIndex={-1} className="overflow-hidden min-h-0 relative outline-0">
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
