/**
 * Where the production server leaves a request's CSP nonce (`request.context`, ADR 9 addendum
 * on security headers) for the router to put on the inline scripts it renders (src/router.tsx).
 */
export const CSP_NONCE_KEY = "cspNonce";
