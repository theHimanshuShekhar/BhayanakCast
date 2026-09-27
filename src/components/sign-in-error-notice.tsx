// Shown on home when Discord sign-in comes back with an error (Better Auth's
// `?error=…&error_description=…` redirect). A banned user sees why and for how long.
import { BANNED_USER_ERROR, type SignInErrorSearch } from "~/lib/ban";
import { Icon } from "./icons";

export const SignInErrorNotice = ({
  search,
  onDismiss,
}: {
  search: SignInErrorSearch;
  onDismiss: () => void;
}) => {
  if (!search.error) return null;
  const banned = search.error === BANNED_USER_ERROR;
  const title = banned ? "Your account is banned" : "Sign-in with Discord didn't complete";
  const detail = banned ? search.error_description : "Please try again.";

  return (
    <div
      role="alert"
      className="flex items-start gap-3 mb-4 px-3.5 py-3 rounded-[var(--radius)] border bg-[color-mix(in_oklch,var(--color-live)_12%,transparent)] border-[color-mix(in_oklch,var(--color-live)_45%,transparent)]"
    >
      <span className="inline-flex mt-0.5 text-live-ink">
        <Icon.Lock size={14} />
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
};
