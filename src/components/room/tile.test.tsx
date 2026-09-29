import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Participant } from "~/lib/types";
import { Tile } from "./tile";

// What a tile shows of someone's screen share (#36), rendered to HTML: effects (playing the
// track) don't run, the markup is enough.

const bo: Participant = {
  id: "bo",
  userId: "bo",
  name: "bo",
  role: "member",
  streaming: true,
  speaking: false,
  muted: true,
  camera: false,
  size: "l",
};
const screen = { id: "bo screen", kind: "video" } as unknown as MediaStreamTrack;

const render = (p: Participant, extra: Partial<Parameters<typeof Tile>[0]> = {}) =>
  renderToStaticMarkup(
    <Tile
      p={p}
      layout="grid"
      myRole="member"
      locallyMuted={false}
      reactions={[]}
      onPin={() => {}}
      onToggleMute={() => {}}
      onModerate={() => {}}
      screenTrack={screen}
      {...extra}
    />,
  );

describe("Tile", () => {
  it("shows a streamer's screen", () => {
    expect(render(bo)).toContain('data-screen="bo"');
  });

  it("shows no screen once they aren't sharing, even while its media still arrives", () => {
    // A mod stopped the share: the server says so before (or even if) their media stops.
    const html = render({ ...bo, streaming: false }, { onShareVolume: () => {} });
    expect(html).not.toContain("data-screen");
    expect(html).not.toContain("Share volume");
  });

  it("has a share volume only while their share has sound", () => {
    expect(render(bo)).not.toContain("Share volume for bo");
    expect(render(bo, { onShareVolume: () => {} })).toContain("Share volume for bo");
  });
});
