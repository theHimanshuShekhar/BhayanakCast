import { useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
};
const never = () => () => {};

/** The element that is fullscreen, live (Escape and the browser's own exit included), else null. */
export const useFullscreenElement = (): Element | null =>
  useSyncExternalStore(
    subscribe,
    () => document.fullscreenElement,
    () => null,
  );

/**
 * Whether the browser can fullscreen an element at all: not iPhone Safari, which only does it for
 * video. True during SSR, so the button is there until the client knows better.
 */
export const useFullscreenSupported = (): boolean =>
  useSyncExternalStore(
    never,
    () => document.fullscreenEnabled === true,
    () => true,
  );

/** Exits fullscreen if `element` is the fullscreen one; else enters it (switching from any other). */
export const toggleFullscreen = (element: Element) => {
  const result =
    document.fullscreenElement === element
      ? document.exitFullscreen()
      : element.requestFullscreen();
  // A refused request (no user gesture, blocked by policy) leaves things as they were.
  result.catch(() => {});
};
