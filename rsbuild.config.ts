import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/rsbuild'

export default defineConfig({
  plugins: [pluginReact(), tanstackStart()],
  resolve: {
    alias: {
      '~': './src',
    },
  },
  environments: {
    // The server migrates its schema at startup and reads the migration files
    // from beside its own bundle, so they ship with the server build — and
    // only with it, never into the client output.
    ssr: {
      output: {
        copy: [{ from: './src/server/db/migrations', to: 'migrations' }],
      },
    },
  },
  tools: {
    rspack: {
      // ponytail: optional native dependencies are intentionally not installed.
      ignoreWarnings: [
        /Can't resolve '(supports-color|pg-native|bufferutil|utf-8-validate)'/,
      ],
    },
  },
  server: {
    middlewareMode: true,
    port: 3000,
  },
})
