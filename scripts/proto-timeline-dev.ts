/**
 * PROTOTYPE (#114), throwaway: `pnpm proto:timeline` runs the Vite dev server (so
 * `import.meta.env.DEV` is true and the room-timeline prototype is present) on an in-memory
 * PGlite, with the test-only sign-in on and one env admin. No Postgres or Discord needed.
 *
 * Open http://localhost:3199/proto-login : it signs you in as that admin (a cookie) and sends you
 * to /admin?variant=A. The timeline data is fake and in the browser; the DB only backs the rest of
 * the dashboard.
 */
export {};

const ADMIN_DISCORD_ID = "900000000000000999";
process.env.NODE_ENV = "development";
process.env.E2E_AUTH = "1";
process.env.ADMIN_DISCORD_IDS = ADMIN_DISCORD_ID;
const port = Number(process.env.PORT ?? 3199);
process.env.PORT = String(port);
process.env.BETTER_AUTH_URL = `http://localhost:${port}`;
process.env.REALTIME_ANONYMOUS_SOCKETS_PER_IP = "1000";

const { provideDb } = await import("../src/db/client.ts");
const { createTestDb } = await import("../src/db/test-db.ts");
const { createServer } = await import("vite");

const { db } = await createTestDb();
provideDb(db);
const origin = `http://localhost:${port}`;
const server = await createServer({
  server: { port, strictPort: true },
  // The OG-image renderer pulls in a native module the dependency optimizer cannot bundle.
  optimizeDeps: { exclude: ["@resvg/resvg-js"] },
  plugins: [
    {
      name: "proto-timeline-login",
      configureServer(s) {
        s.middlewares.use("/proto-login", async (req, res) => {
          const signIn = await fetch(`${origin}/api/auth/test/sign-in`, {
            method: "POST",
            headers: { "content-type": "application/json", origin },
            body: JSON.stringify({ discordId: ADMIN_DISCORD_ID, username: "admin_jpg" }),
          });
          const next = new URL(req.url ?? "/", origin).searchParams.get("to") ?? "/admin?variant=A";
          res.statusCode = 302;
          res.setHeader("set-cookie", signIn.headers.getSetCookie());
          res.setHeader("location", next);
          res.end();
        });
      },
    },
  ],
});
await server.listen();

console.log(`
PROTOTYPE room timeline: sign in as the admin at ${origin}/proto-login
then ${origin}/admin?variant=A  (B, C: or use the bar / the left and right arrow keys)
`);
