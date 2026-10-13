/**
 * Problem report server function (ADR 4 addendum on problem reports): a thin `createServerFn`
 * wrapper over src/server/problem-report.ts, for signed-in callers only (see
 * ./connection-events.functions.ts for the pattern). The answer says whether it was taken
 * (`sent`), or why not (`too_soon`, `not_in_room`), because the form words each differently.
 */
import { createServerFn } from "@tanstack/react-start";
import { getProblemReportService } from "~/server/problem-report";
import { getCaller } from "~/server/request-caller";
import { reportProblemInput } from "./problem-report";

/** Record the caller's report of a problem in the room they are in. */
export const reportProblemFn = createServerFn({ method: "POST" })
  .validator(reportProblemInput)
  .handler(async ({ data }) => getProblemReportService().report(await getCaller(), data));
