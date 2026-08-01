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
    // functions/test/* are Firestore-RULES tests: they need the Firebase
    // emulator (and therefore a JRE) plus @firebase/rules-unit-testing, so they
    // run via `npm run test:rules`, not here. Without this exclusion vitest
    // picks the file up, fails to resolve its import, and every run ends "1
    // failed" — a permanently red suite that everyone learns to look past,
    // which is worse than no suite. tests/e2e/* are Playwright (npm run test:e2e).
    exclude: ['**/node_modules/**', 'functions/**', 'tests/e2e/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
