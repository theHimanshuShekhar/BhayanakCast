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
import { THEME_BOOTSTRAP_SCRIPT } from '../features/theme/theme'
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
  const showDisplayControls = useRouterState({
    select: (state) => state.location.pathname !== '/',
  })
  return (
    <Document showDisplayControls={showDisplayControls}>
      <Outlet />
    </Document>
  )
}

function Document({
  children,
  showDisplayControls = true,
}: Readonly<{ children: ReactNode; showDisplayControls?: boolean }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          data-theme-bootstrap=""
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
        <HeadContent />
      </head>
      <body>
        {showDisplayControls && (
          <div aria-label="Display controls" className="root-controls" role="region">
            <ThemeToggle />
          </div>
        )}
        {children}
        <Scripts />
      </body>
    </html>
  )
}
