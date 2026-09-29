// A dismissable alert at the top of home: why the user was sent there (a failed or banned
// sign-in, a room an admin ended).
import { Icon, type IconComponent } from "./icons";

export const HomeNotice = ({
  icon: I,
  title,
  detail,
  onDismiss,
}: {
  icon: IconComponent;
  title: string;
  detail?: string;
  onDismiss: () => void;
}) => (
  <div
    role="alert"
    className="flex items-start gap-3 mb-4 px-3.5 py-3 rounded-[var(--radius)] border bg-[color-mix(in_oklch,var(--color-live)_12%,transparent)] border-[color-mix(in_oklch,var(--color-live)_45%,transparent)]"
  >
    <span className="inline-flex mt-0.5 text-live-ink">
      <I size={14} />
    </span>
    <div className="flex-1 min-w-0">
      <div className="text-[13px] font-semibold">{title}</div>
      {detail && <p className="m-0 mt-0.5 text-[12px] text-fg-muted">{detail}</p>}
    </div>
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Dismiss"
      className="w-6 h-6 -mr-1 inline-flex items-center justify-center rounded-md text-muted cursor-pointer hover:bg-surface-2 hover:text-fg transition-colors"
    >
      <Icon.Close size={12} />
    </button>
  </div>
);
