/**
 * A test-only CPU limit for specs about the codec switch (ADR 2 addendum). It is an init script of
 * the test's own browser context (`cpuLimitedEncoder`) and a flag the test sets on a page
 * (`setCpuLimit`): nothing in the app reads such a switch, so it can't be triggered in production.
 */
import type { BrowserContext, Page } from "@playwright/test";

/**
 * In every page of `context`, while `window.__cpuLimited` is set, the stats of a video sender on
 * AV1 or VP9 report `qualityLimitationReason: "cpu"`, as a software encoder that can't keep up
 * does (an H.264 sender reads what it really has). It patches the page's `RTCRtpSender.getStats`.
 */
export async function cpuLimitedEncoder(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { __cpuLimited?: boolean };
    const getStats = RTCRtpSender.prototype.getStats;
    RTCRtpSender.prototype.getStats = async function () {
      const report = await getStats.call(this);
      if (!w.__cpuLimited) return report;
      const limited = new Map<string, Record<string, unknown>>();
      report.forEach((stat: Record<string, unknown>, id: string) => {
        limited.set(id, stat);
      });
      for (const [id, stat] of limited) {
        if (stat.type !== "outbound-rtp" || stat.kind !== "video") continue;
        const mime = String(
          (report.get(stat.codecId as string) as { mimeType?: string })?.mimeType,
        );
        if (/^video\/(av1|vp9)$/i.test(mime)) {
          limited.set(id, { ...stat, qualityLimitationReason: "cpu" });
        }
      }
      return limited as unknown as RTCStatsReport;
    };
  });
}

/** Turn the CPU limit `cpuLimitedEncoder` fakes on or off in `page`. */
export const setCpuLimit = (page: Page, on: boolean) =>
  page.evaluate((limited) => {
    (window as unknown as { __cpuLimited: boolean }).__cpuLimited = limited;
  }, on);
