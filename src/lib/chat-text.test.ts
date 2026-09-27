import { describe, expect, it } from "vitest";
import { tokenizeChat } from "./chat-text";

describe("tokenizeChat", () => {
  it("finds mentions and links among text", () => {
    expect(tokenizeChat("hey @ana.b, see https://example.com/a?b=1#c ok")).toEqual([
      { kind: "text", text: "hey " },
      { kind: "mention", text: "@ana.b", username: "ana.b" },
      { kind: "text", text: ", see " },
      { kind: "link", text: "https://example.com/a?b=1#c", href: "https://example.com/a?b=1#c" },
      { kind: "text", text: " ok" },
    ]);
  });

  it("leaves sentence punctuation out of links and mentions", () => {
    expect(tokenizeChat("go to http://a.io/x. thanks @bo.")).toEqual([
      { kind: "text", text: "go to " },
      { kind: "link", text: "http://a.io/x", href: "http://a.io/x" },
      { kind: "text", text: ". thanks " },
      { kind: "mention", text: "@bo", username: "bo" },
      { kind: "text", text: "." },
    ]);
    expect(tokenizeChat("(see https://en.wikipedia.org/wiki/Foo_(bar))")).toEqual([
      { kind: "text", text: "(see " },
      {
        kind: "link",
        text: "https://en.wikipedia.org/wiki/Foo_(bar)",
        href: "https://en.wikipedia.org/wiki/Foo_(bar)",
      },
      { kind: "text", text: ")" },
    ]);
  });

  it("links only http and https, and keeps markup as plain text", () => {
    const text = `javascript:alert(1) <img src=x onerror=alert(1)> <a href="https://x.io">x</a>`;
    const tokens = tokenizeChat(text);
    expect(tokens.map((t) => t.text).join("")).toBe(text);
    expect(tokens.filter((t) => t.kind === "link")).toEqual([
      { kind: "link", text: "https://x.io", href: "https://x.io/" },
    ]);
    expect(tokenizeChat("ftp://files.example.com data:text/html,hi")).toEqual([
      { kind: "text", text: "ftp://files.example.com data:text/html,hi" },
    ]);
  });

  it("doesn't mistake emails or a lone @ for mentions", () => {
    expect(tokenizeChat("mail me@example.com or @ me")).toEqual([
      { kind: "text", text: "mail me@example.com or @ me" },
    ]);
  });
});
