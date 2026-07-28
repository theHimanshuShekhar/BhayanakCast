/** WebP header reading, kept free of database and Valkey work so the upload
    boundary can validate bytes before anything stores them.

    The server never decodes a preview — decoding attacker-supplied images is
    the expensive, risky part. It reads the container's declared canvas size,
    which is all ADR 0035 needs: a private room's preview must be small enough
    that the blur the client applies is not the only thing hiding the screen. */

export interface WebpDimensions {
  readonly width: number
  readonly height: number
}

const RIFF = 0x52494646
const WEBP = 0x57454250

/** The declared canvas size of a WebP file, or `null` when the bytes are not a
    WebP the browser would have produced. Covers the three chunk layouts
    `canvas.toBlob('image/webp')` emits: lossy `VP8 `, lossless `VP8L`, and the
    extended `VP8X` header a stream with alpha carries. */
export function readWebpDimensions(bytes: Uint8Array): WebpDimensions | null {
  if (bytes.byteLength < 30) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0) !== RIFF || view.getUint32(8) !== WEBP) return null

  const chunk = String.fromCharCode(...bytes.subarray(12, 16))
  if (chunk === 'VP8 ') {
    // Key frame: a 3-byte tag, the 0x9d 0x01 0x2a sync code, then 14-bit
    // dimensions with a 2-bit scale in the high bits.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null
    return size(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null
    const bits = view.getUint32(21, true)
    return size((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
  }
  if (chunk === 'VP8X') {
    return size(readUint24(view, 24) + 1, readUint24(view, 27) + 1)
  }
  return null
}

function readUint24(view: DataView, offset: number) {
  return view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16)
}

function size(width: number, height: number): WebpDimensions | null {
  return width > 0 && height > 0 ? { width, height } : null
}
