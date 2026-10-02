/**
 * The pixel size an image declares in its own header, read without decoding it (thumbnails
 * check it before storing, ADR 10: a tiny file can claim a huge size and make every viewer
 * decode that much). Hand-written for the two formats thumbnails use; anything it can't make
 * sense of, including a truncated header, is null.
 */
import type { ThumbnailMime } from "../lib/thumbnails.ts";

export interface ImageSize {
  width: number;
  height: number;
}

/** The size `bytes` declare as an image of `mime`, or null if they aren't one (or are cut short). */
export function declaredImageSize(mime: ThumbnailMime, bytes: Uint8Array): ImageSize | null {
  return mime === "image/webp" ? webpSize(bytes) : jpegSize(bytes);
}

/** The character codes of `text` (the four-character tags in a WebP's header). */
export const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

const nonEmpty = (width: number, height: number): ImageSize | null =>
  width > 0 && height > 0 ? { width, height } : null;

/** Start-of-frame markers (0xC0 to 0xCF) except DHT (C4), JPG (C8) and DAC (CC). */
const isStartOfFrame = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/** Walk the segments from SOI to the first frame header (SOF0 baseline, SOF2 progressive, ...). */
function jpegSize(bytes: Uint8Array): ImageSize | null {
  const u16 = (at: number) => ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    // Fill bytes before a marker.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Markers without a length: TEM, RSTn, SOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    // The scan or the end came before any frame header.
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = u16(at + 2);
    if (length < 2) return null;
    if (isStartOfFrame(marker)) {
      // Length, precision, height, width.
      if (length < 8 || at + 9 > bytes.length) return null;
      return nonEmpty(u16(at + 7), u16(at + 5));
    }
    at += 2 + length;
  }
  return null;
}

/** The first chunk of a RIFF WebP: lossy `VP8 `, lossless `VP8L` or extended `VP8X`. */
function webpSize(bytes: Uint8Array): ImageSize | null {
  const text = (at: number, value: string) =>
    ascii(value).every((code, i) => bytes[at + i] === code);
  const u8 = (at: number) => bytes[at] ?? 0;
  const u16 = (at: number) => u8(at) | (u8(at + 1) << 8);
  const u24 = (at: number) => u16(at) | (u8(at + 2) << 16);
  if (!text(0, "RIFF") || !text(8, "WEBP")) return null;
  const data = 20;
  if (text(12, "VP8 ")) {
    // Frame tag (3 bytes), start code, then 14-bit width and height (the top bits are scaling).
    if (bytes.length < data + 10 || !text(data + 3, "\x9d\x01\x2a")) return null;
    return nonEmpty(u16(data + 6) & 0x3fff, u16(data + 8) & 0x3fff);
  }
  if (text(12, "VP8L")) {
    // Signature byte, then 14 bits each of width - 1 and height - 1.
    if (bytes.length < data + 5 || u8(data) !== 0x2f) return null;
    const bits = u24(data + 1) | (u8(data + 4) << 24);
    return nonEmpty((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (text(12, "VP8X")) {
    // Flags and 3 reserved bytes, then the canvas: 24 bits each of width - 1 and height - 1.
    if (bytes.length < data + 10) return null;
    return nonEmpty(u24(data + 4) + 1, u24(data + 7) + 1);
  }
  return null;
}
