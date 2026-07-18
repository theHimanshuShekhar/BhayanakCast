import type { ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouterState,
} from '@tanstack/react-router'
import { ThemeToggle } from '../features/theme/ThemeToggle'
import { createThemeBootstrapScript } from '../features/theme/theme'
import { getThemePreference } from '../server/profile/preference-service'
import type { ThemePreference } from '../server/profile/preference-service'
import '../styles/app.css'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { title: 'BhayanakCast' },
      {
        name: 'description',
        content: 'Discover small social screen-sharing rooms.',
      },
    ],
  }),
  loader: () => getThemePreference(),
  component: RootComponent,
  errorComponent: ({ error, reset }) => (
    <Document>
      <main>
        <h1>Something went wrong</h1>
        <p>{error.message}</p>
        <button type="button" onClick={reset}>Try again</button>
      </main>
    </Document>
  ),
  notFoundComponent: () => (
    <main>
      <h1>Page not found</h1>
      <p>The requested page does not exist.</p>
    </main>
  ),
})

function RootComponent() {
  const themePreference = Route.useLoaderData()
  const showDisplayControls = useRouterState({
    select: (state) => state.location.pathname !== '/',
  })
  return (
    <Document
      showDisplayControls={showDisplayControls}
      themePreference={themePreference}
    >
      <Outlet />
    </Document>
  )
}

function Document({
  children,
  showDisplayControls = true,
  themePreference = { authenticated: false, theme: null },
}: Readonly<{
  children: ReactNode
  showDisplayControls?: boolean
  themePreference?: ThemePreference
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          data-theme-bootstrap=""
          dangerouslySetInnerHTML={{
            __html: createThemeBootstrapScript(themePreference),
          }}
        />
        <HeadContent />
      </head>
      <body>
        {showDisplayControls && (
          <div aria-label="Display controls" className="root-controls" role="region">
            <ThemeToggle initialPreference={themePreference} />
          </div>
        )}
        {children}
        <Scripts />
      </body>
    </html>
  )
}
