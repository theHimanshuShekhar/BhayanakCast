import type { ReactNode, Ref } from "react";
import { MonoCaps } from "./ui";

export const DOTS = {
  primary: "bg-primary shadow-[0_0_8px_var(--color-primary-glow)]",
  success: "bg-success shadow-[0_0_8px_color-mix(in_oklch,var(--color-success)_60%,transparent)]",
  live: "bg-live shadow-[0_0_8px_var(--color-live)]",
  livePulse: "bg-live shadow-[0_0_8px_var(--color-live)] animate-bc-pulse",
  muted: "bg-muted",
} as const;

export const SectionHead = ({
  title,
  sub,
  dot = "primary",
  size = "md",
  className = "",
  headingRef,
}: {
  title: string;
  sub: ReactNode;
  dot?: keyof typeof DOTS;
  size?: "sm" | "md";
  className?: string;
  /** Makes the heading something focus can be sent to (not a tab stop): a section opened by a button far away. */
  headingRef?: Ref<HTMLHeadingElement>;
}) => (
  <div className={`flex items-baseline gap-2.5 mb-3 ${className}`}>
    <h2
      ref={headingRef}
      tabIndex={headingRef ? -1 : undefined}
      className={`m-0 font-bold inline-flex items-center gap-2 tracking-[-0.005em] ${size === "sm" ? "text-sm" : "text-[15px]"}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${DOTS[dot]}`} /> {title}
    </h2>
    <MonoCaps>{sub}</MonoCaps>
  </div>
);
