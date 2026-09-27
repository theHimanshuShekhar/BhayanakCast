/**
 * Chat text → tokens for rendering: plain text, @mentions and http(s) links. The UI renders
 * tokens as React text and elements (never as HTML), so a message can't inject markup, and only
 * `http:`/`https:` URLs become links (no `javascript:` and friends).
 */

export type ChatToken =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; username: string }
  | { kind: "link"; text: string; href: string };

// A URL runs to the next whitespace or quote/angle bracket; a mention is `@` then username
// characters (Discord: letters, digits, `_`, `.`), not preceded by a word character (so
// `me@example.com` isn't one).
const PATTERN = /(https?:\/\/[^\s<>"'`]+)|(?<![\w.@])@([\w.]+)/giu;
// Punctuation at the end of a URL usually ends the sentence, not the URL.
const TRAILING_PUNCTUATION = /[.,!?;:'"*]+$/u;

/** Split `text` into text, mention and link tokens, in order. Adjacent text is merged. */
export function tokenizeChat(text: string): ChatToken[] {
  const tokens: ChatToken[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    const last = tokens.at(-1);
    if (last?.kind === "text") last.text += t;
    else tokens.push({ kind: "text", text: t });
  };

  let index = 0;
  for (const match of text.matchAll(PATTERN)) {
    const start = match.index;
    pushText(text.slice(index, start));
    let raw = match[0];
    if (match[1]) {
      raw = trimUrl(raw);
      const href = safeHref(raw);
      if (href) tokens.push({ kind: "link", text: raw, href });
      else pushText(raw);
    } else {
      // Usernames don't end with a dot; a trailing one ends the sentence.
      raw = raw.replace(/\.+$/u, "");
      if (raw.length > 1) tokens.push({ kind: "mention", text: raw, username: raw.slice(1) });
      else pushText(raw);
    }
    index = start + raw.length;
  }
  pushText(text.slice(index));
  return tokens;
}

/** Drop trailing punctuation, and a closing parenthesis the URL didn't open. */
function trimUrl(url: string): string {
  let out = url;
  for (;;) {
    const before = out;
    out = out.replace(TRAILING_PUNCTUATION, "");
    if (out.endsWith(")") && count(out, "(") < count(out, ")")) out = out.slice(0, -1);
    if (out === before) return out;
  }
}

const count = (s: string, ch: string) => s.split(ch).length - 1;

function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
