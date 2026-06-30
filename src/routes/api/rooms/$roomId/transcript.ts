import { createFileRoute } from '@tanstack/react-router'
import { auth } from '#/lib/auth'
import { loadRoomTranscript, RoomServiceError } from '#/lib/rooms'

function adminAllowlist() {
  return (process.env.ADMIN_DISCORD_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

function transcriptStatus(code: string) {
  if (code === 'NOT_FOUND') return 404
  if (code === 'ROOM_NOT_ENDED') return 409
  return 403
}

export const Route = createFileRoute('/api/rooms/$roomId/transcript')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const session = await auth.api.getSession({ headers: request.headers })
        if (!session) {
          return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
        }

        try {
          const transcript = await loadRoomTranscript({
            roomId: params.roomId,
            userId: session.user.id,
            adminDiscordIds: adminAllowlist(),
          })
          return Response.json(transcript)
        } catch (error) {
          if (error instanceof RoomServiceError) {
            return Response.json(
              { error: error.code },
              { status: transcriptStatus(error.code) },
            )
          }
          throw error
        }
      },
    },
  },
})
