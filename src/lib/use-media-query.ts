import { useCallback, useSyncExternalStore } from "react";

/** Whether the CSS media `query` matches, live; `server` is the answer during SSR. */
export function useMediaQuery(query: string, server: boolean): boolean {
  // Stable per query: a new function each render would re-subscribe every time.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => server,
  );
}
