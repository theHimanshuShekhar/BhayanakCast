/**
 * Whether an action of weight `count` (default 1) may happen at `at` under a sliding window (at
 * most `max` in any `windowMs`), recording it in `recent` (epoch ms, oldest first, one entry per
 * unit of weight) if so. Refused attempts don't count.
 */
export function withinWindow(
  recent: number[],
  max: number,
  windowMs: number,
  at: Date,
  count = 1,
): boolean {
  const since = at.getTime() - windowMs;
  const live = recent.filter((t) => t > since);
  const allowed = live.length + count <= max;
  if (allowed) for (let i = 0; i < count; i++) live.push(at.getTime());
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
  count = 1,
): boolean {
  const recent = sends.get(key) ?? [];
  sends.set(key, recent);
  return withinWindow(recent, max, windowMs, at, count);
}

/** Forget the keys of `sends` with nothing left in the window ending at `at`. */
export function forgetIdle(sends: Map<string, number[]>, windowMs: number, at: Date): void {
  for (const [key, sent] of sends) {
    if ((sent.at(-1) ?? 0) <= at.getTime() - windowMs) sends.delete(key);
  }
}
