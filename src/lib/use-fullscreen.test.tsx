import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toggleFullscreen, useFullscreenElement, useFullscreenSupported } from "./use-fullscreen";

// The fullscreen toggle (#85). There is no DOM here: `document` is a stub, and the hooks are
// rendered to HTML (their server snapshots). The real thing, with the browser's own fullscreen,
// is in e2e/fullscreen.spec.ts.

afterEach(() => vi.unstubAllGlobals());

const stubDocument = (fullscreenElement: unknown) => {
  const exitFullscreen = vi.fn(() => Promise.resolve());
  vi.stubGlobal("document", { fullscreenElement, exitFullscreen });
  return exitFullscreen;
};
const element = () => ({ requestFullscreen: vi.fn(() => Promise.resolve()) }) as never;

describe("toggleFullscreen", () => {
  it("enters fullscreen on an element that is not the fullscreen one", () => {
    const exitFullscreen = stubDocument(null);
    const el = element() as { requestFullscreen: ReturnType<typeof vi.fn> };
    toggleFullscreen(el as never);
    expect(el.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it("switches to the element when another one is fullscreen", () => {
    const exitFullscreen = stubDocument({});
    const el = element() as { requestFullscreen: ReturnType<typeof vi.fn> };
    toggleFullscreen(el as never);
    expect(el.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it("exits fullscreen when the element is the fullscreen one", () => {
    const el = element() as { requestFullscreen: ReturnType<typeof vi.fn> };
    const exitFullscreen = stubDocument(el);
    toggleFullscreen(el as never);
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(el.requestFullscreen).not.toHaveBeenCalled();
  });

  it("swallows a refused request", async () => {
    stubDocument(null);
    const rejected = Promise.reject(new Error("not allowed"));
    const el = { requestFullscreen: () => rejected } as never;
    expect(() => toggleFullscreen(el)).not.toThrow();
    await rejected.catch(() => {});
  });
});

describe("the hooks on the server", () => {
  it("see no fullscreen element, and assume fullscreen is supported", () => {
    const Probe = () => (
      <p>
        {String(useFullscreenElement())} {String(useFullscreenSupported())}
      </p>
    );
    expect(renderToStaticMarkup(<Probe />)).toBe("<p>null true</p>");
  });
});
