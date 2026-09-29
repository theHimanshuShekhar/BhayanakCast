import { describe, expect, it } from "vitest";
import { discordAvatarUrl } from "./format";

describe("discordAvatarUrl", () => {
  const avatar = "https://cdn.discordapp.com/avatars/1234/abcd.png";

  it("asks Discord's CDN for the size wanted", () => {
    expect(discordAvatarUrl(avatar, 64)).toBe(`${avatar}?size=64`);
    expect(discordAvatarUrl("https://cdn.discordapp.com/embed/avatars/3.png", 256)).toBe(
      "https://cdn.discordapp.com/embed/avatars/3.png?size=256",
    );
  });

  it("replaces a size already asked for, and keeps other parameters", () => {
    expect(discordAvatarUrl(`${avatar}?size=1024`, 128)).toBe(`${avatar}?size=128`);
    expect(discordAvatarUrl(`${avatar}?a=1&size=1024#top`, 64)).toBe(`${avatar}?a=1&size=64`);
  });

  it("has nothing to load without a picture", () => {
    expect(discordAvatarUrl(null, 64)).toBeNull();
    expect(discordAvatarUrl(undefined, 64)).toBeNull();
    expect(discordAvatarUrl("", 64)).toBeNull();
    expect(discordAvatarUrl("not a url", 64)).toBeNull();
  });

  it("refuses anything but https on Discord's CDN", () => {
    for (const image of [
      "https://evil.example/avatar.png",
      "http://cdn.discordapp.com/avatars/1234/abcd.png",
      "//cdn.discordapp.com/avatars/1234/abcd.png",
      "https://cdn.discordapp.com.evil.example/avatars/1234/abcd.png",
      "https://evil.example/cdn.discordapp.com/avatars/1234/abcd.png",
      "https://evil.example?u=https://cdn.discordapp.com/avatars/1234/abcd.png",
      "https://cdn.discordapp.com@evil.example/avatars/1234/abcd.png",
      "https://discordapp.com/avatars/1234/abcd.png",
      "https://media.discordapp.net/avatars/1234/abcd.png",
      "https://cdn.discordapp.com:8443/avatars/1234/abcd.png",
      "https://user:pass@cdn.discordapp.com/avatars/1234/abcd.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
    ]) {
      expect(discordAvatarUrl(image, 64), image).toBeNull();
    }
  });
});
