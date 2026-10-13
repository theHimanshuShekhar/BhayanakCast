// PROTOTYPE (#114), throwaway: the floating variant switcher. Dev builds only.
// URL param: ?variant=A|B|C. The arrow keys cycle the variant.
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

export const VARIANTS = [
  { key: "A", name: "Filtered log" },
  { key: "B", name: "Swimlanes" },
  { key: "C", name: "Incident first" },
] as const;
export type VariantKey = (typeof VARIANTS)[number]["key"];

/** The prototype's URL state; `variant` is null (prototype off) without a valid `?variant=`. */
export function usePrototypeParams() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();
  const variant = VARIANTS.find((v) => v.key === String(search.variant ?? "").toUpperCase());
  const set = useCallback(
    (next: VariantKey) =>
      navigate({
        to: ".",
        search: ((prev: Record<string, unknown>) => ({ ...prev, variant: next })) as never,
        replace: true,
        resetScroll: false,
      }),
    [navigate],
  );
  return { variant: variant?.key ?? null, set };
}

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.matches("input, textarea, select, [contenteditable], [role=slider]") || el.isContentEditable);

export function PrototypeSwitcher({
  variant,
  set,
}: {
  variant: VariantKey;
  set: (next: VariantKey) => unknown;
}) {
  const at = VARIANTS.findIndex((v) => v.key === variant);
  const step = useCallback(
    (by: number) => set(VARIANTS[(at + by + VARIANTS.length) % VARIANTS.length]?.key ?? "A"),
    [at, set],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const arrow =
    "w-7 h-7 grid place-items-center rounded-full text-[#111] hover:bg-black/10 cursor-pointer text-[15px]";
  return (
    <div
      data-testid="prototype-switcher"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[400] flex items-center gap-3 px-2.5 py-1.5 rounded-full bg-[#f4f1e8] text-[#111] border-2 border-[#111] shadow-[0_6px_24px_rgba(0,0,0,0.5)] text-[11px] font-semibold"
    >
      <button
        type="button"
        className={arrow}
        aria-label="Previous variant"
        onClick={() => step(-1)}
      >
        &larr;
      </button>
      <span className="min-w-[150px] text-center">
        {variant} ({VARIANTS[at]?.name})
      </span>
      <button type="button" className={arrow} aria-label="Next variant" onClick={() => step(1)}>
        &rarr;
      </button>
    </div>
  );
}
