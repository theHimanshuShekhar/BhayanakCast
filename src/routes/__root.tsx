import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  ScriptOnce,
  Scripts,
} from "@tanstack/react-router";

import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { posthog } from "posthog-js";

import { useEffect } from "react";
import { NavBar } from "~/lib/components/NavBar";
import { getPostHogData, getUser } from "~/lib/server/functions";
import appCss from "~/lib/styles/app.css?url";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  user: Awaited<ReturnType<typeof getUser>>;
}>()({
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.fetchQuery({
      queryKey: ["user"],
      queryFn: ({ signal }) => getUser({ signal }),
    }); // we're using react-query for caching, see router.tsx

    // Get PostHog data from the server
    const posthog_data = await getPostHogData();
    return { user, posthog_data };
  },
  loader: ({ context }) => {
    return { user: context.user, posthog_data: context.posthog_data };
  },
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "BhayanakCast",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { readonly children: React.ReactNode }) {
  const { user, posthog_data } = Route.useLoaderData();

  useEffect(() => {
    posthog.init(posthog_data.apiKey, {
      api_host: posthog_data.api_host,
    });
  }, [posthog_data]);

  return (
    // suppress since we're updating the "dark" class in a custom script below
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-gray-100 dark:bg-gray-900">
        <ScriptOnce>
          {`document.documentElement.classList.toggle(
            'dark',
            localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)
            )`}
        </ScriptOnce>

        <div className="min-h-screen flex flex-col gap-4 py-4 px-2 font-jetbrains-mono container mx-auto">
          <NavBar user={user} />
          {children}
        </div>

        <ReactQueryDevtools buttonPosition="bottom-left" />
        <TanStackRouterDevtools position="bottom-right" />

        <Scripts />
      </body>
    </html>
  );
}
