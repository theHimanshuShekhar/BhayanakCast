/**
 * A thumbnail as a `data:` URI the card renderer can draw (ADR 22). resvg reads PNG and JPEG
 * but silently draws nothing for WebP, which is what a streamer's browser uploads (ADR 10), so a
 * WebP is decoded (libwebp as WASM, `@jsquash/webp`) and re-encoded as PNG. A thumbnail that
 * won't decode gives null, and the card falls back to its brand backdrop.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { crc32, deflateSync } from "node:zlib";
import decodeWebp, { init as initWebp } from "@jsquash/webp/decode.js";

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const chunk = Buffer.alloc(body.length + 8);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), body.length + 4);
  return chunk;
}

/** RGBA pixels as a PNG (unfiltered rows, fast deflate: it is rendered once, then cached). */
export function encodePng(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  const stride = width * 4;
  const rows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    rows.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows, { level: 1 })),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

/**
 * libwebp's WASM, compiled once. The package would `fetch` its own `.wasm` by file URL, which
 * Node's fetch can't, so the compiled module is handed to it.
 */
let webpReady: Promise<void> | undefined;
function readyWebp(): Promise<void> {
  const wasmPath = createRequire(import.meta.url).resolve("@jsquash/webp/codec/dec/webp_dec.wasm");
  webpReady ??= readFile(wasmPath)
    .then((wasm) => WebAssembly.compile(wasm))
    .then((module) => initWebp(module))
    .catch((error) => {
      webpReady = undefined;
      throw error;
    });
  return webpReady;
}

/** `image` (a stored WebP or JPEG thumbnail) as a `data:` URI of a format resvg draws, or null. */
export async function backdropDataUri(image: Uint8Array, mime: string): Promise<string | null> {
  try {
    if (mime === "image/jpeg")
      return `data:image/jpeg;base64,${Buffer.from(image).toString("base64")}`;
    if (mime !== "image/webp") return null;
    await readyWebp();
    const pixels = await decodeWebp(new Uint8Array(image).buffer);
    const png = encodePng(pixels.width, pixels.height, pixels.data);
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}
