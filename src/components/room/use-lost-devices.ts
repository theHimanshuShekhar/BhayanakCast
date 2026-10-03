// Which of this browser's devices went away while on (unplugged, or access revoked), from the
// moment it did until it's back on or the user dismisses it (src/lib/local-media.ts, `lost`).
import { useCallback, useEffect, useRef, useState } from "react";
import { type LocalDeviceKind, useLocalMedia } from "~/lib/local-media";

const KINDS = ["mic", "cam"] as const;

/**
 * The devices lost and not yet handled, and `dismiss` for one (it stays dismissed until that
 * device is on again or off by choice). `onRestored` is called when a lost device is on again
 * (another one was picked, or the same one came back), so the room can announce it.
 */
export function useLostDevices(onRestored: (kind: LocalDeviceKind) => void) {
  const local = useLocalMedia();
  const [lost, setLost] = useState<LocalDeviceKind[]>([]);
  const dismissed = useRef(new Set<LocalDeviceKind>());
  const restored = useRef(onRestored);
  restored.current = onRestored;
  useEffect(() => {
    for (const kind of KINDS) {
      const { lost: isLost, status } = local[kind];
      if (isLost) {
        if (!dismissed.current.has(kind) && !lost.includes(kind)) setLost((l) => [...l, kind]);
      } else if (status !== "starting") {
        // Back on, or off by choice: the notice, if any, is done with.
        dismissed.current.delete(kind);
        if (lost.includes(kind)) {
          setLost((l) => l.filter((k) => k !== kind));
          if (status === "on") restored.current(kind);
        }
      }
    }
  }, [local, lost]);
  const dismiss = useCallback((kind: LocalDeviceKind) => {
    dismissed.current.add(kind);
    setLost((l) => l.filter((k) => k !== kind));
  }, []);
  return { lost, dismiss };
}
