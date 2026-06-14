import { describe, it, expect } from 'vitest'
import { parseAmount, detectColumns, extractInstallmentInfo, isStandingOrderDesc, extractTransactions } from '../parsing'
import { normalizeForLookup, categorize } from '../categorize'

// ── parseAmount ──────────────────────────────────────────────────────────────

describe('parseAmount', () => {
  it('returns number as-is', () => {
    expect(parseAmount(42.5)).toBe(42.5)
  })
  it('parses plain string', () => {
    expect(parseAmount('123.45')).toBe(123.45)
  })
  it('strips ₪ and spaces', () => {
    expect(parseAmount('₪ 500')).toBe(500)
  })
  it('strips commas (thousands separator)', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56)
  })
  it('negates parenthesized values', () => {
    expect(parseAmount('(150)')).toBe(-150)
  })
  it('returns NaN for null', () => {
    expect(parseAmount(null)).toBeNaN()
  })
  it('returns NaN for empty string', () => {
    expect(parseAmount('')).toBeNaN()
  })
  it('returns NaN for non-numeric text', () => {
    expect(parseAmount('abc')).toBeNaN()
  })
  it('handles negative plain number', () => {
    expect(parseAmount(-99)).toBe(-99)
  })
})

// ── normalizeForLookup ───────────────────────────────────────────────────────

describe('normalizeForLookup', () => {
  it('strips בע"מ suffix', () => {
    expect(normalizeForLookup('שופרסל בע"מ')).toBe('שופרסל')
  })
  it('strips city name', () => {
    const result = normalizeForLookup('ארומה תל אביב')
    expect(result).not.toContain('תל אביב')
    expect(result).toContain('ארומה')
  })
  it('strips Ltd suffix', () => {
    const result = normalizeForLookup('some company ltd')
    expect(result).not.toContain('ltd')
  })
  it('returns empty string for empty input', () => {
    expect(normalizeForLookup('')).toBe('')
  })
  it('lowercases the result', () => {
    const result = normalizeForLookup('NETFLIX')
    expect(result).toBe('netflix')
  })
})

// ── categorize ───────────────────────────────────────────────────────────────

describe('categorize', () => {
  it('categorizes שופרסל → מזון לבית', () => {
    expect(categorize('שופרסל')).toBe('מזון לבית')
  })
  it('categorizes netflix → מנויים', () => {
    expect(categorize('netflix')).toBe('מנויים')
  })
  it('categorizes unknown → שונות', () => {
    expect(categorize('חנות לא ידועה xyz99')).toBe('שונות')
  })
  it('uses learnedDB over builtinDB', () => {
    const learned = { 'netflix': 'שונות' }
    expect(categorize('netflix', learned)).toBe('שונות')
  })
  it('matches partial description', () => {
    expect(categorize('תשלום ל wolt')).toBe('אוכל בחוץ ובילויים')
  })
  it('returns שונות for empty description', () => {
    expect(categorize('')).toBe('שונות')
  })
})

// ── detectColumns ────────────────────────────────────────────────────────────

describe('detectColumns', () => {
  it('detects standard Israeli credit report headers', () => {
    const header = ['תאריך רכישה', 'שם בית עסק', 'סכום חיוב', 'פירוט נוסף']
    const cols = detectColumns(header)
    expect(cols.descCol).toBe(1)
    expect(cols.amountCol).toBe(2)
    expect(cols.dateCol).toBe(0)
    expect(cols.notesCol).toBe(3)
  })
  it('returns -1 for missing columns', () => {
    const cols = detectColumns(['a', 'b', 'c'])
    expect(cols.descCol).toBe(-1)
    expect(cols.amountCol).toBe(-1)
  })
  it('prefers chargeAmountCol over generic amountCol', () => {
    const header = ['שם בית עסק', 'סכום עסקה', 'סכום חיוב']
    const cols = detectColumns(header)
    expect(cols.amountCol).toBe(2) // chargeAmountCol takes priority
  })
})

// ── extractInstallmentInfo ───────────────────────────────────────────────────

describe('extractInstallmentInfo', () => {
  it('parses "תשלום 2 מתוך 12"', () => {
    expect(extractInstallmentInfo('תשלום 2 מתוך 12')).toEqual({ current: 2, total: 12 })
  })
  it('parses "3/12"', () => {
    expect(extractInstallmentInfo('3/12')).toEqual({ current: 3, total: 12 })
  })
  it('returns null for non-installment notes', () => {
    expect(extractInstallmentInfo('רכישה רגילה')).toBeNull()
  })
  it('returns null for empty input', () => {
    expect(extractInstallmentInfo('')).toBeNull()
  })
  it('rejects implausible installments (total > 60)', () => {
    expect(extractInstallmentInfo('1/100')).toBeNull()
  })
})

// ── isStandingOrderDesc ──────────────────────────────────────────────────────

describe('isStandingOrderDesc', () => {
  it('detects הוראת קבע', () => {
    expect(isStandingOrderDesc('הוראת קבע לחברת החשמל')).toBe(true)
  })
  it('detects standing order', () => {
    expect(isStandingOrderDesc('standing order netflix')).toBe(true)
  })
  it('returns false for regular purchase', () => {
    expect(isStandingOrderDesc('קניה בשופרסל')).toBe(false)
  })
})

// ── extractTransactions ──────────────────────────────────────────────────────

describe('extractTransactions', () => {
  const rows = [
    ['תאריך רכישה', 'שם בית עסק', 'סכום חיוב', 'פירוט נוסף'],
    ['2024-01-15', 'שופרסל', '250', ''],
    ['2024-01-16', 'נטפליקס', '55', ''],
    ['2024-01-17', '', '', ''],  // empty row — should be skipped
  ]

  it('extracts transactions correctly', () => {
    const txns = extractTransactions(rows as unknown[][], 'test.xlsx')
    expect(txns).toHaveLength(2)
    expect(txns[0].desc).toBe('שופרסל')
    expect(txns[0].amount).toBe(250)
    expect(txns[0].source).toBe('test.xlsx')
    expect(txns[0].category).toBe('מזון לבית')
  })

  it('returns empty array for unrecognized format', () => {
    const txns = extractTransactions([['a', 'b'], ['c', 'd']], 'bad.xlsx')
    expect(txns).toEqual([])
  })
})

// ── extractTransactions — Isracard/Max "פירוט עבור הכרטיסים" format ───────────
describe('extractTransactions — Isracard/Max multi-section format', () => {
  const headerArea = [
    'שם כרטיס', 'תאריך', 'חיוב לתאריך', 'שם בית עסק',
    'סכום קנייה', 'סכום חיוב בש"ח', 'אסמכתא', 'תיאור סוג עסקת אשראי',
  ]

  it('finds the header even when a long summary block precedes it', () => {
    const summary = Array.from({ length: 22 }, (_, i) => [`סיכום ${i}`, '', '', '', '', '', '', ''])
    const rows: unknown[][] = [
      ...summary,
      ['פירוט עבור הכרטיסים בארץ'],
      ['מספר חשבון 366135-719-12', 'תאריך הפקה', '14.06.2026'],
      headerArea,
      ['7014', new Date('2026-06-02'), '', 'סאני סמסונג', '42.90', '42.90', '13637599', 'עסקה רגילה'],
      ['7014', new Date('2026-06-03'), '', 'סופר פארם',   '52.00', '52.00', '84896024', 'הוראת קבע'],
    ]
    const txns = extractTransactions(rows, 'isracard.xlsx')
    expect(txns).toHaveLength(2)
    expect(txns[0].desc).toBe('סאני סמסונג')
    expect(txns[0].amount).toBe(42.9)
    // 'הוראת קבע' lives in the "תיאור סוג עסקת אשראי" column → standing order detected.
    expect(txns[1].isStandingOrder).toBe(true)
  })

  it('reads a second section (בחו"ל) whose columns are shifted', () => {
    const headerAbroad = [
      '', 'שם כרטיס', 'תאריך', 'חיוב לתאריך', 'שם בית עסק',
      'סכום קנייה', 'סכום חיוב בש"ח', 'מטבע מקורי', 'אסמכתא',
    ]
    const rows: unknown[][] = [
      ['פירוט עבור הכרטיסים בארץ'],
      headerArea,
      ['7014', new Date('2026-06-02'), '', 'שופרסל', '250', '250', '111', 'עסקה רגילה'],
      [],
      ['פירוט עבור הכרטיסים בחו"ל'],
      headerAbroad,
      ['', '7014', new Date('2026-06-10'), '', 'GOOGLE', '7.90', '7.90', 'ILS', '5300'],
    ]
    const txns = extractTransactions(rows, 'isracard.xlsx')
    expect(txns.map(t => t.desc)).toEqual(['שופרסל', 'GOOGLE'])
    // The shifted-column row resolved via the second section's own header.
    expect(txns.find(t => t.desc === 'GOOGLE')?.amount).toBe(7.9)
  })
})
