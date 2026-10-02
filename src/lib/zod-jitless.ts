/**
 * An inline script (src/routes/__root.tsx) that makes zod 4 skip its `new Function` probe in the
 * browser, which a CSP without `unsafe-eval` would report as a violation (ADR 9 addendum on
 * security headers). It sets the global zod reads its configuration from as its module loads, the
 * same value `z.config({ jitless: true })` stores; unlike calling that from our own bundle, it
 * can't run too late, since the chunk holding zod and the schemas evaluates before the entry's
 * own code.
 */
export const ZOD_JITLESS_SCRIPT = "globalThis.__zod_globalConfig={jitless:true};";
