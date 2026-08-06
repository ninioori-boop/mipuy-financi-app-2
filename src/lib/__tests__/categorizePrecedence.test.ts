import { describe, it, expect } from 'vitest'
import { categorize } from '../categorize'
import { BUSINESS_DB } from '../businessDB'

/**
 * Precedence tiers (2026-08-06): EXACT beats substring, and within each tier a
 * learned correction beats the built-in DB. The defect this locks out: any
 * learned SUBSTRING key used to outrank a curated exact BUSINESS_DB entry —
 * one client's over-broad key, once promoted to the shared pool, hijacked a
 * precisely-named merchant for every account.
 */

// A real BUSINESS_DB key to anchor the tests to (avoids inventing entries).
const [builtinKey, builtinCat] = Object.entries(BUSINESS_DB)
  .find(([k]) => k.length >= 6) as [string, string]

describe('categorize — precedence tiers', () => {
  it('a learned EXACT key overrides the built-in DB (correction power intact)', () => {
    expect(categorize(builtinKey, { [builtinKey.toLowerCase()]: 'מנויים' })).toBe('מנויים')
  })

  it('a built-in EXACT entry beats a learned SUBSTRING key (hijack blocked)', () => {
    // A learned key that is a strict substring of the built-in key's text.
    const sub = builtinKey.toLowerCase().slice(0, 5)
    expect(categorize(builtinKey, { [sub]: 'תרומות' })).toBe(builtinCat)
  })

  it('a learned substring still wins over a built-in substring (tier order)', () => {
    // Query that no exact key matches: the built-in key + a suffix.
    const query = `${builtinKey} סניף מרכז`
    expect(categorize(query, { [builtinKey.toLowerCase()]: 'מתנות' })).toBe('מתנות')
  })

  it('niqqud in the incoming text does not break matching', () => {
    // שׁוּפֶּרְסָל — the plene spelling decorated with vowel marks.
    expect(categorize('שׁוּפֶּרְסָל')).toBe(categorize('שופרסל'))
  })
})
