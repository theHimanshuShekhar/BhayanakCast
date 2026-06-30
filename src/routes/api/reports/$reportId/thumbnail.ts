import { createFileRoute } from '@tanstack/react-router'
import { auth } from '#/lib/auth'
import { isPlatformAdminUser } from '#/lib/admin'
import { loadReportThumbnail } from '#/lib/moderation'

function adminAllowlist() {
  return (process.env.ADMIN_DISCORD_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

export const Route = createFileRoute('/api/reports/$reportId/thumbnail')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const session = await auth.api.getSession({ headers: request.headers })
        if (!session) {
          return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
        }

        const allowed = await isPlatformAdminUser(
          session.user.id,
          adminAllowlist(),
        )
        if (!allowed) {
          return Response.json({ error: 'FORBIDDEN' }, { status: 403 })
        }

        const thumbnail = await loadReportThumbnail(params.reportId)
        if (!thumbnail) {
          return Response.json({ error: 'NOT_FOUND' }, { status: 404 })
        }

        return new Response(new Uint8Array(thumbnail.bytes), {
          headers: { 'content-type': thumbnail.contentType },
        })
      },
    },
  },
})
