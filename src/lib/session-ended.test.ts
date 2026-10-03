import { describe, expect, it, vi } from "vitest";
import { type ServerMessage, SIGN_IN_FIRST } from "./realtime";
import { followSessionEnded } from "./session-ended";

const ENDED: ServerMessage = {
  type: "error",
  code: "session_ended",
  message: "You were signed out",
};

/** The wiring with fakes: the current path, which rooms this tab entered, and the calls made. */
function setup(path: string, entered: string[] = []) {
  let listener: (message: ServerMessage) => void = () => {};
  let navigated: () => void = () => {};
  const state = { path };
  const deps = {
    client: {
      subscribe: (fn: (message: ServerMessage) => void) => {
        listener = fn;
        return () => {};
      },
      restart: vi.fn(),
    },
    pathname: () => state.path,
    inRoom: (roomId: string) => entered.includes(roomId),
    onNavigated: (fn: () => void) => {
      navigated = fn;
      return () => {};
    },
    dropCachedReads: vi.fn(),
    reloadSession: vi.fn(),
  };
  followSessionEnded(deps);
  return {
    deps,
    ended: () => listener(ENDED),
    send: (message: ServerMessage) => listener(message),
    navigateTo(path: string) {
      state.path = path;
      navigated();
    },
  };
}

describe("followSessionEnded", () => {
  it("reloads the session and drops cached reads at once on a page that isn't a room", () => {
    const t = setup("/");
    t.ended();
    expect(t.deps.reloadSession).toHaveBeenCalledOnce();
    expect(t.deps.dropCachedReads).toHaveBeenCalledOnce();
  });

  it("reloads at once in a room's pre-join lobby, where the guard sends a visitor to sign in", () => {
    const t = setup("/room/r1", []);
    t.ended();
    expect(t.deps.reloadSession).toHaveBeenCalledOnce();
  });

  it("leaves a room the tab entered alone: its notice stays", () => {
    const t = setup("/room/r1", ["r1"]);
    t.ended();
    expect(t.deps.reloadSession).not.toHaveBeenCalled();
    expect(t.deps.dropCachedReads).not.toHaveBeenCalled();
    expect(t.deps.client.restart).not.toHaveBeenCalled();
  });

  it("once off the room, drops cached reads and restarts the socket to carry the cookie it has now", () => {
    const t = setup("/room/r1", ["r1"]);
    t.ended();
    t.navigateTo("/room/r1");
    expect(t.deps.client.restart).not.toHaveBeenCalled();

    t.navigateTo("/");
    expect(t.deps.dropCachedReads).toHaveBeenCalledOnce();
    expect(t.deps.client.restart).toHaveBeenCalledOnce();

    // Only once.
    t.navigateTo("/past/x");
    expect(t.deps.client.restart).toHaveBeenCalledOnce();
  });

  it("restarts when the tab goes to another room's page, not only home", () => {
    const t = setup("/room/r1", ["r1"]);
    t.ended();
    t.navigateTo("/room/r2");
    expect(t.deps.dropCachedReads).toHaveBeenCalledOnce();
    expect(t.deps.client.restart).toHaveBeenCalledOnce();
  });

  it("is armed by an anonymous room.join refusal too, which a page that missed session_ended gets", () => {
    const t = setup("/room/r1", ["r1"]);
    t.send({ type: "error", code: "forbidden", message: SIGN_IN_FIRST, re: "room.join" });
    expect(t.deps.reloadSession).not.toHaveBeenCalled();
    t.navigateTo("/");
    expect(t.deps.dropCachedReads).toHaveBeenCalledOnce();
    expect(t.deps.client.restart).toHaveBeenCalledOnce();
  });

  it("ignores other messages, and navigation with no session ended", () => {
    const t = setup("/room/r1", ["r1"]);
    t.send({ type: "lobby.snapshot", online: 3 });
    // Refused for other reasons: a kick, a private room, a different message type.
    t.send({ type: "error", code: "kicked", message: "removed", re: "room.join" });
    t.send({ type: "error", code: "forbidden", message: "This room is private", re: "room.join" });
    t.send({ type: "error", code: "forbidden", message: SIGN_IN_FIRST, re: "chat.send" });
    t.navigateTo("/");
    expect(t.deps.reloadSession).not.toHaveBeenCalled();
    expect(t.deps.dropCachedReads).not.toHaveBeenCalled();
    expect(t.deps.client.restart).not.toHaveBeenCalled();
  });
});
