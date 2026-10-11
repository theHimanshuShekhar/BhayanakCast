/**
 * PROTOTYPE (#93), throwaway: `pnpm proto:quality` runs the Vite dev server (so
 * `import.meta.env.DEV` is true and the quality-modal prototype is present) on an in-memory
 * PGlite, with the test-only sign-in on. No Postgres or Discord needed. e2e/serve.ts does the
 * same for the production build, which cannot show the prototype.
 *
 * It seeds a live room and signs in nobody: sign in from the page console (printed below).
 */
export {};

process.env.NODE_ENV = "development";
process.env.E2E_AUTH = "1";
const port = Number(process.env.PORT ?? 3199);
process.env.PORT = String(port);
process.env.BETTER_AUTH_URL = `http://localhost:${port}`;
process.env.REALTIME_ANONYMOUS_SOCKETS_PER_IP = "1000";

const { provideDb } = await import("../src/db/client.ts");
const { createTestDb } = await import("../src/db/test-db.ts");
const { createServer } = await import("vite");

const { db } = await createTestDb();
provideDb(db);
const server = await createServer({
  server: { port, strictPort: true },
  // The OG-image renderer pulls in a native module the dependency optimizer cannot bundle.
  optimizeDeps: { exclude: ["@resvg/resvg-js"] },
});
await server.listen();

const origin = `http://localhost:${port}`;
const post = (path: string, body: object) =>
  fetch(`${origin}/api/auth/test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
const signIn = await post("/sign-in", { discordId: "800000000000000001", username: "kira" });
const { userId } = (await signIn.json()) as { userId: string };
const seeded = await post("/seed-room", {
  name: "quality prototype",
  hostUserId: userId,
  createdAt: new Date().toISOString(),
  presence: [{ userId, startedAt: new Date().toISOString() }],
});
const { roomId } = (await seeded.json()) as { roomId: string };

console.log(`
PROTOTYPE quality modal: ${origin}
1. Open ${origin}/ and, in the DevTools console, sign in (sets the session cookie):
   fetch('/api/auth/test/sign-in',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({discordId:'800000000000000002',username:'you'})}).then(()=>location.reload())
2. Open ${origin}/room/${roomId}?variant=A&scenario=2 , press "Enter room", hover the big tile, click "quality".
   Left/Right arrows switch variant, 1-4 switch scenario.
`);
