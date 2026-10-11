/**
 * Quality telemetry server function (ADR 2 addendum): a thin `createServerFn` wrapper over
 * src/server/quality.ts, for signed-in callers only (see ./ice.functions.ts for the pattern).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getQualityService } from "~/server/quality";
import { getCaller } from "~/server/request-caller";
import { reportQualityInput } from "./quality-telemetry";

/** Store the caller's quality rows about the peers in the live room they are in. */
export const reportQualityFn = createServerFn({ method: "POST" })
  .validator(reportQualityInput)
  .handler(async ({ data }) =>
    getQualityService().record(
      await getCaller(),
      data,
      new Headers(getRequestHeaders()).get("user-agent") ?? "",
    ),
  );
