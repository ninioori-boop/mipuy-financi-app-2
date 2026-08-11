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

// An investment house sells both policies and securities under one name, and
// the generic key is the short one. A ₪1,000 securities purchase filed as an
// insurance premium is wrong twice over: wrong category, and counted as
// spending when it is money moving into an asset.
describe('categorize — an investment house is not always insurance', () => {
  it.each([
    'קניה/( כאל) מגדל/טלפון ני',
    'קניה/(כאל) מגדל/אינטרנט',
    'מגדל/נט קניה ניע',
  ])('reads a securities buy as an investment: %s', desc => {
    expect(categorize(desc)).toBe('השקעות')
  })

  // 🔴 The reason it stayed broken through three deploys. A learned key used to
  // outrank the built-in DB outright inside the substring tier, so a 4-char
  // learned "מגדל" beat the curated 10-char "מגדל/טלפון" and every securities
  // purchase came back as an insurance premium. Longest key wins now.
  it('a SHORT learned key no longer hijacks a longer curated one', () => {
    expect(categorize('קניה/( כאל) מגדל/טלפון ני', { 'מגדל': 'ביטוח' })).toBe('השקעות')
  })

  it('but a learned key at least as specific still wins — corrections work', () => {
    expect(categorize('קניה/( כאל) מגדל/טלפון ני', { 'מגדל/טלפון': 'מזון לבית' })).toBe('מזון לבית')
    expect(categorize('קניה/( כאל) מגדל/טלפון ני', { 'מגדל/טלפון ני': 'מזון לבית' })).toBe('מזון לבית')
  })

  it('a learned key still wins where the built-in has nothing longer', () => {
    expect(categorize('מגדל חברה לביטוח', { 'מגדל חברה': 'השקעות' })).toBe('השקעות')
  })

  it('still reads the insurance company as insurance', () => {
    expect(categorize('מגדל חברה לביטוח')).toBe('ביטוח')
    expect(categorize('הראל-ביטוח דירה')).toBe('ביטוח')
  })

  it('keeps the money-market fund as savings, not investments', () => {
    expect(categorize('מגדל כספית')).toBe('חסכונות')
  })
})

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
