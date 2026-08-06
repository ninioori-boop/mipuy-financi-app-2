import { defineConfig } from 'vitest/config'

// Firestore SECURITY-RULES tests only (functions/test/*). Separate from the main
// vitest config, which deliberately excludes them: they need the Firebase
// emulator — and therefore a JRE — plus @firebase/rules-unit-testing, neither of
// which is present in every dev environment.
//
//   npm run test:rules
//
// Prerequisites (one-time):
//   1. Java (JRE) — the Firestore emulator is a Java process
//   2. npm i -D @firebase/rules-unit-testing
//   3. `emulators.firestore` in firebase.json
//
// All three exist since 2026-08-06 in CI (the `rules` job — ubuntu runners
// ship Java). Locally this still needs a JRE; without one the command fails
// loudly, and CI remains the place these actually run.
export default defineConfig({
  test: {
    include: ['functions/test/**/*.test.mjs'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
})
