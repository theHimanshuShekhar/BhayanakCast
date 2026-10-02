/**
 * Test helpers: the smallest byte strings that declare a given size in the header formats
 * `declaredImageSize` reads (src/server/image-size.ts). They aren't decodable images.
 */

import { ascii } from "./image-size.ts";

/** A JPEG whose frame header (`sof`: 0xC0 baseline, 0xC2 progressive) declares `width` x `height`. */
export function jpegHeader(width: number, height: number, sof = 0xc0): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    // APP0 (JFIF), to be skipped over.
    0xff,
    0xe0,
    0x00,
    0x06,
    1,
    2,
    3,
    4,
    // Frame header: length 11, 8-bit precision, height, width, one component.
    0xff,
    sof,
    0x00,
    0x0b,
    8,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    1,
    1,
    0x11,
    0,
    // Start of scan and a little entropy-coded data.
    0xff,
    0xda,
    0x00,
    0x04,
    1,
    0,
    0xaa,
  ]);
}

/** A WebP of `kind` (lossy, lossless or extended) declaring `width` x `height`, padded to `size` bytes. */
export function webpHeader(
  kind: "VP8 " | "VP8L" | "VP8X",
  width: number,
  height: number,
  size = 64,
): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii(kind), 0, 0, 0, 0], 0);
  const at = 20;
  if (kind === "VP8 ") {
    // Frame tag, start code, then width and height with the scaling bits set (they're ignored).
    bytes.set([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a], at);
    bytes.set([width & 0xff, (width >> 8) | 0xc0, height & 0xff, (height >> 8) | 0xc0], at + 6);
  } else if (kind === "VP8L") {
    const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
    bytes.set(
      [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff],
      at,
    );
  } else {
    const w = width - 1;
    const h = height - 1;
    bytes.set(
      [0, 0, 0, 0, w & 0xff, (w >> 8) & 0xff, w >> 16, h & 0xff, (h >> 8) & 0xff, h >> 16],
      at,
    );
  }
  return bytes;
}
