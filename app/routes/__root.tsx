import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  createRootRouteWithContext,
  Outlet,
  ScriptOnce,
  ScrollRestoration,
} from "@tanstack/react-router";
import { createServerFn, Meta, Scripts } from "@tanstack/start";
import { lazy, Suspense } from "react";
import Navbar from "~/lib/components/ui/navbar";

import { getAuthSession } from "~/lib/server/auth";
import appCss from "~/lib/styles/app.css?url";

const TanStackRouterDevtools =
  process.env.NODE_ENV === "production"
    ? () => null // Render nothing in production
    : lazy(() =>
        // Lazy load in development
        import("@tanstack/router-devtools").then((res) => ({
          default: res.TanStackRouterDevtools,
        })),
      );

const getUser = createServerFn({ method: "GET" }).handler(async () => {
  const { user } = await getAuthSession();
  return user;
});

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async () => {
    const user = await getUser();
    return { user };
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
  const { user } = Route.useRouteContext();

  return (
    // suppress since we're updating the "dark" class in a custom script below
    <html lang="en" suppressHydrationWarning>
      <head>
        <Meta />
      </head>
      <body>
        <div className="max-h-screen min-h-screen overflow-hidden bg-gray-900 text-purple-500">
          {children}
        </div>
        <ScrollRestoration />
        <Suspense>
          {/* <ReactQueryDevtools buttonPosition="bottom-left" /> */}
          <TanStackRouterDevtools position="bottom-left" />
        </Suspense>

        <ScriptOnce>
          {`document.documentElement.classList.toggle(
            'dark',
            localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)
            )`}
        </ScriptOnce>

        <Scripts />
      </body>
    </html>
  );
}
