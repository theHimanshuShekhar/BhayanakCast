export function assertTestAuthEnabled(nodeEnv = process.env.NODE_ENV) {
  if (nodeEnv !== 'test') {
    throw new Error('Test auth bypass is not available outside test runtime')
  }
}
