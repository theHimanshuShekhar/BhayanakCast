/**
 * Whether an action may happen at `at` under a sliding window (at most `max` in any
 * `windowMs`), recording it in `recent` (epoch ms, oldest first) if so. Refused attempts don't
 * count.
 */
export function withinWindow(recent: number[], max: number, windowMs: number, at: Date): boolean {
  const since = at.getTime() - windowMs;
  const live = recent.filter((t) => t > since);
  const allowed = live.length < max;
  if (allowed) live.push(at.getTime());
  recent.length = 0;
  recent.push(...live);
  return allowed;
}

/** `withinWindow` for the action `key` among several, each with its own record in `sends`. */
export function withinRateLimit(
  sends: Map<string, number[]>,
  key: string,
  max: number,
  windowMs: number,
  at: Date,
): boolean {
  const recent = sends.get(key) ?? [];
  sends.set(key, recent);
  return withinWindow(recent, max, windowMs, at);
}
