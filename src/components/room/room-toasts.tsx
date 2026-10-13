// Short confirmations in the room that aren't about a person (today: "thanks" after a problem
// report). Anyone can add one from anywhere with `roomToasts.add(...)`; the room page renders
// `RoomToasts` once. Knocks have their own toasts (./knock-toasts.tsx), top right.
import { Toast } from "@base-ui/react/toast";

export const roomToasts = Toast.createToastManager();

/** The toasts of `roomToasts`, centred above the control bar. */
export function RoomToasts() {
  return (
    <Toast.Provider toastManager={roomToasts} timeout={5_000}>
      <Toast.Portal>
        <Toast.Viewport className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[250] flex flex-col items-center gap-2 w-[min(320px,calc(100vw-32px))] outline-0">
          <RoomToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function RoomToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className="px-3.5 py-2 bg-surface border border-border-strong rounded-full shadow-deep outline-0 transition-[opacity,translate] duration-150 data-starting-style:opacity-0 motion-safe:data-starting-style:translate-y-1 data-ending-style:opacity-0"
    >
      <Toast.Title className="m-0 text-[12px] text-fg font-medium" />
    </Toast.Root>
  ));
}
