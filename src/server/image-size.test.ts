import { describe, expect, it } from "vitest";
import { ascii, declaredImageSize } from "./image-size.ts";
import { jpegHeader, webpHeader } from "./test-images.ts";

describe("declaredImageSize of a JPEG", () => {
  it("reads the baseline and progressive frame headers, after skipping other segments", () => {
    expect(declaredImageSize("image/jpeg", jpegHeader(480, 270))).toEqual({
      width: 480,
      height: 270,
    });
    expect(declaredImageSize("image/jpeg", jpegHeader(65535, 1, 0xc2))).toEqual({
      width: 65535,
      height: 1,
    });
  });

  it("is null for something that isn't one, a cut-short header or an empty size", () => {
    const full = jpegHeader(480, 270);
    expect(declaredImageSize("image/jpeg", new Uint8Array())).toBeNull();
    expect(
      declaredImageSize("image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])),
    ).toBeNull();
    // Cut off one byte before the end of the width; with the width complete it reads.
    expect(declaredImageSize("image/jpeg", full.slice(0, 18))).toBeNull();
    expect(declaredImageSize("image/jpeg", full.slice(0, 19))).toEqual({ width: 480, height: 270 });
    expect(declaredImageSize("image/jpeg", jpegHeader(0, 270))).toBeNull();
    expect(declaredImageSize("image/jpeg", jpegHeader(480, 0))).toBeNull();
    expect(declaredImageSize("image/jpeg", webpHeader("VP8 ", 480, 270))).toBeNull();
    // The scan starts before any frame header.
    expect(
      declaredImageSize("image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0])),
    ).toBeNull();
  });
});

describe("declaredImageSize of a JPEG with odd segments", () => {
  const size = { width: 480, height: 270 };
  const SOI = [0xff, 0xd8];
  const afterSoi = jpegHeader(480, 270).slice(2);

  it("skips 0xFF fill bytes before a marker", () => {
    const bytes = Uint8Array.from([...SOI, 0xff, 0xff, 0xff, ...afterSoi]);
    expect(declaredImageSize("image/jpeg", bytes)).toEqual(size);
  });

  it("skips markers that have no length (TEM, RSTn) before the frame header", () => {
    const bytes = Uint8Array.from([...SOI, 0xff, 0x01, 0xff, 0xd0, 0xff, 0xd7, ...afterSoi]);
    expect(declaredImageSize("image/jpeg", bytes)).toEqual(size);
  });

  it("is null for a segment whose length is under 2, which would never advance", () => {
    for (const length of [0, 1]) {
      const bytes = Uint8Array.from([...SOI, 0xff, 0xe0, 0, length, ...afterSoi.slice(4)]);
      expect(declaredImageSize("image/jpeg", bytes)).toBeNull();
    }
  });

  it("is null for a segment that isn't introduced by a marker", () => {
    const bytes = Uint8Array.from([...SOI, 0x00, 0xe0, ...afterSoi]);
    expect(declaredImageSize("image/jpeg", bytes)).toBeNull();
  });
});

describe("declaredImageSize of a WebP", () => {
  it.each(["VP8 ", "VP8L", "VP8X"] as const)("reads the %s header", (kind) => {
    expect(declaredImageSize("image/webp", webpHeader(kind, 480, 270))).toEqual({
      width: 480,
      height: 270,
    });
    expect(declaredImageSize("image/webp", webpHeader(kind, 16383, 1))).toEqual({
      width: 16383,
      height: 1,
    });
  });

  it("reads the extended header's 24-bit canvas", () => {
    expect(declaredImageSize("image/webp", webpHeader("VP8X", 100_000, 90_000))).toEqual({
      width: 100_000,
      height: 90_000,
    });
  });

  it("is null for something that isn't one, a cut-short header or an unknown chunk", () => {
    expect(declaredImageSize("image/webp", new Uint8Array())).toBeNull();
    expect(declaredImageSize("image/webp", jpegHeader(480, 270))).toBeNull();
    for (const kind of ["VP8 ", "VP8L", "VP8X"] as const) {
      expect(declaredImageSize("image/webp", webpHeader(kind, 480, 270).slice(0, 24))).toBeNull();
    }
    const unknown = webpHeader("VP8 ", 480, 270);
    unknown.set(ascii("ALPH"), 12);
    expect(declaredImageSize("image/webp", unknown)).toBeNull();
    // A lossy frame without its start code, and a lossless one without its signature.
    const noStartCode = webpHeader("VP8 ", 480, 270);
    noStartCode[23] = 0;
    expect(declaredImageSize("image/webp", noStartCode)).toBeNull();
    const noSignature = webpHeader("VP8L", 480, 270);
    noSignature[20] = 0;
    expect(declaredImageSize("image/webp", noSignature)).toBeNull();
  });
});
