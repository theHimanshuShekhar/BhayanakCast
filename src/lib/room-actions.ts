import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { auth } from '#/lib/auth'
import { createRoom } from '#/lib/rooms'

export const createRoomInputSchema = z.object({
  name: z.string().trim().min(3).max(80),
  category: z.string().trim().min(1).max(80),
  tags: z.array(z.string().trim().min(1).max(24)).max(5),
  visibility: z.enum(['public', 'private']),
  password: z.string().min(1).optional(),
})

export const createRoomAction = createServerFn({ method: 'POST' })
  .validator(createRoomInputSchema)
  .handler(async ({ data }) => {
    const session = await auth.api.getSession({ headers: getRequest().headers })
    if (!session) return { ok: false as const, code: 'UNAUTHENTICATED' }

    const created = await createRoom({ userId: session.user.id, input: data })
    return { ok: true as const, roomId: created.room.id }
  })
