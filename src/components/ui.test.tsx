import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoomPerson } from "~/lib/rooms";
import { Avatar, AvatarStack } from "./ui";

// What an avatar shows of someone (#56), rendered to HTML: a Discord CDN picture, else the
// gradient initials. What the browser does with the picture (a failed load falling back,
// lazy loading, the separator ring above a picture) is in e2e/avatars.spec.ts.

const image = "https://cdn.discordapp.com/avatars/1234/abcd.png";

/** The `src` of each `<img>` in `html`. */
const sources = (html: string) => [...html.matchAll(/<img[^>]* src="([^"]*)"/g)].map((m) => m[1]);

describe("Avatar", () => {
  it("shows the Discord picture, sized for the avatar, in place of the initials", () => {
    const html = renderToStaticMarkup(<Avatar name="kodama_jpg" image={image} size="lg" />);
    expect(sources(html)).toEqual([`${image}?size=128`]);
    expect(html).not.toContain("KO");
  });

  it("asks for a bigger picture the bigger the avatar", () => {
    const size = (s: "sm" | "md" | "lg" | "xl") =>
      sources(renderToStaticMarkup(<Avatar name="kodama_jpg" image={image} size={s} />));
    expect([size("sm"), size("md"), size("lg"), size("xl")]).toEqual([
      [`${image}?size=64`],
      [`${image}?size=64`],
      [`${image}?size=128`],
      [`${image}?size=256`],
    ]);
  });

  it("shows initials without a picture", () => {
    const html = renderToStaticMarkup(<Avatar name="kodama_jpg" image={null} />);
    expect(html).toContain("KO");
    expect(sources(html)).toEqual([]);
  });

  it("shows initials for a picture that isn't on Discord's CDN", () => {
    for (const other of ["https://evil.example/pixel.png", "http://cdn.discordapp.com/a.png"]) {
      const html = renderToStaticMarkup(<Avatar name="kodama_jpg" image={other} />);
      expect(html).toContain("KO");
      expect(sources(html)).toEqual([]);
    }
  });
});

describe("AvatarStack", () => {
  const person = (username: string, picture: string | null): RoomPerson => ({
    id: `u-${username}`,
    username,
    image: picture,
  });

  it("shows each person's picture or initials, and how many more", () => {
    const html = renderToStaticMarkup(
      <AvatarStack
        people={[person("ana", image), person("bo", null), person("cy", null)]}
        max={2}
      />,
    );
    expect(sources(html)).toEqual([`${image}?size=64`]);
    expect(html).toContain("BO");
    expect(html).not.toContain("CY");
    expect(html).toContain("+1");
  });
});
