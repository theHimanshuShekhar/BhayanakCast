import { createFileRoute } from '@tanstack/react-router'
import { assertTestAuthEnabled } from '#/lib/test-auth'
import { testAuth } from '#/lib/test-auth-instance'

export const Route = createFileRoute('/api/test/session')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertTestAuthEnabled()
        } catch {
          return new Response('Not found', { status: 404 })
        }

        const body = (await request.json()) as { userId?: string }
        if (!body.userId) {
          return Response.json({ error: 'userId required' }, { status: 400 })
        }

        const ctx = await testAuth.$context
        const login = await ctx.test.login({ userId: body.userId })
        const headers = new Headers(login.headers)
        headers.set('content-type', 'application/json')

        return new Response(
          JSON.stringify({
            userId: login.user.id,
            sessionId: login.session.id,
          }),
          { headers },
        )
      },
    },
  },
})
