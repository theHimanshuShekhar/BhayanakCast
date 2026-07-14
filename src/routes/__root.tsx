import type { ReactNode } from 'react'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
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
  return (
    <Document>
      <Outlet />
    </Document>
  )
}

function Document({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
