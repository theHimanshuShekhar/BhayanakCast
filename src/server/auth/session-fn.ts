import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getProductionAuth, readSessionProjection } from './auth'

/** The route layer's one session read. Home, Profile and the room all need the
    same projection to give the rail its identity, and a per-route copy is how
    the room ended up rendering a signed-in member an anonymous rail. */
export const getRouteSession = createServerFn({ method: 'GET' }).handler(() =>
  readSessionProjection(getProductionAuth(), getRequest().headers),
)
