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
