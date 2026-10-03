/**
 * The share images (ADR 22): the site card committed in public/ and the per-room card served at
 * `/api/og/room/<id>.png`, both drawn here. satori lays a React-style tree out as SVG (text
 * becomes paths, so the SVG needs no fonts) and resvg rasterises it to a 1200x630 PNG.
 *
 * Pure rendering: callers hand in everything the card shows, already checked for visibility
 * (./og-room.ts). Plain `.ts` with `createElement`, so `pnpm og:image` runs it on Node directly.
 * The look follows DESIGN.md, "The Late-Night Control Room": midnight ink, one monospace face,
 * screens in dark wells, red only for live, the accent for what is selected. The colours are the
 * dark theme's tokens (src/styles/app.css) at the default hue, as sRGB hex: satori and resvg
 * don't read oklch().
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import { createElement as h, type ReactElement } from "react";
import satori, { type Font } from "satori";
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from "../lib/embed.ts";
import { initials } from "../lib/format.ts";

export const OG = {
  /** `--color-bg` (midnight ink). */
  bg: "#0a0f1a",
  /** `--color-surface-2` (lifted slate). */
  surface2: "#272f3f",
  /** The screen well stream tiles sit in; it doesn't change with the theme. */
  well: "#050911",
  /** `--color-primary` at the default hue, and the dark ink for text on it. */
  primary: "#5d90ff",
  /** The solid LIVE chip: `--color-live` mixed 72% with black, behind white text. */
  liveSolid: "#b13836",
  fg: "#f6f9fc",
  fgDim: "#c0c4cb",
  muted: "#9499a0",
} as const;

/**
 * JetBrains Mono (the app's font, from @fontsource) in the weights the cards use. satori reads
 * TTF, OTF and WOFF but not WOFF2, which is what the CSS imports, so these are the package's
 * WOFF files. Each weight comes in four Unicode ranges, each loaded under its own family name:
 * satori picks one font per family, but tries a `font-family` list in order per glyph, so room
 * names in Latin, Cyrillic and Greek all draw. Anything else (CJK, emoji) has no glyph in this
 * font and is dropped from the text (`drawable`) rather than drawn as a box.
 */
const FONT_WEIGHTS = [400, 700, 800] as const;
const FONT_SUBSETS = ["latin", "latin-ext", "cyrillic", "greek"] as const;
const FONT = FONT_SUBSETS.map((subset) => `JetBrains Mono ${subset}`).join(", ");

let fonts: Font[] | undefined;
function loadFonts(): Font[] {
  if (fonts) return fonts;
  const require = createRequire(import.meta.url);
  fonts = FONT_WEIGHTS.flatMap((weight) =>
    FONT_SUBSETS.map((subset) => ({
      name: `JetBrains Mono ${subset}`,
      weight,
      style: "normal" as const,
      data: readFileSync(
        require.resolve(
          `@fontsource/jetbrains-mono/files/jetbrains-mono-${subset}-${weight}-normal.woff`,
        ),
      ),
    })),
  );
  return fonts;
}

/** Latin, Greek and Cyrillic letters, common punctuation and currency: what the fonts cover. */
const UNDRAWABLE = /[^ -ɏͰ-ϿЀ-ӿḀ-ỿ‐-⁞₠-₿™]/gu;

/** `text` without what the fonts can't draw (it would be a box), or `fallback` if nothing is left. */
export function drawable(text: string, fallback: string): string {
  return text.replace(UNDRAWABLE, "").replace(/\s+/g, " ").trim() || fallback;
}

/** The logo mark of public/favicon.svg, with sRGB colours. `rx` rounds the tile (0: full bleed). */
export function logoSvg(rx = 15): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${rx}" fill="${OG.surface2}"/><g fill="${OG.fg}" fill-rule="evenodd"><path d="M 12 18 H 23 C 30 18 33 21 33 25 C 33 28 31 30 29 31 C 32 32 34 34 34 38 C 34 43 30 46 23 46 H 12 Z M 18 23 V 29 H 23 C 26 29 27 28 27 26 C 27 24 26 23 23 23 Z M 18 34 V 41 H 23 C 26 41 28 40 28 38 C 28 35 26 34 23 34 Z"/><path d="M 54 20 V 26 C 51 24 49 23 46 23 C 42 23 41 26 41 32 C 41 38 42 41 46 41 C 49 41 51 40 54 38 V 44 C 52 46 49 47 46 47 C 38 47 35 42 35 32 C 35 22 38 17 46 17 C 49 17 52 18 54 20 Z"/></g><rect x="12" y="51" width="42" height="4" rx="2" fill="${OG.primary}"/></svg>`;
}

const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

/** The logo tile as a PNG: the apple-touch-icon (full bleed, iOS rounds it) and the PNG favicon. */
export const logoPng = (size: number, rounded: boolean): Uint8Array =>
  new Resvg(logoSvg(rounded ? 15 : 0), { fitTo: { mode: "width", value: size } }).render().asPng();

type Style = Record<string, string | number>;
const fill: Style = { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" };

/** The striped stand-in for a screen that hasn't sent a picture, as the app draws it. */
const stripes = (tint: string) =>
  `repeating-linear-gradient(135deg, ${tint} 0px, ${tint} 14px, transparent 14px, transparent 28px)`;

const text = (style: Style, content: string | number) =>
  h("div", { style: { display: "flex", ...style } }, content);

const brandRow = () =>
  h(
    "div",
    { style: { display: "flex", alignItems: "center", gap: 18 } },
    h("img", { src: svgUri(logoSvg()), width: 56, height: 56 }),
    text({ fontSize: 34, fontWeight: 800, letterSpacing: "-0.02em" }, "BhayanakCast"),
  );

const liveChip = (size: number) =>
  h(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        gap: size * 0.4,
        padding: `${size * 0.3}px ${size * 0.7}px`,
        borderRadius: 999,
        backgroundColor: OG.liveSolid,
        color: "#ffffff",
        fontSize: size,
        fontWeight: 700,
        letterSpacing: "0.06em",
      },
    },
    h("div", {
      style: { width: size * 0.5, height: size * 0.5, borderRadius: 999, backgroundColor: "#fff" },
    }),
    "LIVE",
  );

/** A screen well with the stand-in stripes and the lit hairline edge. */
const well = (style: Style, ...children: ReactElement[]) =>
  h(
    "div",
    {
      style: {
        display: "flex",
        borderRadius: 18,
        border: "2px solid rgba(255,255,255,0.14)",
        backgroundColor: OG.well,
        ...style,
      },
    },
    ...children,
  );

/**
 * The site card: wordmark, the tagline and a mosaic of three screens in dark wells (a room holds
 * up to three shares). No glow and no gradients: red marks the one live screen, and nothing else
 * is lit.
 */
function siteCardTree(): ReactElement {
  const left = h(
    "div",
    { style: { display: "flex", flexDirection: "column", width: 600, gap: 30 } },
    h("img", { src: svgUri(logoSvg()), width: 104, height: 104 }),
    text({ fontSize: 76, fontWeight: 800, letterSpacing: "-0.02em" }, "BhayanakCast"),
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          fontSize: 38,
          fontWeight: 700,
          color: OG.primary,
          lineHeight: 1.25,
        },
      },
      text({}, "Your crew."),
      text({}, "Your screens."),
      text({}, "One room."),
    ),
    text(
      { fontSize: 24, color: OG.fgDim, lineHeight: 1.4 },
      "live screen sharing for small groups. sign in with discord.",
    ),
  );
  const mosaic = h(
    "div",
    { style: { display: "flex", flexDirection: "column", width: 440, gap: 16 } },
    well(
      {
        height: 250,
        padding: 18,
        flexDirection: "column",
        justifyContent: "space-between",
        alignItems: "flex-start",
        backgroundImage: stripes("rgba(93,144,255,0.1)"),
      },
      liveChip(24),
      h(
        "div",
        {
          style: {
            display: "flex",
            padding: "6px 14px",
            borderRadius: 999,
            backgroundColor: "rgba(0,0,0,0.55)",
            fontSize: 20,
            fontWeight: 700,
          },
        },
        "nebula.wav",
      ),
    ),
    h(
      "div",
      { style: { display: "flex", gap: 16 } },
      well({ width: 212, height: 150, backgroundImage: stripes("rgba(86,209,170,0.09)") }),
      well({ width: 212, height: 150, backgroundImage: stripes("rgba(214,120,255,0.09)") }),
    ),
    text({ fontSize: 22, color: OG.muted }, "3 screens at once, 10 people"),
  );
  return h(
    "div",
    {
      style: {
        ...fill,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 80px",
        fontFamily: FONT,
        color: OG.fg,
        backgroundColor: OG.bg,
      },
    },
    left,
    mosaic,
  );
}

export interface RoomCardInput {
  name: string;
  /** Null when the host's account is gone. */
  hostName: string | null;
  /** A `data:` URI of the host's picture, or null for initials. */
  hostAvatar: string | null;
  watching: number;
  /** A `data:` URI of the room's newest thumbnail, or null for the striped stand-in. */
  backdrop: string | null;
}

/**
 * The largest size at which `name` fits on two lines of the card's width. Mono glyphs are 0.6em
 * wide, and breaking at spaces wastes some of each line, so only 1.7 lines' worth is counted.
 */
export function nameFontSize(name: string): number {
  const usable = OG_IMAGE_WIDTH - 2 * 72;
  const fits = (size: number) => (name.length * 0.62 * size) / usable <= 1.7;
  return [84, 68, 54].find(fits) ?? 46;
}

/**
 * The room card: the newest thumbnail darkened behind (the striped stand-in without one), the
 * room's name large, then its host and how many are watching, and the LIVE chip.
 */
function roomCardTree(input: RoomCardInput): ReactElement {
  const card = {
    ...input,
    name: drawable(input.name, "A live room"),
    hostName: input.hostName ? drawable(input.hostName, "host") : null,
  };
  const avatar = card.hostAvatar
    ? h("img", {
        src: card.hostAvatar,
        width: 64,
        height: 64,
        style: { borderRadius: 999, objectFit: "cover" },
      })
    : h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 64,
            height: 64,
            borderRadius: 999,
            backgroundColor: OG.primary,
            color: "#0d1528",
            fontSize: 26,
            fontWeight: 800,
          },
        },
        initials(card.hostName ?? "??"),
      );
  const meta = h(
    "div",
    { style: { display: "flex", alignItems: "center", gap: 18, fontSize: 30 } },
    ...(card.hostName
      ? [avatar, text({ fontWeight: 700 }, card.hostName), text({ color: OG.muted }, "·")]
      : []),
    text({ color: OG.fgDim }, `${card.watching} watching`),
  );
  return h(
    "div",
    {
      style: {
        ...fill,
        display: "flex",
        fontFamily: FONT,
        color: OG.fg,
        backgroundColor: card.backdrop ? OG.bg : OG.well,
        ...(card.backdrop ? {} : { backgroundImage: stripes("rgba(93,144,255,0.1)") }),
      },
    },
    // Dimensions given, so satori doesn't read the image header.
    card.backdrop
      ? h("img", {
          src: card.backdrop,
          width: OG_IMAGE_WIDTH,
          height: OG_IMAGE_HEIGHT,
          style: { ...fill, objectFit: "cover" },
        })
      : null,
    // Keeps the text legible over any screen.
    h("div", {
      style: {
        ...fill,
        backgroundImage:
          "linear-gradient(to bottom, rgba(10,15,26,0.7) 0%, rgba(10,15,26,0.3) 38%, rgba(10,15,26,0.94) 100%)",
      },
    }),
    h(
      "div",
      {
        style: {
          ...fill,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 72px",
        },
      },
      h(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } },
        brandRow(),
        liveChip(28),
      ),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: 30 } },
        h(
          "div",
          {
            style: {
              display: "block",
              fontSize: nameFontSize(card.name),
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              lineClamp: 2,
              wordBreak: "break-word",
              textOverflow: "ellipsis",
            },
          },
          card.name,
        ),
        meta,
      ),
    ),
  );
}

async function renderTree(tree: ReactElement): Promise<Uint8Array> {
  const svg = await satori(tree, {
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    fonts: loadFonts(),
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: OG_IMAGE_WIDTH } }).render().asPng();
}

export const renderSiteCard = (): Promise<Uint8Array> => renderTree(siteCardTree());

export const renderRoomCard = (card: RoomCardInput): Promise<Uint8Array> =>
  renderTree(roomCardTree(card));
