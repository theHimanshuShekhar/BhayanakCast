import { createFileRoute } from '@tanstack/react-router'
import { db } from '#/db'
import { user } from '#/db/schema'
import { assertDevAuthEnabled, devUser } from '#/lib/dev-auth'
import { testAuth } from '#/lib/test-auth-instance'

export const Route = createFileRoute('/api/dev/session')({
  server: {
    handlers: {
      POST: async () => {
        try {
          assertDevAuthEnabled()
        } catch {
          return new Response('Not found', { status: 404 })
        }

        await db
          .insert(user)
          .values(devUser)
          .onConflictDoUpdate({
            target: user.id,
            set: {
              name: devUser.name,
              email: devUser.email,
              emailVerified: devUser.emailVerified,
            },
          })

        const ctx = await testAuth.$context
        const login = await ctx.test.login({ userId: devUser.id })
        const headers = new Headers(login.headers)
        const cookie = login.headers.get('cookie')
        if (cookie)
          headers.set('set-cookie', `${cookie}; Path=/; HttpOnly; SameSite=Lax`)
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
