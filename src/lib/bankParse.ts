// Pure helpers for classifying bank-statement (עו"ש) rows by direction:
// a charge (חיוב — money out) vs. an incoming credit/transfer (זכות — money in).
// Kept framework-free so they can be unit-tested in isolation.

export type Dir = 'in' | 'out'   // in = money entered the account, out = a charge

export interface BankCols {
  debitCol:   number   // חובה / חיוב — money out
  creditCol:  number   // זכות / זיכוי / הפקדה — money in
  balanceCol: number   // יתרה — running balance (excluded from amount detection)
}

/**
 * Locate the debit / credit / balance columns from the header row by keyword.
 * Israeli bank exports usually have separate "חובה" and "זכות" columns; when
 * they don't, these stay -1 and classifyRow falls back to the amount's sign.
 */
export function detectCols(header: unknown[]): BankCols {
  let debitCol = -1, creditCol = -1, balanceCol = -1
  header.forEach((c, i) => {
    if (typeof c !== 'string') return
    const s = c.trim()
    if (creditCol < 0 && (s.includes('זכות') || s.includes('זיכוי') || s.includes('הפקדה'))) creditCol = i
    else if (debitCol < 0 && (s.includes('חובה') || s.includes('חיוב') || s.includes('משיכה'))) debitCol = i
    if (balanceCol < 0 && s.includes('יתרה')) balanceCol = i
  })
  return { debitCol, creditCol, balanceCol }
}

export function cellNum(c: unknown): number | null {
  if (c === null || c === undefined || c === '' || c instanceof Date) return null
  const v = typeof c === 'number' ? c : parseFloat(String(c).replace(/,/g, ''))
  return isNaN(v) ? null : v
}

/**
 * Positional fallback (no חובה/זכות columns): collect numbers, drop the balance
 * column, and return the transaction amount KEEPING its sign so direction can be
 * inferred (negative = charge, positive = money in).
 */
export function guessAmountSigned(row: unknown[], balanceCol: number): number {
  const vals: number[] = []
  row.forEach((c, idx) => {
    if (idx === balanceCol || c instanceof Date) return
    const raw = cellNum(c)
    if (raw !== null && Math.abs(raw) > 0 && Math.abs(raw) < 1_000_000) vals.push(raw)
  })
  if (vals.length === 0) return 0
  // balance excluded → last number is the amount; otherwise balance is the last
  // number and the amount is the one before it (mirrors the old nums[1] heuristic).
  return balanceCol >= 0 ? vals[vals.length - 1]
       : vals.length >= 2 ? vals[vals.length - 2]
       : vals[0]
}

/** Determine the amount (always positive) and the direction of a row. */
export function classifyRow(row: unknown[], cols: BankCols): { amount: number; dir: Dir } {
  const credit = cols.creditCol >= 0 ? cellNum(row[cols.creditCol]) : null
  const debit  = cols.debitCol  >= 0 ? cellNum(row[cols.debitCol])  : null
  if (credit !== null && Math.abs(credit) > 0) return { amount: Math.round(Math.abs(credit)), dir: 'in' }
  if (debit  !== null && Math.abs(debit)  > 0) return { amount: Math.round(Math.abs(debit)),  dir: 'out' }
  const signed = guessAmountSigned(row, cols.balanceCol)
  return { amount: Math.round(Math.abs(signed)), dir: signed < 0 ? 'out' : 'in' }
}
