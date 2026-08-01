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
// Until those exist the command fails loudly with a clear reason, which is the
// point: the rules currently have NO automated coverage, and that gap should be
// visible rather than hidden behind a permanently-red test in the main suite.
export default defineConfig({
  test: {
    include: ['functions/test/**/*.test.mjs'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
})
