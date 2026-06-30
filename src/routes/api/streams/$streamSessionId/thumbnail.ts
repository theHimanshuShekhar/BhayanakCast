import { and, eq, isNull } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { db } from '#/db'
import { streamSessions } from '#/db/schema'
import { auth } from '#/lib/auth'
import { storeThumbnail } from '#/lib/streams'

const thumbnailSchema = z.object({
  contentType: z.enum(['image/webp', 'image/jpeg']),
  data: z.string().min(1),
})

export const Route = createFileRoute('/api/streams/$streamSessionId/thumbnail')(
  {
    server: {
      handlers: {
        POST: async ({ params, request }) => {
          const session = await auth.api.getSession({
            headers: request.headers,
          })
          if (!session)
            return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

          const parsed = thumbnailSchema.safeParse(await request.json())
          if (!parsed.success)
            return Response.json(
              { error: 'VALIDATION_FAILED' },
              { status: 400 },
            )

          const streams = await db
            .select({ id: streamSessions.id, roomId: streamSessions.roomId })
            .from(streamSessions)
            .where(
              and(
                eq(streamSessions.id, params.streamSessionId),
                eq(streamSessions.userId, session.user.id),
                isNull(streamSessions.endedAt),
              ),
            )
            .limit(1)
          const stream = streams.at(0)
          if (stream === undefined) {
            return Response.json({ error: 'FORBIDDEN' }, { status: 403 })
          }

          try {
            await storeThumbnail({
              streamSessionId: params.streamSessionId,
              roomId: stream.roomId,
              userId: session.user.id,
              thumbnail: {
                contentType: parsed.data.contentType,
                bytes: Buffer.from(parsed.data.data, 'base64'),
              },
            })
          } catch (error) {
            return Response.json(
              {
                error:
                  error instanceof Error ? error.message : 'INTERNAL_ERROR',
              },
              { status: 400 },
            )
          }

          return Response.json({ ok: true })
        },
      },
    },
  },
)
