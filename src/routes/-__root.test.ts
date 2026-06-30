import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

describe('root shell', () => {
  test('keeps TanStack devtools out of the app shell', () => {
    const source = readFileSync(
      new URL('./__root.tsx', import.meta.url),
      'utf8',
    )

    expect(source).not.toContain('TanStackDevtools')
    expect(source).not.toContain('TanStackRouterDevtoolsPanel')
  })
})
