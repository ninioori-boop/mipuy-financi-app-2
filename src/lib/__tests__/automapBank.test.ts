import { describe, it, expect } from 'vitest'
import { detectBankHeader, extractBankRows, isCardSettlement } from '@/lib/automapBank'

// A realistic Israeli bank export: separate חובה / זכות columns + running balance.
const BANK_HEADER = ['תאריך', 'תיאור הפעולה', 'אסמכתא', 'חובה', 'זכות', 'יתרה']
const bankRows = (...data: unknown[][]) => [
  ['דוח תנועות בחשבון'],
  [],
  BANK_HEADER,
  ...data,
]
const d = (iso: string) => new Date(`${iso}T00:00:00`)

// A credit-card export. "סכום חיוב" must NOT be mistaken for חובה.
const CREDIT_ROWS = [
  ['תאריך עסקה', 'שם בית עסק', 'סכום עסקה', 'סכום חיוב'],
  [d('2026-06-03'), 'שופרסל דיל', 250, 250],
]

describe('detectBankHeader', () => {
  it('finds the header of a real bank export', () => {
    const h = detectBankHeader(bankRows())
    expect(h?.headerIdx).toBe(2)
    expect(h?.cols.debitCol).toBe(3)
    expect(h?.cols.creditCol).toBe(4)
  })

  it('returns null for a credit-card export, so it keeps using the credit parser', () => {
    expect(detectBankHeader(CREDIT_ROWS)).toBeNull()
  })

  it('returns null for an empty sheet', () => {
    expect(detectBankHeader([])).toBeNull()
    expect(detectBankHeader([[], []])).toBeNull()
  })
})

describe('extractBankRows', () => {
  it('reads a salary deposit as money IN — the bug this file exists for', () => {
    const rows = extractBankRows(bankRows(
      [d('2026-06-01'), 'משכורת חברת אלפא בעמ', '112233', null, 14000, 21000],
    ))
    expect(rows).toEqual([
      { desc: 'משכורת חברת אלפא בעמ', amount: 14000, date: '2026-06-01', dir: 'in' },
    ])
  })

  it('reads a charge as money OUT', () => {
    const rows = extractBankRows(bankRows(
      [d('2026-06-05'), 'ארנונה עיריית חיפה', '445566', 620, null, 20380],
    ))
    expect(rows[0]).toMatchObject({ amount: 620, dir: 'out' })
  })

  it('keeps both directions apart in one statement', () => {
    const rows = extractBankRows(bankRows(
      [d('2026-06-01'), 'משכורת', '1', null, 14000, 21000],
      [d('2026-06-05'), 'משכנתא בנק טפחות', '2', 4200, null, 16800],
      [d('2026-06-10'), 'החזר מס הכנסה', '3', null, 900, 17700],
    ))
    expect(rows.map(r => r.dir)).toEqual(['in', 'out', 'in'])
    expect(rows.filter(r => r.dir === 'in').reduce((s, r) => s + r.amount, 0)).toBe(14900)
  })

  it('emits ISO dates so the month-span guard can read them', () => {
    const rows = extractBankRows(bankRows(
      [d('2026-06-01'), 'משכורת', '1', null, 14000, 21000],
    ))
    expect(rows[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('drops opening/closing balance and total lines', () => {
    const rows = extractBankRows(bankRows(
      [d('2026-06-01'), 'יתרת פתיחה', '', null, null, 7000],
      [d('2026-06-02'), 'סופרמרקט', '9', 300, null, 6700],
      [d('2026-06-30'), 'סה"כ תנועות', '', 300, 14000, 20700],
    ))
    expect(rows).toHaveLength(1)
    expect(rows[0].desc).toBe('סופרמרקט')
  })

  it('returns nothing for a credit export rather than producing garbage', () => {
    expect(extractBankRows(CREDIT_ROWS)).toEqual([])
  })
})

describe('isCardSettlement', () => {
  it.each([
    'פירעון כרטיסי אשראי',
    'תשלום כרטיס אשראי',
    'ישראכרט',
    'לאומי קארד',
    'ויזה כ״א״ל',        // gershayim folded → 'ויזה כאל'
  ])('flags a settlement line: %s', desc => {
    expect(isCardSettlement(desc)).toBe(true)
  })

  // Dropping a real expense is worse than leaving one summary line in, so the
  // pattern list must never fire on a merchant name.
  it.each([
    'שופרסל דיל',
    'ארנונה עיריית חיפה',
    'משכורת חברת אלפא',
    'מקסיקנה מסעדה',        // contains מקס
    'ויזהאר סטודיו',         // contains ויזה
    'מיכאל שיפוצים',         // contains כאל — the one that nearly shipped
    'מיכל כהן',
  ])('does not flag an ordinary merchant: %s', desc => {
    expect(isCardSettlement(desc)).toBe(false)
  })

  it('is false for an empty description', () => {
    expect(isCardSettlement('')).toBe(false)
    expect(isCardSettlement('   ')).toBe(false)
  })
})
