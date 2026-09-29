// The one "sign in with discord" entry point (ADR 6 visitors addendum): no sign-in
// page, it goes straight to Discord's consent screen and comes back to home (or, from an
// invite link, to that link: ADR 16).
import { useState } from "react";
import { signInWithDiscord } from "~/lib/auth-client";
import { railBase, tipCls } from "./sidenav";
import { Btn } from "./ui";

const LABEL = "Sign in with Discord";

/** Discord's mark (filled, so it lives here rather than in the stroke icon set). */
const DiscordMark = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M19.3 5.3A16.6 16.6 0 0 0 15.2 4l-.5 1a15.4 15.4 0 0 0-5.4 0L8.8 4a16.5 16.5 0 0 0-4.1 1.3C2.1 9.2 1.4 13 1.8 16.7a16.7 16.7 0 0 0 5 2.5l1.1-1.7a10.8 10.8 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 10.2 0l.4.3c-.5.3-1.1.6-1.7.8l1.1 1.7a16.6 16.6 0 0 0 5-2.5c.5-4.3-.8-8.1-2.3-11.4zM8.7 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z" />
  </svg>
);

/**
 * Starts Better Auth's Discord social sign-in with the callback set to `callbackURL` (home
 * unless given). `rail` fills the side rail's avatar slot; `block` is a full-width primary button.
 */
export const SignInButton = ({
  variant = "block",
  callbackURL = "/",
}: {
  variant?: "rail" | "block";
  callbackURL?: string;
}) => {
  const [pending, setPending] = useState(false);
  const start = async () => {
    setPending(true);
    // On success the browser leaves for Discord; only a failure lands back here.
    const { error } = await signInWithDiscord(callbackURL).catch((e: unknown) => ({ error: e }));
    if (error) setPending(false);
  };

  if (variant === "rail") {
    return (
      <button
        type="button"
        onClick={start}
        disabled={pending}
        aria-label={LABEL}
        className={`${railBase} bg-primary-soft text-primary hover:bg-primary hover:text-primary-ink disabled:opacity-60 disabled:cursor-wait`}
      >
        <span className="inline-flex">
          <DiscordMark />
        </span>
        <span className={tipCls}>{LABEL}</span>
      </button>
    );
  }

  return (
    <Btn variant="primary" className="w-full" onClick={start} disabled={pending}>
      <DiscordMark size={14} /> sign in with discord
    </Btn>
  );
};
