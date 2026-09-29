// A peer's received audio, playing: kept out of the tiles, so it plays whether or not their
// tile is shown. Volume and mute are this viewer's own (per-tile local controls).
import { useEffect, useRef } from "react";

export function PeerAudio({
  userId,
  track,
  volume,
  muted,
}: {
  userId: string;
  track: MediaStreamTrack;
  /** 0–1. */
  volume: number;
  muted: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.srcObject = new MediaStream([track]);
    // Browsers may refuse to play sound before the user has interacted with the page (a
    // reload skips the lobby's click): try again on their first click or key press.
    let cancelled = false;
    const retry = () => void audio.play().catch(() => {});
    audio.play().catch(() => {
      // Refused after cleanup (the track changed, or the tile went): nothing to retry.
      if (cancelled) return;
      window.addEventListener("pointerdown", retry, { once: true });
      window.addEventListener("keydown", retry, { once: true });
    });
    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
      audio.srcObject = null;
    };
  }, [track]);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
  }, [volume, muted]);

  // biome-ignore lint/a11y/useMediaCaption: live voice from a peer has no caption track to give
  return <audio ref={ref} autoPlay data-peer={userId} className="hidden" />;
}
