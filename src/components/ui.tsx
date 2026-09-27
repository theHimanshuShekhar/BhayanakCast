// Shared primitives ported from docs/design/prototype/components.jsx + overlays.jsx.
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { avatarFor, initials, SCREEN_KINDS } from "~/lib/format";
import type { ScreenKind } from "~/lib/types";

const SIZE_CLS = {
  sm: "w-5 h-5 text-[7px]",
  md: "w-7 h-7 text-[10px]",
  lg: "w-10 h-10 text-[14px]",
  xl: "w-[84px] h-[84px] text-[28px]",
} as const;
type AvatarSize = keyof typeof SIZE_CLS;

export const Avatar = ({
  name,
  size = "md",
  ring = false,
  className = "",
}: {
  name: string;
  size?: AvatarSize;
  ring?: boolean;
  className?: string;
}) => {
  const { c1, c2 } = avatarFor(name || "??");
  const ringCls = ring
    ? "shadow-[0_0_0_2px_var(--color-primary),0_0_12px_var(--color-primary-glow)]"
    : "shadow-[inset_0_0_0_1px_oklch(0_0_0/0.15)]";
  return (
    <span
      className={`inline-grid place-items-center rounded-full text-white font-bold flex-shrink-0 leading-none ${SIZE_CLS[size]} ${ringCls} ${className}`}
      style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
    >
      {initials(name || "??")}
    </span>
  );
};

export const AvatarStack = ({
  names,
  max = 3,
  size = "sm",
}: {
  names: string[];
  max?: number;
  size?: AvatarSize;
}) => {
  const visible = names.slice(0, max);
  const rest = Math.max(0, names.length - max);
  return (
    <span className="inline-flex [&>*+*]:-ml-2 [&>*+*]:shadow-[0_0_0_2px_var(--color-bg)_inset,0_0_0_1px_oklch(0_0_0/0.15)_inset]">
      {visible.map((n) => (
        <Avatar key={n} name={n} size={size} />
      ))}
      {rest > 0 && (
        <span
          className={`inline-flex items-center justify-center rounded-full font-semibold flex-shrink-0 ${SIZE_CLS[size]} bg-surface-2 text-fg-muted tabular-nums tracking-tight`}
        >
          +{rest}
        </span>
      )}
    </span>
  );
};

const CHIP_VARIANTS = {
  "": "bg-surface-2 border-border text-fg-muted",
  live: "bg-[color-mix(in_oklch,var(--color-live)_22%,transparent)] border-[color-mix(in_oklch,var(--color-live)_55%,transparent)] text-live-ink",
  accent: "bg-primary border-transparent text-primary-ink font-semibold",
  liveSolid:
    "bg-[color-mix(in_oklch,var(--color-live)_85%,black)] border-transparent text-white font-semibold",
  ok: "bg-[color-mix(in_oklch,var(--color-success)_22%,transparent)] border-[color-mix(in_oklch,var(--color-success)_40%,transparent)] text-success-ink",
} as const;

export const Chip = ({
  children,
  kind = "",
  dot = false,
  className = "",
}: {
  children: ReactNode;
  kind?: keyof typeof CHIP_VARIANTS;
  dot?: boolean;
  className?: string;
}) => {
  const dotBg =
    kind === "liveSolid"
      ? "bg-white animate-bc-pulse"
      : kind === "live"
        ? "bg-live shadow-[0_0_8px_var(--color-live)] animate-bc-pulse"
        : "bg-current";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-[3px] border rounded-full whitespace-nowrap text-[10.5px] tracking-[0.06em] ${CHIP_VARIANTS[kind]} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotBg}`} />}
      {children}
    </span>
  );
};

const BTN_SIZES = { md: "h-[34px] px-3.5 text-[12px]", sm: "h-7 px-2.5 text-[11.5px]" };
const BTN_VARIANTS = {
  default:
    "bg-surface border-border text-fg shadow-card hover:bg-surface-2 hover:border-border-strong",
  primary:
    "bg-primary border-transparent text-primary-ink font-semibold shadow-[0_1px_0_oklch(1_0_0/0.35)_inset,0_-1px_0_oklch(0_0_0/0.2)_inset,0_6px_20px_var(--color-primary-glow)] hover:brightness-110",
  ghost: "bg-transparent border-transparent text-fg hover:bg-surface-2",
  danger:
    "bg-[color-mix(in_oklch,var(--color-live)_18%,var(--color-surface))] border-[color-mix(in_oklch,var(--color-live)_45%,transparent)] text-live-ink",
};

export const Btn = ({
  children,
  variant = "default",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BTN_VARIANTS;
  size?: keyof typeof BTN_SIZES;
}) => (
  <button
    type={type}
    className={`inline-flex items-center justify-center gap-2 border rounded-[var(--radius-sm)] font-medium whitespace-nowrap cursor-pointer transition-[background-color,border-color,filter,transform] duration-[120ms] active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed ${BTN_SIZES[size]} ${BTN_VARIANTS[variant]} ${className}`}
    {...rest}
  >
    {children}
  </button>
);

export const iconBtnCls =
  "w-8 h-8 inline-flex items-center justify-center rounded-[var(--radius-sm)] text-fg-muted cursor-pointer hover:bg-surface-2 hover:text-fg transition-colors";

export const IconBtn = ({
  children,
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button type={type} className={`${iconBtnCls} ${className}`} {...rest}>
    {children}
  </button>
);

export const MonoCaps = ({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) => (
  <span className={`uppercase tracking-[0.12em] text-[10px] text-muted font-medium ${className}`}>
    {children}
  </span>
);

// Stylized screen-share placeholder — striped bg w/ mono label. Stands in until real
// <video> tracks / thumbnails are wired (ADR 1, ADR 10).
export const ScreenPlaceholder = ({
  kind = "ableton",
  label,
  frame = 0,
}: {
  kind?: ScreenKind;
  label?: string | false;
  frame?: number;
}) => {
  const { hue, label: kindLabel } = SCREEN_KINDS[kind];
  // frame shifts the gradient focal points so each snapshot looks like a new capture
  const j = (n: number) => (((Math.sin((frame + 1) * n * 12.9898 + hue) * 43758.5453) % 1) + 1) % 1;
  const ax = frame ? Math.round(10 + j(1) * 40) : 20;
  const ay = frame ? Math.round(j(2) * 40) : 10;
  const bx = frame ? Math.round(55 + j(3) * 40) : 90;
  const by = frame ? Math.round(55 + j(4) * 40) : 90;
  return (
    <div className="absolute inset-0 overflow-hidden bg-bg">
      <div
        className="absolute inset-0"
        style={{
          background: `
          radial-gradient(80% 50% at ${ax}% ${ay}%, oklch(0.3 0.08 ${hue} / 0.55), transparent 60%),
          radial-gradient(60% 50% at ${bx}% ${by}%, oklch(0.4 0.12 ${hue} / 0.45), transparent 60%),
          repeating-linear-gradient(135deg, oklch(0.18 0.02 ${hue}) 0, oklch(0.18 0.02 ${hue}) 14px, oklch(0.14 0.02 ${hue}) 14px, oklch(0.14 0.02 ${hue}) 28px)
        `,
        }}
      />
      {label !== false && (
        <div
          className="absolute top-11 left-2.5 z-[1] text-[9.5px] tracking-[0.16em] px-[7px] py-[3px] rounded-[5px] border border-dashed border-white/15 backdrop-blur-[4px] bg-black/45"
          style={{ color: `oklch(0.9 0.05 ${hue} / 0.8)` }}
        >
          {label || kindLabel}
        </div>
      )}
    </div>
  );
};

export const Wave = ({ on = true }: { on?: boolean }) => (
  <span className="inline-flex items-end gap-[2px] h-3" style={{ opacity: on ? 1 : 0.3 }}>
    {[0, 0.1, 0.2, 0.3, 0.4].map((d) => (
      <i
        key={d}
        className="block w-[2px] h-1 rounded-[2px] bg-primary animate-bc-wave"
        style={{ animationDelay: `${d}s` } as CSSProperties}
      />
    ))}
  </span>
);

export const fieldInput =
  "bg-canvas border border-border rounded-[var(--radius-sm)] px-3 py-2.5 outline-0 text-fg text-[12.5px] focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-soft)] transition-shadow";
export const fieldLabel = "text-[11px] text-muted tracking-[0.06em] uppercase";

// Labelled switch row (design "Toggle"), built on Base UI Switch for a11y.
export const Toggle = ({
  k,
  d,
  on,
  onChange,
  surface = false,
}: {
  k: string;
  d: string;
  on: boolean;
  onChange: (on: boolean) => void;
  surface?: boolean;
}) => (
  // biome-ignore lint/a11y/noLabelWithoutControl: Base UI Switch renders the control inside the label
  <label
    className={`flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-[var(--radius-sm)] w-full text-left cursor-pointer ${surface ? "bg-canvas" : "bg-surface-2 border border-border"}`}
  >
    <div>
      <div className="text-[12px] font-medium">{k}</div>
      <div className="text-[11px] text-muted">{d}</div>
    </div>
    <BaseSwitch.Root
      checked={on}
      onCheckedChange={onChange}
      className="relative flex-shrink-0 w-[34px] h-5 rounded-full border transition-colors duration-150 cursor-pointer bg-surface-2 border-border data-checked:bg-primary data-checked:border-transparent"
    >
      <BaseSwitch.Thumb className="absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-fg-muted transition-[left,background-color] duration-150 data-checked:left-4 data-checked:bg-primary-ink" />
    </BaseSwitch.Root>
  </label>
);

// Segmented control
export const Seg = <V extends string | number>({
  value,
  options,
  onChange,
}: {
  value: V;
  options: readonly (V | { k: string; v: V })[];
  onChange: (v: V) => void;
}) => (
  <div className="flex gap-0.5 p-[3px] bg-canvas border border-border rounded-lg">
    {options.map((o) => {
      const v = typeof o === "object" ? o.v : o;
      const k = typeof o === "object" ? o.k : String(o);
      const active = value === v;
      return (
        <button
          key={k}
          type="button"
          aria-pressed={active}
          onClick={() => onChange(v)}
          className={`flex-1 h-[26px] text-[11px] rounded-md transition-colors cursor-pointer ${active ? "bg-surface-2 text-fg shadow-card" : "text-muted hover:text-fg"}`}
        >
          {k}
        </button>
      );
    })}
  </div>
);
