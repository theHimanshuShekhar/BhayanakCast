import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "@tanstack/react-start/config";
import tsConfigPaths from "vite-tsconfig-paths";

export default await defineConfig({
  vite: {
    plugins: [
      tsConfigPaths({
        projects: ["./tsconfig.json"],
      }),
      tailwindcss(),
    ],
  },

  // https://react.dev/learn/react-compiler
  react: {
    babel: {
      plugins: [
        [
          "babel-plugin-react-compiler",
          {
            target: "19",
          },
        ],
      ],
    },
  },

  tsr: {
    // https://github.com/TanStack/router/discussions/2863#discussioncomment-12458714
    appDirectory: "./src",
  },

  server: {
    // https://tanstack.com/start/latest/docs/framework/react/hosting#deployment
    preset: "bun",
    experimental: {
      websocket: true,
    },
  },
}).then((config) =>
  config.addRouter({
    name: "websocket",
    type: "http",
    handler: "./src/ws.ts",
    target: "server",
    base: "/_ws",
  }),
);
