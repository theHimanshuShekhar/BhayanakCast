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
  server: {
    middlewareMode: true,
    port: 3000,
  },
})
