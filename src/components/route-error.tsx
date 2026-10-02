// What a route shows when its loader fails, is slow, or matches nothing. The router uses these
// as its defaults (src/router.tsx); routes with their own "not found" wording keep it.
import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { Icon, type IconComponent } from "./icons";
import { Btn } from "./ui";

export const RATE_LIMITED_TITLE = "Too many requests";
export const RATE_LIMITED_DETAIL = "Wait a moment and try again.";

/**
 * Whether `error` is the server refusing a public read for going over its limit (#68: HTTP 429,
 * `ReadRateLimitedError`, "Too many requests. Wait a moment and try again."). By the time a
 * loader sees it the status is gone, only the message and, for a server-rendered page, the name
 * survive, so match on those (and on `status` for a thrown `Response`).
 */
export const isRateLimited = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const { name, message, status } = error as {
    name?: unknown;
    message?: unknown;
    status?: unknown;
  };
  return (
    status === 429 ||
    name === "ReadRateLimitedError" ||
    (typeof message === "string" && message.startsWith(RATE_LIMITED_TITLE))
  );
};

const Panel = ({
  icon: I,
  title,
  children,
  role,
}: {
  icon: IconComponent;
  title: string;
  children: React.ReactNode;
  role?: "alert";
}) => (
  <div className="grid place-items-center h-full p-10">
    <div
      role={role}
      className="relative overflow-hidden text-center max-w-[440px] px-7 py-10 bg-canvas border border-border rounded-[var(--radius-lg)] shadow-pop"
    >
      <div className="absolute -inset-px pointer-events-none bg-[radial-gradient(200px_120px_at_50%_0%,var(--color-primary-soft),transparent_60%)]" />
      <div className="relative w-[56px] h-[56px] mx-auto mb-4 rounded-[16px] grid place-items-center bg-surface border border-border text-live-ink shadow-[var(--shadow-card)]">
        <I size={24} />
      </div>
      <h1 className="relative m-0 mb-2 text-lg tracking-[-0.01em]">{title}</h1>
      {children}
    </div>
  </div>
);

// A plain link, not the router's: a full load from an error page starts from a clean slate.
const HomeLink = () => (
  <a
    href="/"
    className="inline-flex items-center justify-center h-[34px] px-3.5 text-[12px] font-medium rounded-[var(--radius-sm)] border bg-surface border-border text-fg shadow-card hover:bg-surface-2 hover:border-border-strong"
  >
    Back to rooms
  </a>
);

/**
 * The failure screen. `detail` is the technical message: pass it only outside production, since
 * a server error's message can say more than a visitor should see. Never shows a stack.
 */
export const RouteErrorView = ({
  rateLimited,
  detail,
  onRetry,
}: {
  rateLimited: boolean;
  detail?: string;
  onRetry: () => void;
}) => (
  <Panel
    role="alert"
    icon={rateLimited ? Icon.Clock : Icon.Activity}
    title={rateLimited ? RATE_LIMITED_TITLE : "Something went wrong"}
  >
    <p className="relative m-0 mb-[18px] text-muted text-[12.5px]">
      {rateLimited
        ? `${RATE_LIMITED_TITLE}. ${RATE_LIMITED_DETAIL}`
        : "We couldn't load this page. Try again, or head back to the rooms."}
    </p>
    {detail && !rateLimited && (
      <p className="relative m-0 mb-[18px] text-subtle text-[11px] font-mono break-words">
        {detail}
      </p>
    )}
    <div className="relative flex gap-2 justify-center">
      <Btn variant="primary" onClick={onRetry}>
        Retry
      </Btn>
      <HomeLink />
    </div>
  </Panel>
);

/** The router's `defaultErrorComponent`. */
export const RouteError = ({ error, reset }: ErrorComponentProps) => {
  const router = useRouter();
  return (
    <RouteErrorView
      rateLimited={isRateLimited(error)}
      detail={import.meta.env.DEV && error instanceof Error ? error.message : undefined}
      onRetry={() => {
        // The loader has to run again for a loader failure; `reset` clears the error boundary
        // for a render failure.
        reset();
        void router.invalidate();
      }}
    />
  );
};

/** The router's `defaultNotFoundComponent`: a URL no route matches. */
export const RouteNotFound = () => (
  <Panel icon={Icon.Search} title="Page not found">
    <p className="relative m-0 mb-[18px] text-muted text-[12.5px]">
      There's nothing at this address.
    </p>
    <div className="relative flex gap-2 justify-center">
      <HomeLink />
    </div>
  </Panel>
);

/** The router's `defaultPendingComponent`: shown only once a loader is slow (`defaultPendingMs`). */
export const RoutePending = () => (
  <div role="status" className="grid place-items-center h-full p-10 text-muted text-[12px]">
    <span className="inline-flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bc-pulse" />
      Loading…
    </span>
  </div>
);
