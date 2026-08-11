import { describe, it, expect } from 'vitest'
import { sheetToText, looksLikeStatement, MAX_SHEET_ROWS } from '@/lib/automapSheet'

// The real shape this exists for: a הר הביטוח export from רשות שוק ההון. Two
// banner rows, a header at row 4, blank rows, a SECOND banner, and the real
// header at row 13. No parser survives contact with a family of layouts like
// this, and there is a new one every issuer.
const harHaBituach: unknown[][] = [
  [],
  [null, null, null, 'כיסויי השב"ן שלך, הופקו מאתר כלי מסביר ביטוח, בתאריך 6/12/2026'],
  [],
  ['תעודת זהות', 'ענף (משני)', 'סוג מוצר', 'חברה', 'תקופת כיסוי', 'פרמיה בש"ח', 'סוג פרמיה'],
  [], [], [], [], [], [],
  [null, null, null, 'התיק הביטוחי, הופק מאתר כלי מסביר ביטוח, בתאריך 6/12/2026'],
  [],
  ['תעודת זהות', 'ענף ראשי', 'ענף (משני)', 'סוג מוצר', 'חברה', 'תקופת ביטוח', 'פרמיה בש"ח', 'סוג פרמיה', 'מספר פוליסה'],
  ['322686155', 'ביטוח בריאות', 'ייעוץ ובדיקות', 'אישי', 'איילון ביטוח', '5/1/2026 - 5/1/2099', 48.99, 'חודשית', '843045'],
  ['322686155', 'ביטוח בריאות', 'ניתוחים בחו"ל', 'אישי', 'איילון ביטוח', '5/1/2026 - 5/1/2099', 7.11, 'חודשית', '843045'],
  ['322686155', 'ביטוח סיעודי', 'סיעודי עד 3 חודשים', 'קבוצתי קופת חולים', 'הראל ביטוח', 'מתחדש', 14.02, 'חודשית', '789250'],
]

describe('sheetToText', () => {
  it('keeps every row that carries data, in order', () => {
    const text = sheetToText(harHaBituach, 'הר הביטוח.xlsx')
    expect(text).toContain('### הר הביטוח.xlsx')
    expect(text).toContain('ייעוץ ובדיקות')
    expect(text).toContain('48.99')
    expect(text).toContain('הראל ביטוח')
    expect(text.indexOf('ייעוץ ובדיקות')).toBeLessThan(text.indexOf('סיעודי עד 3 חודשים'))
  })

  it('drops fully blank rows, which these layouts are full of', () => {
    const lines = sheetToText(harHaBituach).split('\n')
    expect(lines.every(l => l.trim().length > 0)).toBe(true)
    expect(lines.length).toBeLessThan(harHaBituach.length)
  })

  // Both header rows survive: which one is real is the model's job, and hiding
  // either would be guessing on its behalf.
  it('keeps both header rows, banners included', () => {
    const text = sheetToText(harHaBituach)
    expect(text).toContain('כיסויי השב"ן')
    expect(text).toContain('מספר פוליסה')
  })

  // A blank CELL holds a column's position. Collapsing it would shift every
  // value one column left and silently change what the model reads.
  it('keeps a gap between values but trims the trailing ones', () => {
    const line = sheetToText([['א', '', 'ג', '', '']]).split('\n')[0]
    expect(line).toBe('א\t\tג')
  })

  it('renders a date cell as a date, not as an object', () => {
    expect(sheetToText([[new Date('2026-06-05T00:00:00Z'), 100]])).toContain('2026-06-05')
  })

  it('says so when it truncates, instead of trailing off', () => {
    const many = Array.from({ length: MAX_SHEET_ROWS + 50 }, (_, i) => [`שורה ${i}`, i])
    const text = sheetToText(many)
    expect(text).toContain('נקטעה')
    expect(text).toContain(`${MAX_SHEET_ROWS + 50}`)
  })

  it('is empty for a sheet with nothing in it', () => {
    expect(sheetToText([[], [null, ''], []])).toBe('')
  })
})

// Only consulted for a file dropped into the catch-all with no question behind
// it. A file attached to a question never needs it — the question already said.
describe('looksLikeStatement', () => {
  it('recognises a statement by its money and date columns', () => {
    expect(looksLikeStatement([['תאריך', 'שם בית עסק', 'סכום חיוב']])).toBe(true)
    expect(looksLikeStatement([['תאריך ערך', 'תיאור', 'חובה', 'זכות', 'יתרה']])).toBe(true)
  })

  it('does not mistake an insurance inventory for a statement', () => {
    expect(looksLikeStatement(harHaBituach)).toBe(false)
  })

  it('needs both — a table of amounts with no dates is not a statement', () => {
    expect(looksLikeStatement([['שם', 'סכום', 'אחוז']])).toBe(false)
    expect(looksLikeStatement([['תאריך', 'הערה']])).toBe(false)
  })

  it('looks past the first row, since these headers sit deep', () => {
    const deep: unknown[][] = [...Array.from({ length: 8 }, () => []), ['תאריך', 'סכום חיוב']]
    expect(looksLikeStatement(deep)).toBe(true)
  })
})
