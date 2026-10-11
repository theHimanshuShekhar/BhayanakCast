// PROTOTYPE (ticket #93), throwaway. Not for main; it lives on the prototype/quality-modal branch.
//
// Question: how should a person see the current quality and bitrate of a stream, and why it is at
// that level? Three structurally different modals, opened from a "quality" button on a stream
// tile (src/components/room/tile.tsx, `onQuality`), read-only, updating every second:
//   A  verdict first   one plain sentence, then a details grid
//   B  pipeline        streamer's step -> the connection -> what you receive; the limit is lit
//   C  live history    sparklines of the last minute and a timeline of step changes
// Each has a viewer view (someone else's share) and a streamer view (your own share, every
// viewer). The data is fake (quality-fake-data.prototype.ts), ticking every second.
//
// Sub-shape A: the variants render on the existing room page (src/routes/room/$roomId.tsx).
// Open a live room, past the lobby, and add ?variant=A|B|C&scenario=1..4. The room's stage then
// shows stand-in tiles (real Tile component) so no live share is needed:
//   1 viewer, direct, best   2 viewer, relay UDP, held by the connection
//   3 viewer, upload shared  4 streamer (you), three viewers
// Gated on import.meta.env.DEV plus ?variant=, so a production build never contains it.
import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import type { Participant } from "~/lib/types";
import { Icon } from "../icons";
import {
  PrototypeSwitcher,
  type ScenarioKey,
  usePrototypeParams,
  type VariantKey,
} from "../prototype-switcher.prototype";
import { iconBtnCls, MonoCaps } from "../ui";
import { SCENARIOS, type Scenario, useFakeQuality } from "./quality-fake-data.prototype";
import { VariantA, VariantB, VariantC } from "./quality-variants.prototype";

const fake = (name: string, over: Partial<Participant> = {}): Participant => ({
  id: `proto-${name}`,
  userId: `proto-${name}`,
  name,
  image: null,
  role: "member",
  streaming: false,
  speaking: false,
  muted: false,
  camera: false,
  ...over,
});

/**
 * The room's people with stand-ins for the scenario: 1-3 show kira's ultrawide share (you
 * watch); 4 makes you the streamer with kira, mo and jules as viewers.
 */
export const prototypePeople = (real: Participant[], scenario: ScenarioKey): Participant[] =>
  scenario === 4
    ? [
        ...real.map((p) =>
          p.you ? { ...p, streaming: true, screen: "game" as const, size: "l" as const } : p,
        ),
        fake("kira"),
        fake("mo", { camera: true }),
        fake("jules", { camera: true }),
      ]
    : [
        fake("kira", { streaming: true, screen: "browser", size: "l" }),
        fake("mo", { camera: true }),
        ...real.filter((p) => p.you),
      ];

/**
 * The prototype's state for the room page: null unless this is a dev build and `?variant=` is
 * set. `onQuality` goes to the tiles; `node` renders the modal and the switcher.
 */
export function useQualityPrototype() {
  const params = usePrototypeParams();
  const [openId, setOpenId] = useState<string | null>(null);
  if (!import.meta.env.DEV || !params.variant) return null;
  return {
    scenario: params.scenario,
    onQuality: setOpenId,
    node: (
      <QualityPrototype
        variant={params.variant}
        scenario={params.scenario}
        set={params.set}
        open={openId !== null}
        onClose={() => setOpenId(null)}
      />
    ),
  };
}

const SIZE: Record<VariantKey, string> = {
  A: "w-[min(460px,94vw)]",
  B: "w-[min(780px,96vw)]",
  C: "w-[min(620px,96vw)]",
};

function QualityPrototype({
  variant,
  scenario,
  set,
  open,
  onClose,
}: {
  variant: VariantKey;
  scenario: ScenarioKey;
  set: ReturnType<typeof usePrototypeParams>["set"];
  open: boolean;
  onClose: () => void;
}) {
  const snap = useFakeQuality(scenario as Scenario);
  // Variant C's streamer view: which viewer's reason is spelled out.
  const [viewerId, setViewerId] = useState("kira");
  const switcher = (
    <PrototypeSwitcher variant={variant} scenario={scenario} scenarioNames={SCENARIOS} set={set} />
  );
  return (
    <>
      <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-[200] bg-black/55 backdrop-blur-[3px] animate-bc-fade" />
          <Dialog.Popup
            className={`fixed z-[201] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${SIZE[variant]} max-h-[calc(100dvh-2rem)] flex flex-col bg-surface border border-border rounded-[var(--radius)] shadow-deep overflow-hidden outline-0 max-sm:top-auto max-sm:bottom-0 max-sm:translate-y-0 max-sm:w-full max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:border-b-0`}
          >
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border-subtle">
              <Dialog.Title className="m-0 text-[15px] tracking-[-0.005em] font-bold flex-1 whitespace-nowrap">
                {snap.role === "streamer"
                  ? "quality · your share"
                  : `quality · ${snap.streamer}'s screen`}
              </Dialog.Title>
              <Dialog.Close className={iconBtnCls} aria-label="Close">
                <Icon.Close size={14} />
              </Dialog.Close>
            </div>
            <div className="px-5 py-4 min-h-0 overflow-auto">
              {variant === "A" && <VariantA snap={snap} />}
              {variant === "B" && <VariantB snap={snap} />}
              {variant === "C" && (
                <VariantC snap={snap} viewerId={viewerId} onViewer={setViewerId} />
              )}
            </div>
            <div className="px-5 py-2.5 border-t border-border-subtle bg-canvas">
              <MonoCaps>
                <span className="text-success-ink">&#9679;</span> live &middot; read-only &middot;
                every second
              </MonoCaps>
            </div>
          </Dialog.Popup>
          {/* Inside the portal: a modal dialog makes the rest of the page inert. */}
          {open && switcher}
        </Dialog.Portal>
      </Dialog.Root>
      {!open && switcher}
    </>
  );
}
