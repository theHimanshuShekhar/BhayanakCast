import type { ButtonHTMLAttributes } from "react";

/**
 * A round room control (mic, camera, share, …): `active` lit in the accent, `live` in the tally
 * red (your own share: the one control that means you're on air), else plain. Off is plain too;
 * the slashed icon carries it, so red stays for live (DESIGN.md, The Tally Rule).
 */
export const ControlBtn = ({
  state,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { state?: "active" | "live" }) => {
  const st =
    state === "active"
      ? "bg-primary text-primary-ink border-transparent shadow-[0_0_18px_var(--color-primary-glow)]"
      : state === "live"
        ? "bg-[color-mix(in_oklch,var(--color-live)_72%,black)] text-white border-transparent shadow-[0_0_18px_color-mix(in_oklch,var(--color-live)_45%,transparent)]"
        : "bg-surface-2 text-fg-muted border-border hover:bg-surface-3 hover:text-fg";
  return (
    <button
      type="button"
      className={`min-w-10 h-10 rounded-full inline-flex items-center justify-center gap-1.5 border cursor-pointer focus-visible:outline-fg transition-all duration-[120ms] disabled:opacity-45 disabled:cursor-not-allowed ${st} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
};
