import type { ColumnMap, InstallmentInfo, Transaction } from '@/types/transaction'
import { categorize } from './categorize'

export function detectColumns(headerRow: unknown[]): ColumnMap {
  let descCol = -1, chargeAmountCol = -1, transactionAmountCol = -1, amountCol = -1, notesCol = -1, dateCol = -1

  const descKeywords    = ['שם בית עסק', 'שם בית העסק', 'בית עסק', 'שם העסק', 'תיאור', 'פרטים', 'תיאור עסקה']
  const notesKeywords   = ['פירוט נוסף', 'הערות', 'הערה', 'פרטים נוספים', 'תשלומים', 'מידע נוסף', 'סוג עסקת אשראי']
  const dateKeywords    = ['תאריך רכישה', 'תאריך עסקה', 'תאריך', 'date']

  headerRow.forEach((cell, i) => {
    const t = String(cell ?? '').trim()
    if (descCol === -1 && descKeywords.some(k => t.includes(k))) descCol = i
    if (chargeAmountCol === -1 && (
      t === 'סכום חיוב' || t.includes('סכום חיוב') ||
      t.includes('סה"כ לחיוב') || t.includes('לחיוב בש') ||
      t.includes('סכום בש"ח') || t.includes('סכום לחיוב')
    )) chargeAmountCol = i
    if (transactionAmountCol === -1 && (
      t.includes('סכום עסקה') || t.includes('סכום העסקה')
    )) transactionAmountCol = i
    if (amountCol === -1 && (t.includes('סכום') || t.includes('חיוב')) &&
        !t.includes('עסקה') && !t.includes('מטבע') && !t.includes('תאריך')) amountCol = i
    if (notesCol === -1 && notesKeywords.some(k => t.includes(k))) notesCol = i
    if (dateCol === -1 && dateKeywords.some(k => t.includes(k))) dateCol = i
  })

  const primaryAmountCol = chargeAmountCol !== -1 ? chargeAmountCol : amountCol
  return { descCol, amountCol: primaryAmountCol, chargeAmountCol, transactionAmountCol, notesCol, dateCol }
}

export function parseAmount(val: unknown): number {
  if (val === null || val === undefined) return NaN
  if (typeof val === 'number') return val
  const str = String(val).trim()
  const hasParens = str.includes('(')
  const cleaned = str.replace(/[(),\s₪]/g, '').replace(/,/g, '')
  const num = parseFloat(cleaned)
  if (isNaN(num)) return NaN
  return hasParens ? -Math.abs(num) : num
}

export function extractInstallmentInfo(notes: unknown): InstallmentInfo | null {
  if (!notes) return null
  const s = String(notes).trim()

  let m = s.match(/תשלום\s+(\d+)\s+מתוך\s+(\d+)/)
  if (m) return { current: parseInt(m[1]), total: parseInt(m[2]) }

  m = s.match(/(\d+)\s*מתוך\s*(\d+)/)
  if (m) {
    const c = parseInt(m[1]), t = parseInt(m[2])
    if (c > 0 && t > 1 && t <= 60 && c <= t) return { current: c, total: t }
  }

  m = s.match(/(\d+)\s*[\/\-]\s*(\d+)/)
  if (m) {
    const c = parseInt(m[1]), t = parseInt(m[2])
    if (c > 0 && t > 1 && t <= 60 && c <= t) return { current: c, total: t }
  }

  return null
}

export function isStandingOrderDesc(desc: string): boolean {
  const d = desc.toLowerCase()
  return d.includes('הוראת קבע') || d.includes('הוראות קבע') ||
         d.includes('הו"ק') || d.includes("הו'ק") || d.includes('הו ק') ||
         d.includes('standing order') || d.includes('direct debit')
}

export function extractTransactions(
  rows: unknown[][],
  fileName: string,
  learnedDB: Record<string, string> = {},
): Transaction[] {
  let headerRowIdx = -1
  let descCol = -1, amountCol = -1, transactionAmountCol = -1, notesCol = -1, dateCol = -1

  // Scan the WHOLE sheet — Israeli card statements (Isracard/Max) often start
  // with a summary block, so the real header can be well past row 15.
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (!row || !row.length) continue
    const detected = detectColumns(row)
    if (detected.descCol !== -1 && detected.amountCol !== -1) {
      headerRowIdx        = r
      descCol             = detected.descCol
      amountCol           = detected.amountCol
      transactionAmountCol = detected.transactionAmountCol
      notesCol            = detected.notesCol
      dateCol             = detected.dateCol
      break
    }
  }

  // Fallback: look for Hebrew text + numeric pair
  if (headerRowIdx === -1) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      if (!row) continue
      let dCol = -1
      for (let c = 0; c < row.length; c++) {
        const cell = String(row[c] ?? '')
        if (/[֐-׿]/.test(cell) && cell.length > 3) { dCol = c; break }
      }
      if (dCol !== -1) {
        let aCol = -1
        for (let c = 0; c < row.length; c++) {
          if (c === dCol) continue
          const num = parseAmount(row[c])
          if (!isNaN(num) && Math.abs(num) > 0 && Math.abs(num) < 50000) { aCol = c; break }
        }
        if (aCol !== -1) { headerRowIdx = r - 1; descCol = dCol; amountCol = aCol; break }
      }
    }
  }

  if (descCol === -1 || amountCol === -1) return []

  const transactions: Transaction[] = []
  const SKIP_PATTERNS = ['סה"כ', 'סהכ', 'לחיוב', '===', 'TOTAL FOR']

  // Current column map — re-synced whenever a new section header appears mid-sheet.
  // Multi-card statements stack "בארץ" then "בחו"ל" (the latter has an extra
  // "מטבע מקורי" column), so each section must be read with its own columns.
  let curDesc = descCol, curAmount = amountCol, curTxAmount = transactionAmountCol
  let curNotes = notesCol, curDate = dateCol

  for (let r = Math.max(0, headerRowIdx + 1); r < rows.length; r++) {
    const row = rows[r]
    if (!row || !row.length) continue

    // A new section header → re-sync columns and skip the header row itself.
    const reDetect = detectColumns(row)
    if (reDetect.descCol !== -1 && reDetect.amountCol !== -1) {
      curDesc = reDetect.descCol; curAmount = reDetect.amountCol
      curTxAmount = reDetect.transactionAmountCol; curNotes = reDetect.notesCol; curDate = reDetect.dateCol
      continue
    }

    const desc   = String(row[curDesc] ?? '').trim()
    const amount = parseAmount(row[curAmount])
    if (!desc || isNaN(amount) || amount === 0) continue
    if (SKIP_PATTERNS.some(p => desc.includes(p))) continue

    const notes = curNotes !== -1 ? String(row[curNotes] ?? '').trim() : ''
    const dateRaw = curDate !== -1 ? row[curDate] : null
    const dateStr = dateRaw ? String(dateRaw).substring(0, 10) : ''
    const installment = extractInstallmentInfo(notes)
    const standingOrder = isStandingOrderDesc(desc) || isStandingOrderDesc(notes)
    const isRefund = amount < 0

    const originalAmount = (installment && curTxAmount !== -1)
      ? Math.abs(parseAmount(row[curTxAmount]) ?? 0)
      : null

    transactions.push({
      id: Math.random().toString(36).slice(2),
      desc,
      amount: Math.abs(amount),
      originalAmount,
      category: categorize(desc, learnedDB),
      source: fileName,
      notes,
      date: dateStr,
      installment,
      isStandingOrder: standingOrder,
      isRefund,
    })
  }

  return transactions
}
