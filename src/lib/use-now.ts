import { useEffect, useState } from "react";

/**
 * The current time in ms, or null on the server and the first client render. Text built from
 * `Date.now()` differs between the server render and hydration when it lands either side of a
 * rounding boundary (React error #418, which makes React throw the page away and render it
 * again), so render a placeholder until this is set.
 */
export function useMountedNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  return now;
}
