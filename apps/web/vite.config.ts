import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const resolvePackage = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The shared packages are consumed as TypeScript source rather than a
      // build artifact. One less build step, and a change in core is picked up
      // by HMR immediately.
      '@antigravity/core': resolvePackage('../../packages/core/src/index.ts'),
      '@antigravity/canvas-engine': resolvePackage('../../packages/canvas-engine/src/index.ts'),
      '@antigravity/supabase-client': resolvePackage('../../packages/supabase-client/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2022',
  },
})
