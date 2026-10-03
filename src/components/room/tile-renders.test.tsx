// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Participant } from "~/lib/types";
import { type Reaction, Tile, type TileVariant } from "./tile";

// How often the room's tiles render (#80): a speaking change, or any other change to one person,
// should re-render that person's tile and no other. Every render of a tile renders its `Avatar`
// (once or twice, by variant), so the count of Avatar renders per name is the probe.

const renders = vi.hoisted(() => new Map<string, number>());
vi.mock("../ui", async (importOriginal) => {
  const ui = await importOriginal<typeof import("../ui")>();
  return {
    ...ui,
    Avatar: (props: Parameters<typeof ui.Avatar>[0]) => {
      renders.set(props.name, (renders.get(props.name) ?? 0) + 1);
      return ui.Avatar(props);
    },
  };
});

const person = (id: string, over: Partial<Participant> = {}): Participant => ({
  id,
  userId: id,
  name: id,
  image: null,
  role: "member",
  streaming: false,
  speaking: false,
  muted: true,
  camera: false,
  ...over,
});

// One of each variant the stage has, two chips among them.
const stage: { p: Participant; variant: TileVariant }[] = [
  { p: person("screen", { streaming: true, size: "l" }), variant: "screen" },
  { p: person("camera", { camera: true }), variant: "camera" },
  { p: person("chip1"), variant: "chip" },
  { p: person("chip2"), variant: "chip" },
];
const names = stage.map(({ p }) => p.name);

// What the room page gives its tiles that doesn't change between renders (its `useCallback`s).
const handlers = {
  onPin: () => {},
  onToggleMute: () => {},
  onVolume: () => {},
  onModerate: () => {},
  onCameraShown: () => {},
  onRetry: () => {},
};

/**
 * The room page's stage, as it builds it on every render: a new `Participant` per person with
 * `speaking` merged in (`people`), and a new, filtered reactions array per tile. Only the
 * handlers are stable.
 */
function Stage({
  speaking,
  volumes = {},
  reactions = [],
}: {
  speaking: ReadonlySet<string>;
  volumes?: Record<string, number>;
  reactions?: (Reaction & { targetUserId: string })[];
}) {
  return stage
    .map(({ p, variant }) => ({ p: { ...p, speaking: speaking.has(p.id) }, variant }))
    .map(({ p, variant }) => (
      <Tile
        key={p.id}
        p={p}
        variant={variant}
        myRole="member"
        locallyMuted={false}
        volume={volumes[p.id] ?? 1}
        reactions={reactions.filter((r) => r.targetUserId === p.userId)}
        {...handlers}
      />
    ));
}

/** Each tile's renders since `since` (a snapshot of the counts), for the names that rendered. */
const rendersSince = (since: Map<string, number>) =>
  Object.fromEntries(
    names
      .map((name) => [name, (renders.get(name) ?? 0) - (since.get(name) ?? 0)])
      .filter(([, n]) => n),
  );

describe("Tile renders", () => {
  beforeEach(() => renders.clear());
  afterEach(cleanup);

  const mount = () => {
    const view = render(<Stage speaking={new Set()} />);
    const mounted = new Map(renders);
    // Every tile rendered once to start with, and the counts below are since then.
    expect(Object.keys(rendersSince(new Map())).sort()).toEqual([...names].sort());
    return { ...view, mounted };
  };

  it.each(stage.map(({ p, variant }) => [variant, p.id] as const))(
    "re-renders only the %s tile when %s starts speaking",
    (_variant, id) => {
      const { rerender, mounted } = mount();
      rerender(<Stage speaking={new Set([id])} />);
      expect(Object.keys(rendersSince(mounted))).toEqual([id]);
    },
  );

  it("re-renders only the tiles whose speaking changed as speakers come and go", () => {
    const { rerender, mounted } = mount();
    rerender(<Stage speaking={new Set(["chip1"])} />);
    rerender(<Stage speaking={new Set(["chip1", "camera"])} />);
    rerender(<Stage speaking={new Set(["camera"])} />);
    expect(Object.keys(rendersSince(mounted)).sort()).toEqual(["camera", "chip1"]);
  });

  it("doesn't re-render any tile when the page re-renders and nothing about them changed", () => {
    const { rerender, mounted } = mount();
    rerender(<Stage speaking={new Set()} />);
    expect(rendersSince(mounted)).toEqual({});
  });

  it("re-renders only the tile whose volume changed", () => {
    const { rerender, mounted } = mount();
    rerender(<Stage speaking={new Set()} volumes={{ chip2: 0.5 }} />);
    expect(Object.keys(rendersSince(mounted))).toEqual(["chip2"]);
  });

  it("re-renders only the tile a reaction floats on, and again when it's gone", () => {
    const { rerender, mounted } = mount();
    const hearts = [{ id: "r1", emoji: "❤️", dx: 4, targetUserId: "camera" }];
    rerender(<Stage speaking={new Set()} reactions={hearts} />);
    expect(Object.keys(rendersSince(mounted))).toEqual(["camera"]);
    // The same reaction, in a new array, is no change.
    const afterOne = new Map(renders);
    rerender(<Stage speaking={new Set()} reactions={[...hearts]} />);
    expect(rendersSince(afterOne)).toEqual({});
    rerender(<Stage speaking={new Set()} reactions={[]} />);
    expect(Object.keys(rendersSince(afterOne))).toEqual(["camera"]);
  });
});
