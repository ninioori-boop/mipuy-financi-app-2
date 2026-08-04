import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

/**
 * Drift guard for the hand-maintained reset lists.
 *
 * bankStore and autoMapStore leaked one person's data into another person's
 * session for exactly one reason: `resetAllStores()` is a manually curated list
 * of setState calls, and when those two stores were added nobody remembered to
 * extend it. Nothing failed — the leak is invisible until you look for it.
 *
 * So: every store in src/stores/ must be accounted for in exactly one of three
 * places. Adding a new store without classifying it fails this test, with a
 * message saying which decision is missing.
 */

const STORES_DIR = join(process.cwd(), 'src/stores')
const DATA_SYNC = readFileSync(join(process.cwd(), 'src/lib/dataSync.ts'), 'utf8')

// Cleared by resetSessionStores() — per-person, NOT in the snapshot. These hold
// data belonging to whoever is at the screen and must not survive an identity
// change (sign-out, view/edit-as-client, account deletion).
const SESSION_STORES = ['bankStore', 'autoMapStore']

// Deliberately never reset: session/UI state that is meaningless to persist and
// harmless to carry, or (impersonation) whose reset would itself be a bug.
const EXEMPT = [
  'authStore',          // mirrors Firebase Auth; cleared by Firebase itself
  'syncStore',          // save status / dirty flag — UI only
  'impersonationStore', // exit is a full page reload BY DESIGN; a soft reset here
                        // was the 2026-07-21 view-as-client data leak. The ONE
                        // exception is clearOnIdentityTeardown(), called by
                        // DataSync's two identity-boundary branches AFTER
                        // resetAllStores() — covered by identityTeardown.test.tsx
]

// Match only inside the resetAllStores() BODY, and only on whole identifiers.
// Searching the whole file gave two false negatives (both proven): a store whose
// hook name is a prefix of another ('useBank' inside 'useBankStore') passed, and
// a store that is merely IMPORTED — very common, for a type — would keep passing
// after being dropped from the reset itself.
const RESET_ALL_BODY = DATA_SYNC.slice(
  DATA_SYNC.indexOf('export function resetAllStores'),
  DATA_SYNC.indexOf('export function resetSessionStores'),
)

function storeNames(): string[] {
  return readdirSync(STORES_DIR)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map(f => f.replace(/\.ts$/, ''))
}

describe('store reset coverage', () => {
  it('every store is either snapshot-reset, session-reset, or explicitly exempt', () => {
    const unclassified = storeNames().filter(name => {
      if (SESSION_STORES.includes(name) || EXEMPT.includes(name)) return false
      // Snapshot-backed stores are reset by name inside resetAllStores().
      const hookName = 'use' + name[0].toUpperCase() + name.slice(1)
      return !new RegExp(`\\b${hookName}\\b`).test(RESET_ALL_BODY)
    })

    expect(
      unclassified,
      `Unclassified store(s): ${unclassified.join(', ')}.\n` +
      `Decide for each one:\n` +
      `  • holds snapshot data      → reset it inside resetAllStores() in src/lib/dataSync.ts\n` +
      `  • per-person but ephemeral → add to resetSessionStores() AND to SESSION_STORES here\n` +
      `  • session/UI only          → add to EXEMPT here, with the reason\n` +
      `Leaving it out means one person's data can appear in another person's session.`,
    ).toEqual([])
  })

  it('resetSessionStores clears every store listed as session-scoped', () => {
    const body = DATA_SYNC.slice(DATA_SYNC.indexOf('export function resetSessionStores'))
    for (const name of SESSION_STORES) {
      const hookName = 'use' + name[0].toUpperCase() + name.slice(1)
      expect(body, `${hookName} is listed as session-scoped but resetSessionStores() does not clear it`)
        .toContain(hookName)
    }
  })

  it('resetSessionStores is NOT called from applyRemote — that would wipe work mid-session', () => {
    // applyRemote runs on every live-sync event from the other side, within ONE
    // identity. Clearing the bank tab there deletes a statement the user is
    // working through, with no way to recover it.
    const dataSyncTsx = readFileSync(join(process.cwd(), 'src/components/layout/DataSync.tsx'), 'utf8')
    const applyRemote = dataSyncTsx.slice(
      dataSyncTsx.indexOf('const applyRemote'),
      dataSyncTsx.indexOf('const applyRemote') + 2500,
    )
    expect(applyRemote).not.toContain('resetSessionStores')
  })
})
