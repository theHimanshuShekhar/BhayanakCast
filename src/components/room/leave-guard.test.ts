import { describe, expect, it } from "vitest";
import { markLeavingForBan } from "~/lib/ban";
import { leavesPage } from "./leave-guard";

// Which navigations the room page's leave guard asks about (#86).

const at = (pathname: string) => ({ pathname });

describe("leavesPage", () => {
  it("asks when the navigation goes to another page", () => {
    expect(leavesPage({ current: at("/room/a"), next: at("/") })).toBe(true);
    expect(leavesPage({ current: at("/room/a"), next: at("/room/b") })).toBe(true);
    expect(leavesPage({ current: at("/room/a"), next: at("/profile/u1") })).toBe(true);
  });

  it("doesn't ask about a navigation to the same page (a link to this room, new search params)", () => {
    expect(leavesPage({ current: at("/room/a"), next: at("/room/a") })).toBe(false);
  });

  it("doesn't ask once the user is being banned", () => {
    markLeavingForBan();
    expect(leavesPage({ current: at("/room/a"), next: at("/") })).toBe(false);
  });
});
