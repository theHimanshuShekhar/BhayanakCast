import { expect, test } from './fixtures'

test('keeps two Discord OAuth sessions and projections isolated', async ({
  authSessions,
}) => {
  const [first, second] = await Promise.all([
    authSessions.createBrowserContext({
      id: '102938475610293847',
      username: 'first',
      global_name: 'First member',
      avatar: 'first-avatar',
      email: 'first@example.test',
      verified: true,
    }),
    authSessions.createBrowserContext({
      id: '918273645091827364',
      username: 'second',
      global_name: 'Second member',
      avatar: 'second-avatar',
      verified: false,
    }),
  ])

  expect(first.sessionCookie).not.toBe(second.sessionCookie)

  const firstTokens = await authSessions.inspectDiscordTokens(
    '102938475610293847',
  )
  expect(firstTokens.accessToken).toEqual(expect.any(String))
  expect(firstTokens.refreshToken).toEqual(expect.any(String))
  expect(firstTokens.accessToken).not.toBe(
    'test-discord-access-token-102938475610293847',
  )
  expect(firstTokens.refreshToken).not.toBe(
    'test-refresh-token-test-discord-access-token-102938475610293847',
  )

  const [firstResponse, secondResponse] = await Promise.all([
    first.context.request.get(`${authSessions.origin}/api/session`),
    second.context.request.get(`${authSessions.origin}/api/session`),
  ])

  expect(firstResponse.ok()).toBe(true)
  expect(secondResponse.ok()).toBe(true)
  await expect(firstResponse.json()).resolves.toEqual({
    id: expect.any(String),
    displayName: 'First member',
    avatar:
      'https://cdn.discordapp.com/avatars/102938475610293847/first-avatar.png',
    isPlatformAdmin: false,
    expiresAt: expect.any(String),
  })
  await expect(secondResponse.json()).resolves.toEqual({
    id: expect.any(String),
    displayName: 'Second member',
    avatar:
      'https://cdn.discordapp.com/avatars/918273645091827364/second-avatar.png',
    isPlatformAdmin: false,
    expiresAt: expect.any(String),
  })

  const blockedResponses = await Promise.all([
    first.context.request.get(`${authSessions.origin}/api/auth/get-session`),
    first.context.request.post(`${authSessions.origin}/api/auth/get-access-token`),
    first.context.request.post(`${authSessions.origin}/api/auth/update-user`, {
      data: { name: 'Local override' },
      headers: { origin: authSessions.origin },
    }),
  ])
  expect(blockedResponses.map((response) => response.status())).toEqual([
    404, 404, 404,
  ])
})
