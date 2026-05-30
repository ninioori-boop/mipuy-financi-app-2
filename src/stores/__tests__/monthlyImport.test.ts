import { describe, it, expect, beforeEach } from 'vitest'
import { useMonthlyStore } from '@/stores/monthlyStore'
import {
  ALL_CATEGORIES, SKIP_CATEGORIES,
  VAR_CATEGORIES, ANNUAL_CATEGORIES, FIXED_CATEGORIES,
  SUB_CATEGORIES, INSURANCE_CATEGORIES,
} from '@/lib/constants'

// The section an expense category is expected to land in when imported into a
// month. This is the SPEC the import flow must satisfy — annual categories
// (e.g. חופשה וטיול) deliberately fold into variable on a monthly import.
// null = intentionally not imported (income / savings / transfers).
type Section = 'fixed' | 'variable' | 'sub' | 'ins'
function expectedSection(cat: string): Section | null {
  if (FIXED_CATEGORIES.has(cat)) return 'fixed'
  if (VAR_CATEGORIES.has(cat) || ANNUAL_CATEGORIES.has(cat)) return 'variable'
  if (SUB_CATEGORIES.has(cat)) return 'sub'
  if (INSURANCE_CATEGORIES.has(cat)) return 'ins'
  return null
}

const CLASSIFICATION_SETS = [
  ['VAR', VAR_CATEGORIES],
  ['ANNUAL', ANNUAL_CATEGORIES],
  ['FIXED', FIXED_CATEGORIES],
  ['SUB', SUB_CATEGORIES],
  ['INSURANCE', INSURANCE_CATEGORIES],
  ['SKIP', SKIP_CATEGORIES],
] as const

describe('category classification is well-formed', () => {
  it('every category belongs to exactly one classification set', () => {
    for (const cat of ALL_CATEGORIES) {
      const members = CLASSIFICATION_SETS.filter(([, set]) => set.has(cat)).map(([n]) => n)
      // A category with 0 sets would vanish on import; with 2+ it could double-count.
      expect(members, `"${cat}" must be in exactly one set, found: [${members.join(', ')}]`).toHaveLength(1)
    }
  })
})

describe('applyImport — import to month routes every category', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('no expense category is silently dropped, and each lands in its correct section', () => {
    const AMOUNT = 100
    const catSums = Object.fromEntries(ALL_CATEGORIES.map(c => [c, AMOUNT]))

    const store = useMonthlyStore.getState()
    store.initMonth('jan')
    store.applyImport('jan', catSums, [], [], [], [], 1)

    const m = useMonthlyStore.getState().months['jan']
    const sections: Record<Section, typeof m.fixed> = {
      fixed: m.fixed, variable: m.variable, sub: m.sub, ins: m.ins,
    }

    for (const cat of ALL_CATEGORIES) {
      const expected = expectedSection(cat)
      if (expected === null) {
        for (const rows of Object.values(sections)) {
          expect(
            rows.find(r => r.name === cat),
            `"${cat}" is a skip category and must NOT be imported into the month`,
          ).toBeUndefined()
        }
        continue
      }
      const row = sections[expected].find(r => r.name === cat)
      expect(row, `"${cat}" should land in "${expected}" — it vanished or went to the wrong section`).toBeDefined()
      expect(row!.actual).toBe(AMOUNT)
    }
  })

  it('total imported equals the sum of all non-skip categories (no money lost or duplicated)', () => {
    const AMOUNT = 100
    const catSums = Object.fromEntries(ALL_CATEGORIES.map(c => [c, AMOUNT]))

    const store = useMonthlyStore.getState()
    store.initMonth('feb')
    store.applyImport('feb', catSums, [], [], [], [], 1)

    const m = useMonthlyStore.getState().months['feb']
    const landed = [...m.fixed, ...m.variable, ...m.sub, ...m.ins]
      .reduce((s, r) => s + r.actual, 0)
    const expected = ALL_CATEGORIES.filter(c => !SKIP_CATEGORIES.has(c)).length * AMOUNT

    expect(landed).toBe(expected)
  })
})
