// Knocks on a private room (ADR 16), as toasts for its approvers: "X wants to join" with
// admit and deny, or dismiss (the people tab lists it still). The server sends `knock.pending`
// only to the host, mods and admins present.
import { Toast } from "@base-ui/react/toast";
import { useEffect } from "react";
import { Icon } from "~/components/icons";
import { Avatar, Btn, iconBtnCls } from "~/components/ui";
import { decideKnock } from "~/lib/knock-live";
import { getRealtimeClient } from "~/lib/realtime-client";

interface KnockToastData {
  userId: string;
  username: string;
  image: string | null;
}

const toastId = (userId: string) => `knock:${userId}`;

/** Knock toasts for `roomId` while mounted; the room page renders it once. */
export function KnockToasts({ roomId }: { roomId: string }) {
  return (
    <Toast.Provider>
      <KnockFeed roomId={roomId} />
      <Toast.Portal>
        <Toast.Viewport className="fixed top-4 right-4 z-[170] flex flex-col gap-2 w-[min(320px,calc(100vw-32px))] outline-0">
          <KnockToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

/** Adds a toast per `knock.pending` and closes it on `knock.resolved`. */
function KnockFeed({ roomId }: { roomId: string }) {
  const toasts = Toast.useToastManager<KnockToastData>();
  useEffect(
    () =>
      getRealtimeClient().subscribe((message) => {
        if (message.type === "knock.pending" && message.roomId === roomId) {
          const { userId, username, image } = message.knock;
          // The same knock again (they reconnected) updates its toast in place.
          toasts.add({
            id: toastId(userId),
            title: `${username} wants to join`,
            // Stays until handled. Default (polite) priority: a high one is hidden from
            // assistive tech until focused, and with it the admit and deny buttons.
            timeout: 0,
            data: { userId, username, image },
          });
        } else if (message.type === "knock.resolved" && message.roomId === roomId) {
          toasts.close(toastId(message.userId));
        }
      }),
    [roomId, toasts],
  );
  return null;
}

function KnockToastList() {
  const { toasts } = Toast.useToastManager<KnockToastData>();
  return toasts.map((toast) => {
    const knocker = toast.data;
    if (!knocker) return null;
    // Closes when the server says it was handled (by anyone), not on click.
    const decide = (admit: boolean) => decideKnock(knocker.userId, admit);
    return (
      <Toast.Root
        key={toast.id}
        toast={toast}
        className="flex flex-col gap-2.5 p-3 bg-surface border border-border-strong rounded-[var(--radius)] shadow-deep outline-0 transition-[opacity,translate] duration-150 data-starting-style:opacity-0 data-starting-style:-translate-y-1 data-ending-style:opacity-0"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar name={knocker.username} image={knocker.image} />
          <Toast.Title className="m-0 text-[12.5px] text-fg font-medium truncate" />
          {/* Out of the way; the knock stays in the people tab's "waiting" group. */}
          <Toast.Close
            aria-label={`dismiss ${knocker.username}'s knock`}
            className={`${iconBtnCls} ml-auto !w-6 !h-6 flex-shrink-0`}
          >
            <Icon.Close size={12} />
          </Toast.Close>
        </div>
        <div className="flex gap-2">
          <Btn
            size="sm"
            variant="primary"
            className="flex-1"
            aria-label={`admit ${knocker.username}`}
            onClick={() => decide(true)}
          >
            admit
          </Btn>
          <Btn
            size="sm"
            className="flex-1"
            aria-label={`deny ${knocker.username}`}
            onClick={() => decide(false)}
          >
            deny
          </Btn>
        </div>
      </Toast.Root>
    );
  });
}
