import { getProductionAuth, readSessionProjection } from './auth'

export async function handleAuthenticationRequest(
  request: Request,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname
  if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
    if (!isAllowedAuthRoute(request.method, pathname)) {
      return new Response('Not Found', { status: 404 })
    }
    return getProductionAuth().auth.handler(request)
  }
  if (pathname !== '/api/session') return null

  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { allow: 'GET' },
    })
  }

  const projection = await readSessionProjection(
    getProductionAuth(),
    request.headers,
  )
  return Response.json(projection, {
    headers: { 'cache-control': 'private, no-store' },
  })
}

function isAllowedAuthRoute(method: string, pathname: string) {
  return (
    (method === 'POST' && pathname === '/api/auth/sign-in/social') ||
    (method === 'GET' && pathname === '/api/auth/callback/discord') ||
    (method === 'POST' && pathname === '/api/auth/sign-out') ||
    (method === 'GET' && pathname === '/api/auth/error')
  )
}
