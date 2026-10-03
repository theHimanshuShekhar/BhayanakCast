// Narrow icon-rail sidenav (64px), bottom bar on phones. Ported from docs/design/prototype/sidenav.jsx.
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ACCENTS } from "~/lib/format";
import { useOnlineCount } from "~/lib/lobby-live";
import { useSettings } from "~/lib/settings";
import { Icon, type IconComponent } from "./icons";

export const tipCls =
  "max-sm:hidden pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 motion-safe:-translate-x-1 px-2.5 py-[5px] bg-surface-3 text-fg border border-border-strong rounded-md text-[11px] tracking-[0.02em] whitespace-nowrap opacity-0 transition-[opacity,transform] duration-150 z-[100] shadow-pop group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0";

export const railBase =
  "group relative w-10 h-10 max-sm:w-11 max-sm:h-11 rounded-[10px] grid place-items-center transition-[background-color,color] duration-150 cursor-pointer";
const railIdle = "text-muted hover:bg-surface hover:text-fg";
const railActive =
  "bg-primary-soft text-primary-strong shadow-[0_0_0_1px_color-mix(in_oklch,var(--color-primary)_40%,transparent),0_0_16px_var(--color-primary-glow)]";

const RailInner = ({
  icon: I,
  label,
  active,
  badge,
}: {
  icon: IconComponent;
  label: string;
  active?: boolean;
  badge?: number;
}) => (
  <>
    {active && (
      <span className="max-sm:hidden absolute -left-3 top-2 bottom-2 w-[3px] bg-primary rounded-r-[3px] shadow-[0_0_10px_var(--color-primary-glow)]" />
    )}
    <span className="inline-flex">
      <I size={16} />
    </span>
    {badge !== undefined && (
      <span className="absolute -top-[3px] -right-[3px] min-w-4 h-4 px-1 rounded-full bg-primary text-primary-ink text-[10px] font-bold leading-none grid place-items-center border-2 border-canvas">
        {badge}
      </span>
    )}
    <span className={tipCls}>{label}</span>
  </>
);

const RailLink = ({
  to,
  icon,
  label,
  badge,
  exact,
}: {
  to: "/" | "/admin";
  icon: IconComponent;
  label: string;
  badge?: number;
  exact?: boolean;
}) => (
  <Link
    to={to}
    aria-label={label}
    activeOptions={{ exact }}
    className={`${railBase} ${railIdle}`}
    activeProps={{ className: `${railBase} ${railActive}` }}
  >
    {({ isActive }) => <RailInner icon={icon} label={label} active={isActive} badge={badge} />}
  </Link>
);

const RailButton = ({
  onClick,
  label,
  children,
  className = "",
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
  className?: string;
}) => (
  <button
    type="button"
    className={`${railBase} ${railIdle} ${className}`}
    onClick={onClick}
    aria-label={label}
  >
    {children}
    <span className={tipCls}>{label}</span>
  </button>
);

/**
 * The rail's live online count (CONTEXT.md: online users plus online visitors), from the lobby
 * socket (ADR 20). A dash until the socket's first snapshot. It reads the count itself, so a
 * lobby update re-renders only this, never the shell around the page.
 */
const OnlineCount = () => {
  const online = useOnlineCount();
  const label = online === null ? "Online: connecting" : `${online} online`;
  return (
    <div
      role="status"
      aria-label={label}
      className="group relative w-10 h-10 grid place-items-center"
    >
      <span className="inline-flex items-center gap-[5px] text-[11px] font-semibold tabular-nums text-fg-muted">
        <span className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_6px_var(--color-success)]" />
        {online ?? "–"}
      </span>
      <span className={tipCls}>{label}</span>
    </div>
  );
};

export const SideNav = ({
  inRoom = false,
  isAdmin,
  onCreate,
  profileMenu,
}: {
  /** On a room page: hidden on phones, where the room's control bar takes the bottom. */
  inRoom?: boolean;
  isAdmin: boolean;
  onCreate: () => void;
  profileMenu: ReactNode;
}) => {
  const { settings, update } = useSettings();
  const accent = ACCENTS.find((a) => a.h === settings.accentHue);
  const accentName = accent?.name ?? "custom";
  const cycleAccent = () => {
    const i = ACCENTS.findIndex((a) => a.h === settings.accentHue);
    update({ accentHue: ACCENTS[(i + 1) % ACCENTS.length]?.h ?? 265 });
  };
  const dark = settings.theme === "dark";

  return (
    <nav
      className={`${inRoom ? "max-sm:hidden " : ""}flex flex-col items-center gap-1 py-3 bg-canvas border-r border-border-subtle min-h-0 overflow-hidden max-sm:order-last max-sm:flex-row max-sm:justify-around max-sm:overflow-visible max-sm:py-1.5 max-sm:px-2 max-sm:pb-[max(6px,env(safe-area-inset-bottom))] max-sm:border-r-0 max-sm:border-t`}
    >
      <Link
        to="/"
        aria-label="BhayanakCast home"
        // "Active Rooms" below is the same link, so keyboard users get it once.
        tabIndex={-1}
        className="max-sm:hidden w-10 h-10 rounded-[10px] grid place-items-center bg-surface-2 border border-border font-extrabold text-[11px] tracking-[0.08em] text-primary-strong shadow-card mb-2 hover:shadow-[var(--shadow-card),0_0_18px_var(--color-primary-glow)] transition-shadow no-underline hover:no-underline"
      >
        BC
      </Link>

      <div className="flex flex-col items-center gap-1 w-full max-sm:contents">
        <RailLink to="/" exact icon={Icon.Users} label="Active Rooms" />
        <RailButton onClick={onCreate} label="Start a Room">
          <span className="inline-flex">
            <Icon.Plus size={16} />
          </span>
        </RailButton>
        {isAdmin && <RailLink to="/admin" icon={Icon.Bolt} label="Admin Dashboard" />}
      </div>

      <div className="flex-1 max-sm:hidden" />

      <OnlineCount />

      <div className="flex flex-col items-center gap-1 pt-2 border-t border-border-subtle w-full max-sm:contents">
        {/* Off the phone bar, where one tap next to navigation would recolour the app; settings
            has the accent picker. */}
        <RailButton
          onClick={cycleAccent}
          label={`Accent · ${accentName}`}
          className="max-sm:hidden"
        >
          <span className="w-4 h-4 rounded-full bg-primary ring-2 ring-canvas shadow-[0_0_0_3px_var(--color-primary-soft),0_0_10px_var(--color-primary-glow)] transition-colors" />
        </RailButton>
        <RailButton
          onClick={() => update({ theme: dark ? "light" : "dark" })}
          label={dark ? "Light mode" : "Dark mode"}
        >
          <span className="inline-flex">
            {dark ? <Icon.Sun size={16} /> : <Icon.Moon size={16} />}
          </span>
        </RailButton>
        {profileMenu}
      </div>
    </nav>
  );
};
