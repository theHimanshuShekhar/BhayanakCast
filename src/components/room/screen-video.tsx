// Someone's screen share playing in their tile (yours: your own capture). The tile shows it
// only while the server says they're sharing, so a share a mod stopped is gone here even if
// its media still arrives (ADR 15).
import { useRef } from "react";
import { useTrackSource } from "./use-track-source";

export function ScreenVideo({
  userId,
  name,
  track,
}: {
  userId: string;
  name: string;
  track: MediaStreamTrack;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useTrackSource(ref, track);

  return (
    <div className="flex-1 relative min-h-0 overflow-hidden bg-black">
      {/* Its sound (share audio) plays separately, at the viewer's volume for this share. */}
      <video
        ref={ref}
        autoPlay
        muted
        playsInline
        aria-label={`${name}'s screen`}
        data-screen={userId}
        className="absolute inset-0 w-full h-full object-contain"
      />
    </div>
  );
}
