import { describe, it, expect } from 'vitest'
import {
  detectSavingsDeposits, formatSavingsDeposits, classifyDeposits, formatDepositSplit,
} from '@/lib/automapFlows'
import { cleanDesc, hasInvisible } from '@/lib/automapText'

const out = (desc: string, amount: number, category: string, date: string) =>
  ({ desc, amount, category, date, isRefund: false })

// ── invisible characters ──
//
// The bank writes U+202B before each Hebrew segment. It is why a ₪967/month
// securities purchase was filed as insurance for three months: the curated key
// is "מגדל/טלפון" and matching is by substring.
describe('cleanDesc', () => {
  const RLE = '‫'
  const dirty = `קניה/${RLE}( כ00) מגדל/${RLE}טלפון ני`

  it('rejoins a name the embedding mark split', () => {
    expect(cleanDesc(dirty)).toContain('מגדל/טלפון')
  })

  it('deletes the mark rather than replacing it with a space', () => {
    // A space here would be just as fatal: "מגדל/ טלפון" matches nothing either.
    expect(cleanDesc(dirty)).not.toContain('מגדל/ טלפון')
  })

  it('strips every flavour of invisible in play', () => {
    for (const ch of ['​', '‎', '‏', '؜', '‪', '‮', '⁦', '⁩', '﻿']) {
      expect(cleanDesc(`שופ${ch}רסל`)).toBe('שופרסל')
    }
  })

  it('leaves ordinary text exactly as it was, and is idempotent', () => {
    expect(cleanDesc('רמי לוי שיווק השקמה')).toBe('רמי לוי שיווק השקמה')
    expect(cleanDesc(cleanDesc(dirty))).toBe(cleanDesc(dirty))
  })

  it('handles empty input without throwing', () => {
    expect(cleanDesc('')).toBe('')
    expect(cleanDesc('   ')).toBe('')
  })

  // A shared /g regex keeps lastIndex between .test() calls, so the same string
  // answers true then false. This is the bug that guard exists for.
  it('answers the same way however many times it is asked', () => {
    expect(hasInvisible(dirty)).toBe(true)
    expect(hasInvisible(dirty)).toBe(true)
    expect(hasInvisible('נקי')).toBe(false)
    expect(hasInvisible('נקי')).toBe(false)
  })
})

// ── money leaving to savings ──
//
// ₪8,648/mo on the real run, against six savings rows that all read
// monthlyContribution: 0.
describe('detectSavingsDeposits', () => {
  const threeMonths = [
    out('קסם אקטיב', 3000, 'השקעות', '2026-05-05'),
    out('קסם אקטיב', 3000, 'השקעות', '2026-06-05'),
    out('קסם אקטיב', 3000, 'השקעות', '2026-07-05'),
  ]

  it('finds a monthly deposit and states it as a monthly rate', () => {
    const flow = detectSavingsDeposits(threeMonths, 3)
    expect(flow.deposits).toHaveLength(1)
    expect(flow.deposits[0]).toMatchObject({ name: 'קסם אקטיב', recurring: true, months: 3 })
    expect(flow.monthlyRecurring).toBe(3000)
  })

  it('does not turn one lump sum into a monthly contribution', () => {
    const flow = detectSavingsDeposits([out('קרן כספית', 50000, 'חסכונות', '2026-06-05')], 3)
    expect(flow.deposits[0].recurring).toBe(false)
    expect(flow.monthlyRecurring).toBe(0)
    expect(flow.oneOffTotal).toBe(50000)
  })

  // Card settlements and transfers between the household's own accounts live in
  // העברות ואשראי. Calling those savings books the same money twice.
  it('ignores transfers and credit settlements', () => {
    const flow = detectSavingsDeposits([
      out('פירעון כרטיסי אשראי', 8000, 'העברות ואשראי', '2026-06-05'),
    ], 3)
    expect(flow.deposits).toEqual([])
  })

  it('ignores ordinary expenses however regular', () => {
    const flow = detectSavingsDeposits([
      out('שופרסל', 2000, 'מזון לבית', '2026-05-05'),
      out('שופרסל', 2000, 'מזון לבית', '2026-06-05'),
    ], 3)
    expect(flow.deposits).toEqual([])
  })

  // A rail carries a different payee every month, so no amount of regularity
  // makes it a contribution to anything.
  it('ignores payment rails', () => {
    const flow = detectSavingsDeposits([
      out('ביט', 1000, 'השקעות', '2026-05-05'),
      out('ביט', 1000, 'השקעות', '2026-06-05'),
      out('ביט', 1000, 'השקעות', '2026-07-05'),
    ], 3)
    expect(flow.deposits).toEqual([])
  })

  it('does not call an account traded in nine times a monthly contribution', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      out('איטורו', 500, 'השקעות', `2026-0${5 + (i % 3)}-${String(10 + i).padStart(2, '0')}`))
    expect(detectSavingsDeposits(many, 3).deposits[0].recurring).toBe(false)
  })

  it('says nothing at all when there is nothing to say', () => {
    expect(formatSavingsDeposits(detectSavingsDeposits([], 3), 3)).toEqual([])
  })

  it('tells the model the recurring total and warns off dividing the lump sums', () => {
    const text = formatSavingsDeposits(detectSavingsDeposits([
      ...threeMonths,
      out('קרן כספית', 50000, 'חסכונות', '2026-06-05'),
    ], 3), 3).join('\n')
    expect(text).toContain('monthlyContribution')
    expect(text).toContain('3000')      // the monthly rate
    expect(text).toContain('50000')     // the lump, stated as a total
    expect(text).toContain('אל תחלק אותן במספר החודשים')
  })
})

// ── money arriving that nobody declared ──
//
// ₪13,200/mo of reserve-duty grants arrived beside a declared ₪12,000 salary
// and vanished with it, because the whole deposits block was labelled
// "already declared".
describe('classifyDeposits', () => {
  const salary  = { name: 'מדינת ישראל משכורת', sum: 36000, count: 3, months: 3 }
  const miluim  = { name: 'ביטוח לאומי מילואים', sum: 39600, count: 3, months: 3 }
  const oneTime = { name: 'החזר מס', sum: 4000, count: 1, months: 1 }

  it('matches the declared salary to its deposit and counts it once', () => {
    const s = classifyDeposits([salary], [{ name: 'בעל', monthly: 12000 }], 3)
    expect(s.explained.map(l => l.name)).toEqual(['מדינת ישראל משכורת'])
    expect(s.unexplained).toEqual([])
  })

  it('🔴 keeps recurring income the questionnaire never mentioned', () => {
    const s = classifyDeposits([salary, miluim], [{ name: 'בעל', monthly: 12000 }], 3)
    expect(s.explained.map(l => l.name)).toEqual(['מדינת ישראל משכורת'])
    expect(s.unexplained.map(l => l.name)).toEqual(['ביטוח לאומי מילואים'])
    expect(Math.round(s.unexplainedMonthly)).toBe(13200)
  })

  it('does not call a single arrival monthly income', () => {
    const s = classifyDeposits([oneTime], [], 3)
    expect(s.oneOff.map(l => l.name)).toEqual(['החזר מס'])
    expect(s.unexplainedMonthly).toBe(0)
  })

  // Names never agree — a payslip says "מדינת ישראל" and the questionnaire says
  // "בעל" — so matching is on the amount, within a tolerance.
  it('matches on amount, not on name, and tolerates a rounded figure', () => {
    const s = classifyDeposits([salary], [{ name: 'בעל', monthly: 11500 }], 3)
    expect(s.explained).toHaveLength(1)
  })

  it('does not let one declared figure explain two different deposits', () => {
    const s = classifyDeposits(
      [salary, { name: 'משכורת שנייה', sum: 36000, count: 3, months: 3 }],
      [{ name: 'בעל', monthly: 12000 }],
      3,
    )
    expect(s.explained).toHaveLength(1)
    expect(s.unexplained).toHaveLength(1)
  })

  it('explains two deposits when two earners were declared', () => {
    const s = classifyDeposits(
      [salary, { name: 'משכורת שנייה', sum: 36000, count: 3, months: 3 }],
      [{ name: 'בעל', monthly: 12000 }, { name: 'אישה', monthly: 12000 }],
      3,
    )
    expect(s.explained).toHaveLength(2)
    expect(s.unexplained).toEqual([])
  })

  // A salary that missed a month is still that salary. Averaging it over the
  // window turns ₪12,000 into ₪8,000 and matches nothing.
  it('matches a salary on its rate, not on its window average', () => {
    const s = classifyDeposits(
      [{ name: 'משכורת', sum: 24000, count: 2, months: 2 }],
      [{ name: 'בעל', monthly: 12000 }],
      3,
    )
    expect(s.explained).toHaveLength(1)
  })

  it('tells the model to ADD the unexplained rather than swap it in', () => {
    const text = formatDepositSplit(
      classifyDeposits([salary, miluim], [{ name: 'בעל', monthly: 12000 }], 3), 3,
    ).join('\n')
    expect(text).toContain('אל תוסיף אותן ל‑income')     // about the explained ones
    expect(text).toContain('**הוסף כל שורה כאן ל‑income**')
    expect(text).toContain('בנוסף למה שנמסר')
  })
})
