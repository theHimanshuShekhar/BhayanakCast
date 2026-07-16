export const OPERATOR_TIME_ZONE =
  import.meta.env.PUBLIC_OPERATOR_TIME_ZONE || 'UTC'

export function operatorDay(
  instant = new Date(),
  timeZone = OPERATOR_TIME_ZONE,
) {
  const parts = new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value
      return result
    }, {})
  return `${parts.year}-${parts.month}-${parts.day}`
}
