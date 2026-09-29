/**
 * Whether `key` may act at `at` under a sliding window (at most `max` actions in any
 * `windowMs`), recording the action if so. Refused attempts don't count.
 */
export function withinRateLimit(
  sends: Map<string, number[]>,
  key: string,
  max: number,
  windowMs: number,
  at: Date,
): boolean {
  const since = at.getTime() - windowMs;
  const recent = (sends.get(key) ?? []).filter((t) => t > since);
  const allowed = recent.length < max;
  if (allowed) recent.push(at.getTime());
  sends.set(key, recent);
  return allowed;
}
