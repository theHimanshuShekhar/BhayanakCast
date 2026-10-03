// Chat composer emoji picker: a Base UI Popover holding a small curated grid (no emoji library).
// Keyboard: the trigger opens it with focus on the first emoji; arrow keys move around the grid,
// Home/End jump to the ends, Enter/Space picks, Escape closes. Focus then goes to `returnFocus`.
import { Popover } from "@base-ui/react/popover";
import { type KeyboardEvent, type RefObject, useRef, useState } from "react";
import { Icon } from "../icons";
import { iconBtnCls } from "../ui";

const COLUMNS = 8;

/** [emoji, accessible name] */
export const EMOJI: readonly (readonly [string, string])[] = [
  ["😀", "grinning face"],
  ["😂", "tears of joy"],
  ["🤣", "rolling on the floor laughing"],
  ["😊", "smiling face"],
  ["😍", "heart eyes"],
  ["🥹", "holding back tears"],
  ["😎", "sunglasses"],
  ["🤔", "thinking face"],
  ["😅", "sweat smile"],
  ["😭", "loudly crying"],
  ["😤", "huffing"],
  ["😱", "screaming"],
  ["🙃", "upside-down face"],
  ["😴", "sleeping"],
  ["🤯", "mind blown"],
  ["🥳", "partying face"],
  ["👍", "thumbs up"],
  ["👎", "thumbs down"],
  ["👏", "clapping"],
  ["🙌", "raised hands"],
  ["🙏", "folded hands"],
  ["👀", "eyes"],
  ["💪", "flexed biceps"],
  ["🫡", "salute"],
  ["❤️", "red heart"],
  ["🔥", "fire"],
  ["💯", "hundred points"],
  ["✨", "sparkles"],
  ["🎉", "party popper"],
  ["⚡", "high voltage"],
  ["💀", "skull"],
  ["🤝", "handshake"],
  ["🎧", "headphones"],
  ["🎮", "video game"],
  ["🎵", "musical note"],
  ["🍿", "popcorn"],
  ["☕", "hot beverage"],
  ["🍕", "pizza"],
  ["🚀", "rocket"],
  ["👻", "ghost"],
];

export const EmojiPicker = ({
  onPick,
  returnFocus,
}: {
  onPick: (emoji: string) => void;
  /** Where focus goes when the picker closes (the composer input). */
  returnFocus: RefObject<HTMLElement | null>;
}) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (to: number) => {
    const next = Math.max(0, Math.min(EMOJI.length - 1, to));
    setActive(next);
    buttons.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowRight: active + 1,
      ArrowLeft: active - 1,
      ArrowDown: active + COLUMNS,
      ArrowUp: active - COLUMNS,
      Home: 0,
      End: EMOJI.length - 1,
    };
    const to = moves[e.key];
    if (to === undefined) return;
    e.preventDefault();
    move(to);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setActive(0);
      }}
    >
      <Popover.Trigger
        aria-label="Insert emoji"
        className={`${iconBtnCls} !w-7 !h-7 data-popup-open:bg-surface-2 data-popup-open:text-fg`}
      >
        <Icon.Smile size={15} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={10} className="z-[160] outline-0">
          <Popover.Popup
            finalFocus={returnFocus}
            className="p-1.5 bg-surface border border-border-strong rounded-[var(--radius)] shadow-deep outline-0 origin-[var(--transform-origin)] transition-[scale,opacity] duration-100 data-starting-style:opacity-0 motion-safe:data-starting-style:scale-[0.98] data-ending-style:opacity-0"
          >
            <Popover.Title className="sr-only">Emoji</Popover.Title>
            <fieldset
              aria-label="Emoji"
              onKeyDown={onKeyDown}
              className="grid gap-0.5 m-0 p-0 border-0 min-w-0"
              style={{ gridTemplateColumns: `repeat(${COLUMNS}, 2rem)` }}
            >
              {EMOJI.map(([emoji, name], i) => (
                <button
                  key={emoji}
                  ref={(el) => {
                    buttons.current[i] = el;
                  }}
                  type="button"
                  tabIndex={i === active ? 0 : -1}
                  aria-label={name}
                  title={name}
                  onFocus={() => setActive(i)}
                  onClick={() => {
                    onPick(emoji);
                    setOpen(false);
                  }}
                  className="w-8 h-8 grid place-items-center rounded-lg text-lg cursor-pointer outline-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {emoji}
                </button>
              ))}
            </fieldset>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
};
