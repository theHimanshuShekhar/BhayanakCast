import type { ButtonHTMLAttributes } from "react";

/** A round room control (mic, camera, share, …): `active` lit, `muted` red, else plain. */
export const ControlBtn = ({
  state,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { state?: "active" | "muted" }) => {
  const st =
    state === "active"
      ? "bg-primary text-primary-ink border-transparent shadow-[0_0_18px_var(--color-primary-glow)]"
      : state === "muted"
        ? "bg-[color-mix(in_oklch,var(--color-live)_22%,var(--color-surface-2))] text-live-ink border-[color-mix(in_oklch,var(--color-live)_40%,transparent)]"
        : "bg-surface-2 text-fg border-border hover:bg-surface-3";
  return (
    <button
      type="button"
      className={`w-10 h-10 rounded-full grid place-items-center border cursor-pointer transition-all duration-[120ms] disabled:opacity-45 disabled:cursor-not-allowed ${st} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
};
