import type { Server } from "node:http";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * `pnpm dev` serves the realtime WebSocket too: once Vite's HTTP server listens, attach the
 * same endpoint server.prod.ts attaches in production (src/server/realtime.ts), loaded through
 * Vite's SSR module graph. It only takes upgrades on its own path, so Vite's HMR socket is
 * untouched. Editing the realtime server needs a dev-server restart (live rooms are in memory).
 */
function realtimeDevServer(): Plugin {
  return {
    name: "bhayanakcast:realtime-dev",
    apply: "serve",
    configureServer(server) {
      const httpServer = server.httpServer as Server | null;
      httpServer?.once("listening", async () => {
        try {
          const realtime = await server.ssrLoadModule("/src/server/realtime.ts");
          realtime.attachRealtime(httpServer);
        } catch (error) {
          server.config.logger.error(`[realtime] not attached: ${String(error)}`);
        }
      });
    },
  };
}

export default defineConfig({
  server: {
    port: 3000,
  },
  build: {
    // Vite inlines assets under 4 KB as data: URLs, and the smallest JetBrains Mono subset
    // becomes one in the CSS. Keep fonts as files, so the CSP's `font-src 'self'` needs no `data:`.
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    // React's Vite plugin must come after Start's.
    viteReact(),
    realtimeDevServer(),
  ],
});
