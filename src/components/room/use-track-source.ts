// A media element playing one track: its `srcObject` follows the track, and is cleared on unmount.
import { type RefObject, useEffect } from "react";

export function useTrackSource(
  ref: RefObject<HTMLMediaElement | null>,
  track: MediaStreamTrack,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = new MediaStream([track]);
    return () => {
      element.srcObject = null;
    };
  }, [ref, track]);
}
