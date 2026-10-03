// "Your camera was disconnected": shown in the room when a mic or camera goes away while on
// (unplugged, or access revoked), with the pre-join device picker to switch to another one and
// a button to try the same one again.
import { Icon } from "~/components/icons";
import { Btn, iconBtnCls } from "~/components/ui";
import { getLocalMedia, type LocalDeviceKind, useLocalMedia } from "~/lib/local-media";
import { DevicePicker, failureText } from "./lobby";
import { useLostDevices } from "./use-lost-devices";

const NAMES: Record<LocalDeviceKind, string> = { mic: "microphone", cam: "camera" };

export function DeviceLossNotice({ onRestored }: { onRestored: (kind: LocalDeviceKind) => void }) {
  const { lost, dismiss } = useLostDevices(onRestored);
  const local = useLocalMedia();
  if (lost.length === 0) return null;
  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[170] flex flex-col gap-2 w-[min(340px,calc(100vw-32px))]">
      {lost.map((kind) => {
        // Trying again can fail too (still unplugged): say why, and keep the choices open.
        const failure = local[kind].failure;
        return (
          <section
            key={kind}
            aria-label={`${NAMES[kind]} disconnected`}
            className="flex flex-col gap-2.5 p-3 bg-surface border border-border-strong rounded-[var(--radius)] shadow-deep"
          >
            <div className="flex items-start gap-2.5">
              {/* Only the message is announced, not the picker and buttons after it. */}
              <p role="alert" className="m-0 flex-1 text-[12.5px] text-fg">
                {failure
                  ? failureText(kind, failure)
                  : `your ${NAMES[kind]} was disconnected and is off. pick another, or plug it back in and try again.`}
              </p>
              <button
                type="button"
                aria-label={`dismiss ${NAMES[kind]} notice`}
                className={`${iconBtnCls} !w-6 !h-6 flex-shrink-0`}
                onClick={() => dismiss(kind)}
              >
                <Icon.Close size={12} />
              </button>
            </div>
            <DevicePicker kind={kind} />
            <Btn
              size="sm"
              disabled={local[kind].status === "starting"}
              onClick={() => void getLocalMedia().enable(kind)}
            >
              try again
            </Btn>
          </section>
        );
      })}
    </div>
  );
}
