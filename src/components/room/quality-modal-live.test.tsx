// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QualityView } from "~/lib/mesh";
import { QualityModal, REFRESH_MS } from "./quality-modal";

// The open modal (#104) in a DOM: how it refreshes, and what its footer says.

const view: QualityView = {
  side: "viewer",
  userId: "kira",
  state: "connected",
  points: [],
  changes: [],
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const open = (refresh: () => Promise<void>, read = () => view) =>
  render(
    <QualityModal
      userId="kira"
      meId="me"
      names={{ kira: "kira" }}
      read={read}
      refresh={refresh}
      onClose={() => {}}
    />,
  );

describe("QualityModal refresh", () => {
  it("reads the pair again a second after the last read finished, never two at once", async () => {
    let running = 0;
    let most = 0;
    let started = 0;
    const releases: (() => void)[] = [];
    const refresh = () => {
      started++;
      running++;
      most = Math.max(most, running);
      return new Promise<void>((resolve) => {
        releases.push(() => {
          running--;
          resolve();
        });
      });
    };
    open(refresh);
    // Slow: five seconds pass and the one read that began is still out. No second one starts.
    await act(() => vi.advanceTimersByTimeAsync(REFRESH_MS));
    expect(started).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(5 * REFRESH_MS));
    expect(started).toBe(1);
    expect(most).toBe(1);
    // It finishes: the next starts a second later, not at once.
    await act(async () => releases.shift()?.());
    expect(started).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(REFRESH_MS));
    expect(started).toBe(2);
    expect(most).toBe(1);
  });

  it("keeps going after a read that failed", async () => {
    let started = 0;
    open(async () => {
      started++;
      throw new Error("getStats failed");
    });
    await act(() => vi.advanceTimersByTimeAsync(3 * REFRESH_MS + 100));
    expect(started).toBeGreaterThanOrEqual(3);
  });

  it("stops reading when it closes", async () => {
    let started = 0;
    const { unmount } = open(async () => {
      started++;
    });
    await act(() => vi.advanceTimersByTimeAsync(REFRESH_MS + 10));
    const before = started;
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(5 * REFRESH_MS));
    expect(started).toBe(before);
  });
});

describe("QualityModal footer", () => {
  it("says it is read-only and updating every second, and doesn't call anything live", async () => {
    open(async () => {});
    // Not `findBy…`: it polls on timers, which are faked here.
    await act(async () => {});
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/read-only/i);
    expect(dialog.textContent).toMatch(/updating every second/i);
    expect(dialog.textContent).not.toMatch(/\blive\b/i);
    // No green on the dot: green means healthy.
    expect(dialog.querySelector(".text-success-ink")).toBeNull();
  });
});
