const secretPattern =
  /secret|token|password|cookie|authorization|database_url|valkey_url/i
const contentKeys: Partial<Record<string, true>> = {
  body: true,
  thumbnailSnapshot: true,
  thumbnailBytes: true,
  data: true,
}

type LogFields = Record<string, unknown>
type LogLevel = 'silent' | 'error' | 'info' | 'debug'

const logLevels: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  info: 2,
  debug: 3,
}

function currentLogLevel(): LogLevel {
  const value = process.env.LOG_LEVEL
  return value === 'silent' || value === 'error' || value === 'debug'
    ? value
    : 'info'
}

export function redactLogFields(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      secretPattern.test(key) || contentKeys[key] ? '[redacted]' : value,
    ]),
  )
}

export function logEvent(
  event: string,
  fields: LogFields = {},
  level: Exclude<LogLevel, 'silent'> = 'info',
) {
  if (logLevels[currentLogLevel()] < logLevels[level]) return

  console.log(JSON.stringify(redactLogFields({ event, ...fields })))
}
