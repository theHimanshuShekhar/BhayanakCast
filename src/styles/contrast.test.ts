// WCAG contrast of the design tokens in app.css, parsed from the stylesheet so a token change that
// drops text under AA fails here. Every text and background pair below is one the app uses.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCENTS, AVATARS } from "~/lib/format";

const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");

type Theme = "light" | "dark";
type Rgba = { r: number; g: number; b: number; a: number };

/** The body of the first block that starts with `opener`, braces balanced. */
const blockAfter = (opener: string) => {
  const start = css.indexOf(opener);
  if (start < 0) throw new Error(`app.css has no ${opener} block`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", start) + 1, i);
  }
  throw new Error(`app.css ${opener} block never closes`);
};

const declarations = (block: string) =>
  Object.fromEntries(
    [...block.matchAll(/(--color-[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]?.trim()]),
  ) as Record<string, string>;

// Light is the `@theme` default, `.dark` overrides it.
const light = declarations(blockAfter("@theme static"));
const dark = { ...light, ...declarations(blockAfter("\n.dark {")) };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** oklch to linear sRGB, unclamped. */
const oklchToLinear = (L: number, C: number, H: number) => {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ] as const;
};

const inGamut = (rgb: readonly number[]) => rgb.every((c) => c >= -0.0001 && c <= 1.0001);

/** oklch to sRGB. An out-of-gamut colour loses chroma until it fits, as browsers map it. */
const oklch = (L: number, C: number, H: number, a = 1): Rgba => {
  let lo = 0;
  let hi = C;
  let rgb = oklchToLinear(L, C, H);
  if (!inGamut(rgb)) {
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(L, mid, H))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinear(L, lo, H);
  }
  const [r, g, b] = rgb.map((c) => fromLinear(clamp01(c)));
  return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a };
};

/** One oklch() literal, with `var(--accent-h)` already replaced by a hue. */
const parseOklch = (value: string): [number, number, number, number] => {
  const m = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)$/);
  if (!m) throw new Error(`not an oklch() colour: ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
};

const over = (top: Rgba, below: Rgba): Rgba => {
  const a = top.a + below.a * (1 - top.a);
  const mix = (t: number, b: number) => (t * top.a + b * below.a * (1 - top.a)) / a;
  return { r: mix(top.r, below.r), g: mix(top.g, below.g), b: mix(top.b, below.b), a };
};

const luminance = ({ r, g, b }: Rgba) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

/** WCAG contrast of `fg` on `bg`; a translucent `fg` is composited over `bg` first. */
const contrast = (fg: Rgba, bg: Rgba) => {
  const flat = over(fg, bg);
  const [hi, lo] = [luminance(flat), luminance(bg)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

/** A colour pair's two sides, resolved for one theme and accent hue. */
const palette = (theme: Theme, hue: number) => {
  const tokens = theme === "dark" ? dark : light;
  const lch = (name: string) => {
    const raw = tokens[`--color-${name}`];
    if (!raw) throw new Error(`no --color-${name} token`);
    return parseOklch(raw.replaceAll("var(--accent-h)", String(hue)));
  };
  const tok = (name: string): Rgba => {
    const [L, C, H, A] = lch(name);
    return oklch(L, C, H, A);
  };
  /**
   * `color-mix(in oklch, <token> <pct>%, <with>)`. `transparent` keeps the token's colour at
   * `pct` alpha, `black` darkens it, and another token blends in oklch along the shorter hue arc.
   */
  const mix = (name: string, pct: number, withColour: string): Rgba => {
    const [L, C, H, A] = lch(name);
    const t = pct / 100;
    if (withColour === "transparent") return oklch(L, C, H, A * t);
    if (withColour === "black") return oklch(L * t, C * t, H, A);
    const [L2, C2, H2] = lch(withColour);
    let dH = H2 - H;
    if (dH > 180) dH -= 360;
    if (dH < -180) dH += 360;
    return oklch(L * t + L2 * (1 - t), C * t + C2 * (1 - t), H + dH * (1 - t), 1);
  };
  return { tok, mix };
};

type P = ReturnType<typeof palette>;
type Pair = {
  label: string;
  /** The smallest ratio WCAG asks for: 4.5 body text, 3 large text and non-text. */
  min: number;
  fg: (p: P) => Rgba;
  bg: (p: P) => Rgba;
  /** The pair's colours depend on the accent hue. */
  accent?: boolean;
};

const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };
const WHITE_AT = (a: number): Rgba => ({ ...WHITE, a });
const BLACK_AT = (a: number): Rgba => ({ r: 0, g: 0, b: 0, a });
// DESIGN.md: screens sit in the dark Screen Well in either theme.
const SCREEN_WELL = oklch(0.14, 0.02, 260);
// `text-[oklch(0.2_0.02_260)]` on `Avatar`: a pastel gradient has no theme, so its ink has none.
const AVATAR_INK = oklch(0.2, 0.02, 260);

const PANELS = ["bg", "canvas", "surface", "surface-2"] as const;
const pairs: Pair[] = [];
for (const text of ["fg", "fg-muted", "muted", "subtle", "live-ink", "success-ink"]) {
  for (const panel of PANELS) {
    pairs.push({
      label: `text-${text} on bg-${panel}`,
      min: 4.5,
      fg: (p) => p.tok(text),
      bg: (p) => p.tok(panel),
    });
  }
}
// `fg` and `fg-muted` also sit on the lightest panel, `surface-3` (tooltips, hovered controls).
for (const text of ["fg", "fg-muted"]) {
  pairs.push({
    label: `text-${text} on bg-surface-3`,
    min: 4.5,
    fg: (p) => p.tok(text),
    bg: (p) => p.tok("surface-3"),
  });
}
// Accent as text (links, the active nav item, stat numbers) is `primary-strong`: the `primary`
// fill is too light for text on the light theme's panels.
for (const panel of PANELS) {
  pairs.push({
    label: `text-primary-strong on bg-${panel}`,
    min: 4.5,
    accent: true,
    fg: (p) => p.tok("primary-strong"),
    bg: (p) => p.tok(panel),
  });
}
pairs.push(
  {
    label: "text-primary-ink on bg-primary (button, accent chip, active control)",
    min: 4.5,
    accent: true,
    fg: (p) => p.tok("primary-ink"),
    bg: (p) => p.tok("primary"),
  },
  {
    label: "text-primary-strong on bg-primary-soft over surface (mod chip)",
    min: 4.5,
    accent: true,
    fg: (p) => p.tok("primary-strong"),
    bg: (p) => over(p.tok("primary-soft"), p.tok("surface")),
  },
  {
    label: "text-primary-strong on primary 15% over surface (admin live pill)",
    min: 4.5,
    accent: true,
    fg: (p) => p.tok("primary-strong"),
    bg: (p) => p.mix("primary", 15, "surface"),
  },
  {
    label: "text-primary-strong on bg-primary-soft over canvas (nav, chip toggle)",
    min: 4.5,
    accent: true,
    fg: (p) => p.tok("primary-strong"),
    bg: (p) => over(p.tok("primary-soft"), p.tok("canvas")),
  },
  {
    label: "text-live-ink on live 22% over surface (live chip)",
    min: 4.5,
    fg: (p) => p.tok("live-ink"),
    bg: (p) => over(p.mix("live", 22, "transparent"), p.tok("surface")),
  },
  {
    label: "text-live-ink on live 22% over surface-2 (live status pill)",
    min: 4.5,
    fg: (p) => p.tok("live-ink"),
    bg: (p) => over(p.mix("live", 22, "transparent"), p.tok("surface-2")),
  },
  {
    label: "text-live-ink on live 18% over surface (danger button)",
    min: 4.5,
    fg: (p) => p.tok("live-ink"),
    bg: (p) => p.mix("live", 18, "surface"),
  },
  {
    label: "text-live-ink on live 28% over surface (danger button, hover)",
    min: 4.5,
    fg: (p) => p.tok("live-ink"),
    bg: (p) => p.mix("live", 28, "surface"),
  },
  {
    label: "text-success-ink on success 22% over surface (ok chip)",
    min: 4.5,
    fg: (p) => p.tok("success-ink"),
    bg: (p) => over(p.mix("success", 22, "transparent"), p.tok("surface")),
  },
  {
    label: "text-success-ink on success 15% over surface (room capacity)",
    min: 4.5,
    fg: (p) => p.tok("success-ink"),
    bg: (p) => over(p.mix("success", 15, "transparent"), p.tok("surface")),
  },
  {
    label: "text-white on live 72% + black (live chip, your share)",
    min: 4.5,
    fg: () => WHITE,
    bg: (p) => p.mix("live", 72, "black"),
  },
  {
    label: "text-white on black/55 over the Screen Well (tile controls, pills)",
    min: 4.5,
    fg: () => WHITE,
    bg: () => over(BLACK_AT(0.55), SCREEN_WELL),
  },
  {
    label: "text-white/85 on black/55 over the Screen Well (time pill)",
    min: 4.5,
    fg: () => WHITE_AT(0.85),
    bg: () => over(BLACK_AT(0.55), SCREEN_WELL),
  },
  {
    label: "text-white on black/70 over the Screen Well (tile notice)",
    min: 4.5,
    fg: () => WHITE,
    bg: () => over(BLACK_AT(0.7), SCREEN_WELL),
  },
  {
    label: "text-white/60 on the Screen Well (no thumbnail yet)",
    min: 4.5,
    fg: () => WHITE_AT(0.6),
    bg: () => SCREEN_WELL,
  },
  // Initials on an avatar's gradient: both ends of every gradient, in dark ink (see `Avatar`).
  ...AVATARS.flatMap((a) =>
    [a.c1, a.c2].map(
      (end): Pair => ({
        label: `avatar initials on ${end}`,
        min: 4.5,
        fg: () => AVATAR_INK,
        bg: () => {
          const [L, C, H] = parseOklch(end);
          return oklch(L, C, H);
        },
      }),
    ),
  ),
  // Non-text: the keyboard focus ring must read against every panel (WCAG 1.4.11).
  ...PANELS.map(
    (panel): Pair => ({
      label: `focus ring (primary-strong) on bg-${panel}`,
      min: 3,
      accent: true,
      fg: (p) => p.tok("primary-strong"),
      bg: (p) => p.tok(panel),
    }),
  ),
);

const failing = (theme: Theme) => {
  const out: string[] = [];
  for (const pair of pairs) {
    for (const { h } of pair.accent ? ACCENTS : [{ h: 265 }]) {
      const p = palette(theme, h);
      const ratio = contrast(pair.fg(p), pair.bg(p));
      if (process.env.CONTRAST_TABLE) {
        console.log(
          `${theme}\t${pair.accent ? h : "-"}\t${ratio.toFixed(2)}\t${pair.min}\t${pair.label}`,
        );
      }
      if (ratio < pair.min)
        out.push(
          `${pair.label}${pair.accent ? ` (hue ${h})` : ""}: ${ratio.toFixed(2)}:1, needs ${pair.min}:1`,
        );
    }
  }
  return out;
};

describe("colour contrast", () => {
  it("keeps every text pair in the light theme at WCAG AA", () => {
    expect(failing("light")).toEqual([]);
  });

  it("keeps every text pair in the dark theme at WCAG AA", () => {
    expect(failing("dark")).toEqual([]);
  });

  it("styles placeholders and the focus ring with the tokens checked above", () => {
    // Tailwind's preflight dims placeholders to half the text colour, so app.css sets them.
    expect(css).toMatch(/::placeholder\s*\{[^}]*color:\s*var\(--color-muted\)/);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:[^;]*var\(--color-primary-strong\)/);
    expect(css).toMatch(/\sa\s*\{[^}]*color:\s*var\(--color-primary-strong\)/);
  });

  it("computes WCAG ratios correctly", () => {
    expect(contrast(oklch(1, 0, 0), oklch(0, 0, 0))).toBeCloseTo(21, 1);
    expect(contrast(oklch(0, 0, 0), oklch(0, 0, 0))).toBeCloseTo(1, 5);
    // #767676 on white is the textbook 4.54:1.
    expect(contrast({ r: 0x76 / 255, g: 0x76 / 255, b: 0x76 / 255, a: 1 }, WHITE)).toBeCloseTo(
      4.54,
      1,
    );
  });
});
