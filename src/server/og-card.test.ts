import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { backdropDataUri, encodePng } from "./og-backdrop.ts";
import { drawable, logoPng, nameFontSize, renderRoomCard, renderSiteCard } from "./og-card.ts";
import { jpegHeader, pngSize, WEBP_64X36 } from "./test-images.ts";

const room = {
  name: "Friday ranked grind",
  hostName: "nebula.wav",
  hostAvatar: null,
  watching: 7,
  backdrop: null,
};

const dataUriBytes = (uri: string) => Buffer.from(uri.split(",")[1] ?? "", "base64");

describe("the site card", () => {
  it("is a 1200x630 PNG", async () => {
    const png = await renderSiteCard();
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
  });
});

describe("a room card", () => {
  it("is a 1200x630 PNG, with or without a thumbnail behind it", async () => {
    const backdrop = await backdropDataUri(WEBP_64X36, "image/webp");
    expect(backdrop).not.toBeNull();
    const plain = await renderRoomCard(room);
    const withBackdrop = await renderRoomCard({ ...room, backdrop });
    expect(pngSize(plain)).toEqual({ width: 1200, height: 630 });
    expect(pngSize(withBackdrop)).toEqual({ width: 1200, height: 630 });
    // The thumbnail is drawn, not dropped.
    expect(Buffer.compare(Buffer.from(plain), Buffer.from(withBackdrop))).not.toBe(0);
  });

  it("is still a full card for a name with text the font can't draw, a missing host and a long name", async () => {
    for (const card of [
      { ...room, name: "🎮ゲーム🎮" },
      { ...room, hostName: null },
      { ...room, name: "x".repeat(60), hostName: "h".repeat(32) },
      { ...room, name: "Привет мир", hostName: "Ünïcode" },
    ]) {
      expect(pngSize(await renderRoomCard(card))).toEqual({ width: 1200, height: 630 });
    }
  });
});

describe("the logo icons", () => {
  it("are PNGs of the size asked for", () => {
    expect(pngSize(logoPng(180, false))).toEqual({ width: 180, height: 180 });
    expect(pngSize(logoPng(48, true))).toEqual({ width: 48, height: 48 });
  });
});

describe("drawable", () => {
  it("keeps Latin, Cyrillic and Greek, and drops emoji and CJK", () => {
    expect(drawable("Привет, мир! Ünï ΑΒΓ", "x")).toBe("Привет, мир! Ünï ΑΒΓ");
    expect(drawable("🎮 game ゲーム night", "x")).toBe("game night");
  });

  it("falls back when nothing is drawable", () => {
    expect(drawable("🎮🎮", "A live room")).toBe("A live room");
    expect(drawable("   ", "A live room")).toBe("A live room");
  });
});

describe("nameFontSize", () => {
  it("shrinks as the name gets longer", () => {
    expect(nameFontSize("chill")).toBe(84);
    expect(nameFontSize("x".repeat(40))).toBeLessThan(84);
    expect(nameFontSize("x".repeat(60))).toBeLessThan(nameFontSize("x".repeat(40)));
  });
});

describe("a thumbnail as a backdrop", () => {
  it("is decoded from WebP, which resvg can't draw, into a PNG data URI of the same size", async () => {
    const uri = await backdropDataUri(WEBP_64X36, "image/webp");
    expect(uri).toMatch(/^data:image\/png;base64,/);
    expect(pngSize(dataUriBytes(uri ?? ""))).toEqual({ width: 64, height: 36 });
  });

  it("passes a JPEG through", async () => {
    const jpeg = jpegHeader(480, 270);
    expect(await backdropDataUri(jpeg, "image/jpeg")).toBe(
      `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`,
    );
  });

  it("is null for a WebP that doesn't decode and for another type", async () => {
    expect(await backdropDataUri(new Uint8Array(64).fill(1), "image/webp")).toBeNull();
    expect(await backdropDataUri(WEBP_64X36, "image/gif")).toBeNull();
  });
});

describe("encodePng", () => {
  it("writes the pixels it was given", () => {
    const rgba = Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 128]);
    const png = encodePng(2, 1, rgba);
    expect(pngSize(png)).toEqual({ width: 2, height: 1 });
    // One scanline: a filter byte (0), then the RGBA bytes, inside the single IDAT chunk.
    const idatAt = png.indexOf("IDAT");
    const length = png.readUInt32BE(idatAt - 4);
    const scanline = inflateSync(png.subarray(idatAt + 4, idatAt + 4 + length));
    expect([...scanline]).toEqual([0, 255, 0, 0, 255, 0, 255, 0, 128]);
  });
});
