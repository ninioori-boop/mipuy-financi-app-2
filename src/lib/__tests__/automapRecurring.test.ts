import { describe, it, expect } from 'vitest'
import { detectRecurring, splitRecurring, monthKeyOf, SUB_TARGET } from '@/lib/automapRecurring'
import type { RecurringInput } from '@/lib/automapRecurring'

const t = (
  desc: string, amount: number, category: string, date: string,
  extra: Partial<RecurringInput> = {},
): RecurringInput => ({ desc, amount, category, date, isRefund: false, ...extra })

/** The same charge, once a month, across a 3-month window. */
const monthly = (desc: string, amount: number | number[], category: string) =>
  ['05', '06', '07'].map((m, i) =>
    t(desc, Array.isArray(amount) ? amount[i] : amount, category, `1${i}-${m}-2026`))

// ⚠️ Credit rows arrive as DD-MM-YYYY and bank rows as YYYY-MM-DD, in the same
// list. A fixed slice gets one right and scatters the other across twelve
// imaginary months — every merchant would then look like it appeared once, and
// the detector would return nothing at all while looking like it worked.
describe('monthKeyOf', () => {
  it('reads a bank row', () => {
    expect(monthKeyOf('2026-07-29')).toBe('2026-07')
  })

  it('reads a credit row', () => {
    expect(monthKeyOf('02-05-2026')).toBe('2026-05')
    expect(monthKeyOf('2-5-2026')).toBe('2026-05')
    expect(monthKeyOf('02/05/2026')).toBe('2026-05')
  })

  it('says nothing rather than guessing at a date it cannot read', () => {
    expect(monthKeyOf('מאי')).toBeNull()
    expect(monthKeyOf('')).toBeNull()
  })

  it('puts both formats of the same month in the same bucket', () => {
    expect(monthKeyOf('29-07-2026')).toBe(monthKeyOf('2026-07-29'))
  })
})

describe('detectRecurring', () => {
  it('finds a subscription charged the same amount every month', () => {
    const [hit] = detectRecurring(monthly('SPOTIFY', 23.9, 'מנויים'), 3)
    expect(hit.name).toBe('SPOTIFY')
    expect(hit.months).toBe(3)
    expect(hit.stable).toBe(true)
    expect(hit.status).toBe('known')
    expect(hit.confidence).toBe('high')
    expect(hit.reason).toContain('אותו סכום')
  })

  // The one Ori asked for: it repeats like a subscription and is filed as an
  // ordinary variable expense, so it is the item that gets a button.
  it('flags a monthly charge sitting outside מנויים as a suspect', () => {
    const [hit] = detectRecurring(monthly('אי אם גי אייר דיזיין', [100, 100, 110], 'תספורת וקוסמטיקה'), 3)
    expect(hit.status).toBe('suspect')
    expect(hit.monthly).toBeCloseTo(103.33, 1)
  })

  // 🔴 The discriminator. A supermarket appears in every month too, and calling
  // it a subscription would be worse than saying nothing.
  it('does not mistake a shop visited many times a month for a subscription', () => {
    const many = ['05', '06', '07'].flatMap(m =>
      [1, 2, 3, 4].map(d => t('שופרסל', 300, 'מזון לבית', `0${d}-${m}-2026`)))
    expect(detectRecurring(many, 3)).toEqual([])
  })

  it('allows one month with a double charge', () => {
    const rows = [...monthly('חדר כושר', 200, 'חדר כושר'), t('חדר כושר', 200, 'חדר כושר', '28-06-2026')]
    expect(detectRecurring(rows, 3)).toHaveLength(1)
  })

  // 🔴 A rail carries a different payee every month. On the real run BIT was the
  // largest repeating "merchant" in the file at ₪1,655 a month, and every
  // shekel of it was a different person.
  it('never treats a payment rail as recurring', () => {
    expect(detectRecurring(monthly('BIT', 1000, 'ביט ללא מעקב'), 3)).toEqual([])
  })

  // A monthly transfer to a fund IS a commitment, but moving it to מנויים would
  // book the household's saving as spending.
  it('leaves savings and transfers alone', () => {
    expect(detectRecurring(monthly('קסם אקטיב', 1800, 'השקעות'), 3)).toEqual([])
    expect(detectRecurring(monthly('העברה', 500, 'העברות ואשראי'), 3)).toEqual([])
  })

  // It repeats, it is already filed as repeating, and there is no decision left
  // to offer. Listing it would only lengthen a panel meant to be acted on.
  it('says nothing about a charge already in קבועות or ביטוחים', () => {
    expect(detectRecurring(monthly('מכבי', 109, 'קופת חולים'), 3)).toEqual([])
    expect(detectRecurring(monthly('הראל בריאות', 41, 'ביטוח'), 3)).toEqual([])
  })

  it('needs more than a single month', () => {
    expect(detectRecurring([t('נטפליקס', 40, 'שונות', '05-05-2026')], 3)).toEqual([])
  })

  it('ignores a charge that stopped after the first two months of three', () => {
    const rows = [t('משהו', 90, 'שונות', '05-05-2026'), t('משהו', 140, 'שונות', '05-06-2026')]
    expect(detectRecurring(rows, 3)).toEqual([])   // varies AND not every month
  })

  it('keeps a two-of-three charge when the amount never moved', () => {
    const rows = [t('נטפליקס', 40, 'שונות', '05-05-2026'), t('נטפליקס', 40, 'שונות', '05-06-2026')]
    const [hit] = detectRecurring(rows, 3)
    expect(hit.status).toBe('suspect')
    expect(hit.confidence).toBe('medium')
  })

  // A standing order says outright that it repeats, so a moving amount (a telco
  // bill, a water bill) is not a reason to hide it.
  it('keeps a standing order even when the amount moves', () => {
    const rows = monthly('פרטנר', [186, 40, 90], 'תקשורת').map(r => ({ ...r, isStandingOrder: true }))
    expect(detectRecurring(rows, 3)).toHaveLength(1)
    expect(detectRecurring(rows, 3)[0].reason).toBe('הוראת קבע')
  })

  it('nets nothing from a refund', () => {
    const rows = [...monthly('SPOTIFY', 23.9, 'מנויים'), t('SPOTIFY', 23.9, 'מנויים', '20-07-2026', { isRefund: true })]
    expect(detectRecurring(rows, 3)[0].charges).toBe(3)
  })

  it('groups the same merchant written two ways', () => {
    const rows = [
      t('WOLT', 40, 'שונות', '05-05-2026'),
      t('wolt  ', 40, 'שונות', '05-06-2026'),
      t('WOLT', 40, 'שונות', '05-07-2026'),
    ]
    expect(detectRecurring(rows, 3)).toHaveLength(1)
  })

  it('sorts by what costs the most', () => {
    const rows = [...monthly('גדול', 400, 'שונות'), ...monthly('קטן', 24, 'שונות')]
    expect(detectRecurring(rows, 3).map(i => i.name)).toEqual(['גדול', 'קטן'])
  })

  it('reports the months it saw, in order, for the drill-down', () => {
    const [hit] = detectRecurring(monthly('217ACADEMY', [400, 400, 400], 'מנויים'), 3)
    expect(hit.perMonth.map(p => p.month)).toEqual(['2026-05', '2026-06', '2026-07'])
  })

  it('survives a window of one without inventing anything', () => {
    expect(detectRecurring(monthly('SPOTIFY', 23.9, 'מנויים'), 1)).toHaveLength(1)
    expect(detectRecurring([t('SPOTIFY', 23.9, 'מנויים', '05-05-2026')], 1)).toEqual([])
  })
})

describe('splitRecurring', () => {
  it('separates what is filed from what only looks filed', () => {
    const items = detectRecurring([
      ...monthly('SPOTIFY', 23.9, 'מנויים'),
      ...monthly('217ACADEMY', 400, 'שונות'),
    ], 3)
    const { known, suspects } = splitRecurring(items)
    expect(known.map(i => i.name)).toEqual(['SPOTIFY'])
    expect(suspects.map(i => i.name)).toEqual(['217ACADEMY'])
  })

  it('names the category a confirmed subscription moves to', () => {
    expect(SUB_TARGET).toBe('מנויים')
  })
})
