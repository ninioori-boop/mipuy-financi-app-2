import { describe, it, expect } from 'vitest'
import { categorize } from '@/lib/categorize'

// The rail fallback in categorize(): Hebrew rail variants with no BUSINESS_DB
// key must land on their untracked default instead of שונות (which would mean
// a paid AI call on EVERY upload — rail results are never learned).
describe('categorize — payment-rail fallback', () => {
  it('Hebrew rail variants without a BUSINESS_DB key get the untracked default', () => {
    expect(categorize('תשלום בביט')).toBe('ביט ללא מעקב')
    expect(categorize('פייבוקס')).toBe('ביט ללא מעקב')
    expect(categorize('ביט לגננת')).toBe('ביט ללא מעקב')
    expect(categorize('הפקדת מזומן')).toBe('מזומן ללא מעקב')
  })

  // The regression this file previously missed: every case above and below used
  // either a bare rail word or the LATIN token BIT, both of which resolve via a
  // BUSINESS_DB key. A transfer written entirely in Hebrew took a different path
  // — and landed in אוכל בחוץ ובילויים, because the 2-char key "בר" matches
  // inside "העברה"/"העברת". These are the descriptors real statements contain.
  it('a transfer written entirely in Hebrew resolves to the rail default', () => {
    expect(categorize('העברת כסף בביט')).toBe('ביט ללא מעקב')
    expect(categorize('העברה עצמית בביט')).toBe('ביט ללא מעקב')
    expect(categorize('ביט העברת כסף')).toBe('ביט ללא מעקב')
    expect(categorize('העברה בפייבוקס')).toBe('ביט ללא מעקב')
    expect(categorize('משיכת מזומן בכספומט')).toBe('מזומן ללא מעקב')
  })

  it('the classic Latin formats still resolve via BUSINESS_DB', () => {
    expect(categorize('BIT')).toBe('ביט ללא מעקב')
    expect(categorize('העברה ב BIT בנה"פ')).toBe('ביט ללא מעקב')
    expect(categorize('משיכת מזומן')).toBe('מזומן ללא מעקב')
  })

  it('specific merchants keep beating the fallback', () => {
    // BUSINESS_DB carries "ביט שומרה" (insurance) — a longer, specific match
    // that must win over the rail default.
    expect(categorize('ביט שומרה')).toBe('ביטוח')
    // Non-rails that BUSINESS_DB misses still fall to שונות → the AI flow.
    expect(categorize('דפוס שביט')).toBe('שונות')
  })

  it('a learned (non-rail) entry still wins over everything', () => {
    expect(categorize('מאפיית השכונה', { 'מאפיית השכונה': 'אוכל בחוץ ובילויים' })).toBe('אוכל בחוץ ובילויים')
  })
})
