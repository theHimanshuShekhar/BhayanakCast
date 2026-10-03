/**
 * Draws the images committed in public/ with the same renderer the room cards use (ADR 22):
 * the 1200x630 share image, the apple-touch-icon and the PNG favicon. Run `pnpm og:image` after
 * changing the design in src/server/og-card.ts, and commit the PNGs.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { logoPng, renderSiteCard } from "../src/server/og-card.ts";

const publicFile = (name: string) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));

const images: [string, Uint8Array][] = [
  ["og-image.png", await renderSiteCard()],
  // iOS rounds the corners itself, so the touch icon is full bleed.
  ["apple-touch-icon.png", logoPng(180, false)],
  ["favicon.png", logoPng(48, true)],
];

for (const [name, png] of images) {
  await writeFile(publicFile(name), png);
  console.log(`public/${name} (${png.byteLength} bytes)`);
}
