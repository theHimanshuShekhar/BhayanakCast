// Dev-only overlay (spec #37): the ladder rung and codec each of this page's video senders uses
// towards each peer. The room renders it only under `import.meta.env.DEV`, so a production build
// never contains it.
import { useEffect, useState } from "react";
import type { PeerQuality } from "~/lib/mesh";

export function QualityDebug({
  read,
  names,
}: {
  read: () => PeerQuality[];
  /** Display names by user id. */
  names: Readonly<Record<string, string>>;
}) {
  const [peers, setPeers] = useState<PeerQuality[]>([]);
  useEffect(() => {
    const update = () => setPeers(read());
    update();
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  }, [read]);

  const sending = peers.filter((peer) => peer.screen || peer.cam);
  if (sending.length === 0) return null;
  const codec = (mime?: string) => mime?.replace(/^video\//i, "") ?? "…";
  return (
    <div
      data-testid="quality-debug"
      className="absolute bottom-2 left-2 z-50 max-w-[320px] rounded bg-black/70 px-2 py-1 font-mono text-[10.5px] leading-snug text-white pointer-events-none"
    >
      <div className="opacity-70">quality (dev)</div>
      {sending.map((peer) => (
        <div key={peer.userId}>
          {names[peer.userId] ?? peer.userId}
          {peer.screen && ` screen ${peer.screen.rung} ${codec(peer.screen.codec)}`}
          {peer.cam && ` cam ${peer.cam.rung} ${codec(peer.cam.codec)}`}
        </div>
      ))}
    </div>
  );
}
