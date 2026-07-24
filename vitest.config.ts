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
    // functions/test/* are Firestore-rules tests — they need the Firebase
    // emulator and functions/ deps, and run separately (see docs/security-hardening.md).
    // tests/e2e/* are Playwright specs (npm run test:e2e), not vitest.
    exclude: ['**/node_modules/**', 'functions/**', 'tests/e2e/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
