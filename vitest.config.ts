import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    // Run test files sequentially. happy-dom's environment setup races under
    // parallel workers on vitest 4 (throws "Cannot read properties of undefined
    // (reading 'config')" at import time), failing all files. Sequential is
    // reliable and fast enough for this suite (~9s, 106 tests).
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
