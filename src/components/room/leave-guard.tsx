import { Dialog } from "@base-ui/react/dialog";
import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { Sheet } from "~/components/overlays";
import { Btn } from "~/components/ui";
import { isLeavingForBan } from "~/lib/ban";
import { markInRoom } from "~/lib/room-live";

/** Only a move to another page leaves the room: a link to this room, or new search params, doesn't. */
export const leavesPage = ({
  current,
  next,
}: {
  current: { pathname: string };
  next: { pathname: string };
}) => !isLeavingForBan() && next.pathname !== current.pathname;

/**
 * Asks before this page leaves a room it is in. Mount it only on the room page (not the lobby
 * or the knock screen), with `active` false once the page is out of the room for good (kicked,
 * taken over, ended), so the app's own navigations away from it aren't questioned; a
 * navigation that is the user's own Leave, or sends them home, passes `ignoreBlocker`.
 *
 * In-app navigation to another page (links and the browser's back and forward) opens a
 * confirmation: Stay cancels it, Leave goes on with it, and the room page unmounting is what
 * leaves the room and stops the mic and camera. Closing or reloading the tab gets the
 * browser's own prompt (a page can't customise that one); a ban, which loads home afresh,
 * doesn't (`isLeavingForBan`).
 *
 * If the page stops being in the room while the confirmation is open (kicked, taken over, room
 * gone, ended), it is settled for the user: kept where they are, so the notice shows under the
 * room's URL (the browser has already moved on a Back), or carried on if `sentHome`, when the
 * page is navigating home itself.
 */
export function LeaveGuard({
  roomId,
  active,
  sentHome,
}: {
  roomId: string;
  active: boolean;
  /** The room ended and the page is taking the user home. */
  sentHome: boolean;
}) {
  // The room page stays mounted after a navigation away (the Leave button, the room ending)
  // until the next page has loaded, but the URL has already changed: the browser's prompt
  // follows the URL, so it isn't raised for someone who has already left. (The router calls
  // this on each unload; the function must be stable, as a new one re-registers the blocker.)
  const askOnUnload = useCallback(
    () => !isLeavingForBan() && window.location.pathname === `/room/${roomId}`,
    [roomId],
  );
  const resolver = useBlocker({
    shouldBlockFn: leavesPage,
    enableBeforeUnload: askOnUnload,
    disabled: !active,
    withResolver: true,
  });
  const stay = useRef<HTMLButtonElement>(null);
  const blocked = resolver.status === "blocked";

  // Settles a pending navigation when the guard stops being active or unmounts: the router
  // waits on it, and after a Back the browser has already moved.
  const pending = useRef(resolver);
  pending.current = resolver;
  const goHome = useRef(sentHome);
  goHome.current = sentHome;
  useEffect(() => {
    if (!active) return;
    return () => {
      const { status, proceed, reset } = pending.current;
      if (status !== "blocked") return;
      if (goHome.current) proceed();
      else reset();
    };
  }, [active]);

  return (
    <Sheet
      open={blocked}
      onOpenChange={(open) => !open && resolver.reset?.()}
      title="Leave the room?"
      width="w-[min(400px,94vw)]"
      initialFocus={stay}
      footer={
        <>
          <Dialog.Close ref={stay} render={<Btn />}>
            Stay
          </Dialog.Close>
          <Btn
            variant="danger"
            onClick={() => {
              // As the leave button: the visit ending is what sends room.leave.
              markInRoom(roomId, false);
              resolver.proceed?.();
            }}
          >
            Leave
          </Btn>
        </>
      }
    >
      <p className="m-0 text-[12.5px] text-muted leading-relaxed">
        You'll disconnect from the room, and your mic, camera and screen share will stop.
      </p>
    </Sheet>
  );
}
