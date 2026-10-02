import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ZOD_JITLESS_SCRIPT } from "./zod-jitless.ts";

// A fresh process per case: zod reads its configuration as its module loads, and vitest keeps
// installed packages loaded across tests. It counts the `new Function` calls zod makes, each of
// which a CSP without `unsafe-eval` reports as a violation.
function functionCallsLoadingZod(before: string): number {
  const program = `
    ${before}
    const Native = globalThis.Function;
    let calls = 0;
    globalThis.Function = new Proxy(Native, {
      construct(target, args, newTarget) { calls++; return Reflect.construct(target, args, newTarget); },
    });
    const { z } = await import("zod");
    const schema = z.object({ name: z.string(), size: z.int() });
    const ok = JSON.stringify(schema.parse({ name: "room", size: 3 })) === '{"name":"room","size":3}';
    console.log(JSON.stringify({ calls, ok, rejects: !schema.safeParse({ name: 1 }).success }));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", program], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const result = JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as {
    calls: number;
    ok: boolean;
    rejects: boolean;
  };
  expect(result.ok).toBe(true);
  expect(result.rejects).toBe(true);
  return result.calls;
}

describe("the zod jitless script", () => {
  it("lets zod parse without evaluating any code", () => {
    expect(functionCallsLoadingZod(ZOD_JITLESS_SCRIPT)).toBe(0);
  });

  it("is what prevents it: without the script zod does evaluate code", () => {
    expect(functionCallsLoadingZod("")).toBeGreaterThan(0);
  });
});
