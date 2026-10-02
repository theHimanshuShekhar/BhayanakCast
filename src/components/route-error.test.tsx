import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isRateLimited, RouteErrorView, RoutePending } from "./route-error";

// What a failed route shows (#77), rendered to HTML. That a real loader failure reaches it, and
// that Retry loads the page again, is in e2e/route-errors.spec.ts.

const render = (props: { rateLimited?: boolean; detail?: string }) =>
  renderToStaticMarkup(
    <RouteErrorView
      rateLimited={props.rateLimited ?? false}
      detail={props.detail}
      onRetry={() => {}}
    />,
  );

describe("RouteErrorView", () => {
  it("offers Retry and a way home for a failure, as an alert", () => {
    const html = render({});
    expect(html).toContain('role="alert"');
    expect(html).toContain("Something went wrong");
    expect(html).toContain(">Retry</button>");
    expect(html).toContain('href="/"');
  });

  it("tells a rate-limited visitor to wait, with Retry", () => {
    const html = render({ rateLimited: true });
    expect(html).toContain("Too many requests. Wait a moment and try again.");
    expect(html).not.toContain("Something went wrong");
    expect(html).toContain(">Retry</button>");
  });

  it("shows the technical detail only when given one", () => {
    expect(render({})).not.toContain("font-mono");
    expect(render({ detail: "boom: db down" })).toContain("boom: db down");
  });
});

describe("isRateLimited", () => {
  it("recognises the rate-limit error by message, name and status", () => {
    expect(isRateLimited(new Error("Too many requests. Wait a moment and try again."))).toBe(true);
    expect(isRateLimited(Object.assign(new Error("x"), { name: "ReadRateLimitedError" }))).toBe(
      true,
    );
    expect(isRateLimited({ status: 429 })).toBe(true);
  });

  it("leaves other failures alone", () => {
    expect(isRateLimited(new Error("connection refused"))).toBe(false);
    expect(isRateLimited({ status: 500 })).toBe(false);
    expect(isRateLimited(null)).toBe(false);
    expect(isRateLimited("Too many requests")).toBe(false);
  });
});

describe("RoutePending", () => {
  it("is a quiet status line", () => {
    const html = renderToStaticMarkup(<RoutePending />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading");
  });
});
