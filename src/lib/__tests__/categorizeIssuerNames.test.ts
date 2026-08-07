import { describe, it, expect } from 'vitest'
import { categorize } from '@/lib/categorize'

// Live 2026-08-07: a client's four purchases at מקס סטוק arrived from the phone
// as "MAX 10 #and-<dedup id>" — Latin, so the Hebrew "מקס סטוק" key never
// matched, and the generic "max" → עמלות בנק ואשראי rule caught them instead.
// Four homeware purchases were filed as bank fees. Same trap for מיני מקס and
// אמפי. Categories confirmed by Ori.
//
// The mechanism is substring matching with the LONGEST key winning, so each of
// these keys only works while it out-lengths "max"/"מקס". A future edit that
// shortens or removes one fails here rather than silently in a client's budget.

describe('businesses whose name contains a card issuer', () => {
  it.each([
    ['MAX 10 #and-1785253471864', 'ריהוט והבית'],   // exactly as the phone sends it
    ['MAX 10',                    'ריהוט והבית'],
    ['מקס 10',                    'ריהוט והבית'],
    ['מיני מקס',                  'ריהוט והבית'],
    ['Mini Max',                  'ריהוט והבית'],
    ['Ampi Max Rishin Ltd',       'אוכל בחוץ ובילויים'],
    ['אמפי מקס',                  'אוכל בחוץ ובילויים'],
  ])('%s → %s', (name, expected) => {
    expect(categorize(name)).toBe(expected)
  })
})

describe('the generic card-fee rule still works', () => {
  it.each(['Max', 'מקס', 'isracard', 'ישראכרט', 'visa cal'])('%s is still a card fee', name => {
    expect(categorize(name)).toBe('עמלות בנק ואשראי')
  })

  // The rule these additions must not break: an unrelated business that merely
  // contains "מקס" keeps its own category.
  it.each([
    ['מקס ברנר', 'אוכל בחוץ ובילויים'],
    ['מקס סטוק', 'כלי בית'],
    ['מקס בייבי', 'צעצועים'],
  ])('%s is unaffected', (name, expected) => {
    expect(categorize(name)).toBe(expected)
  })
})
