// Someone's camera playing in their tile, or in its picture-in-picture over their share. A
// peer's camera reports whether it is on screen here (`onShown`): one that isn't (its tile
// hidden, collapsed, too small for the PiP, or scrolled away) is paused towards this page
// (ADR 2 addendum).
import { useEffect, useRef } from "react";
import { useTrackSource } from "./use-track-source";

export function CameraVideo({
  userId,
  name,
  track,
  mirrored = false,
  onShown,
}: {
  userId: string;
  name: string;
  track: MediaStreamTrack;
  /** Your own camera, shown like a mirror. */
  mirrored?: boolean;
  /** Keep it stable: called with `userId` whenever the video comes on or goes off screen. */
  onShown?: (userId: string, shown: boolean) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useTrackSource(ref, track);

  useEffect(() => {
    const video = ref.current;
    if (!video || !onShown) return;
    // Not intersecting also covers `display: none` and clipping by the stage's scroll box.
    const observer = new IntersectionObserver((entries) => {
      const last = entries.at(-1);
      if (last) onShown(userId, last.isIntersecting);
    });
    observer.observe(video);
    return () => {
      observer.disconnect();
      onShown(userId, false);
    };
  }, [userId, onShown]);

  return (
    <video
      ref={ref}
      autoPlay
      muted
      playsInline
      aria-label={`${name}'s camera`}
      data-camera={userId}
      className={`absolute inset-0 w-full h-full object-cover ${mirrored ? "-scale-x-100" : ""}`}
    />
  );
}
