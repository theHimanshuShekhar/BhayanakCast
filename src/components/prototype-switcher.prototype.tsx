// PROTOTYPE (ticket #93): the floating variant/scenario switcher. Throwaway; dev builds only.
// URL params: ?variant=A|B|C and ?scenario=1..4. Arrow keys cycle the variant, 1-4 the scenario.
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

export const VARIANTS = [
  { key: "A", name: "Verdict first" },
  { key: "B", name: "Pipeline" },
  { key: "C", name: "Live history" },
] as const;
export type VariantKey = (typeof VARIANTS)[number]["key"];

const SCENARIOS = [1, 2, 3, 4] as const;
export type ScenarioKey = (typeof SCENARIOS)[number];

/** The prototype's URL state; `variant` is null (prototype off) without a valid `?variant=`. */
export function usePrototypeParams() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();
  const variant = VARIANTS.find((v) => v.key === String(search.variant ?? "").toUpperCase());
  const asked = Number(search.scenario);
  const scenario = (SCENARIOS.find((s) => s === asked) ?? 1) as ScenarioKey;
  const set = useCallback(
    (next: { variant?: VariantKey; scenario?: ScenarioKey }) =>
      navigate({
        to: ".",
        search: ((prev: Record<string, unknown>) => ({ ...prev, ...next })) as never,
        replace: true,
      }),
    [navigate],
  );
  return { variant: variant?.key ?? null, scenario, set };
}

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.matches("input, textarea, select, [contenteditable], [role=slider]") || el.isContentEditable);

export function PrototypeSwitcher({
  variant,
  scenario,
  scenarioNames,
  set,
}: {
  variant: VariantKey;
  scenario: ScenarioKey;
  scenarioNames: Record<ScenarioKey, string>;
  set: (next: { variant?: VariantKey; scenario?: ScenarioKey }) => unknown;
}) {
  const at = VARIANTS.findIndex((v) => v.key === variant);
  const step = useCallback(
    (by: number) =>
      set({ variant: VARIANTS[(at + by + VARIANTS.length) % VARIANTS.length]?.key ?? "A" }),
    [at, set],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (["1", "2", "3", "4"].includes(e.key))
        set({ scenario: Number(e.key) as ScenarioKey });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, set]);

  const arrow =
    "w-7 h-7 grid place-items-center rounded-full text-[#111] hover:bg-black/10 cursor-pointer text-[15px]";
  return (
    <div
      data-testid="prototype-switcher"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[400] flex items-center gap-3 px-2.5 py-1.5 rounded-full bg-[#f4f1e8] text-[#111] border-2 border-[#111] shadow-[0_6px_24px_rgba(0,0,0,0.5)] text-[11px] font-semibold max-sm:flex-col max-sm:rounded-2xl"
    >
      <span className="flex items-center gap-1.5">
        <button
          type="button"
          className={arrow}
          aria-label="Previous variant"
          onClick={() => step(-1)}
        >
          &larr;
        </button>
        <span className="min-w-[128px] text-center">
          {variant} ({VARIANTS[at]?.name})
        </span>
        <button type="button" className={arrow} aria-label="Next variant" onClick={() => step(1)}>
          &rarr;
        </button>
      </span>
      <span className="h-5 w-px bg-black/30 max-sm:hidden" />
      <span className="flex items-center gap-1">
        <span className="opacity-60 uppercase tracking-[0.1em] text-[9.5px]">scenario</span>
        {SCENARIOS.map((s) => (
          <button
            key={s}
            type="button"
            title={scenarioNames[s]}
            aria-pressed={s === scenario}
            onClick={() => set({ scenario: s })}
            className={`w-6 h-6 rounded-full cursor-pointer ${s === scenario ? "bg-[#111] text-[#f4f1e8]" : "hover:bg-black/10"}`}
          >
            {s}
          </button>
        ))}
        <span className="ml-1 opacity-70 font-medium max-sm:hidden">{scenarioNames[scenario]}</span>
      </span>
    </div>
  );
}
