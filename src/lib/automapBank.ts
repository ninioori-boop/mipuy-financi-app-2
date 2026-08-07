// Bank-statement (עו"ש) reading FOR THE AUTOMAP LAB ONLY.
//
// Why this file exists: the lab used to run every uploaded Excel through
// extractTransactions() — the CREDIT parser. detectColumns() there looks for
// "סכום חיוב" / "סכום עסקה" and has no concept of חובה (money out) vs זכות
// (money in), so on a bank export it fell back to positional detection and took
// the first number in the row. On a salary row the חובה cell is empty, so the
// salary itself was taken, and isRefund is derived from `amount < 0` alone —
// meaning the client's salary was counted as an EXPENSE. Income was the least
// accurate section in the whole tool, and this was why.
//
// The direction logic already exists and is tested: bankParse.ts, used by the
// עו"ש tab. We IMPORT it and change nothing there.
//
// The row-shape helpers below (pickDesc / pickDate / looksLikeTransaction) are
// deliberate near-duplicates of local functions inside src/app/app/bank/page.tsx.
// They are not exported there, and extracting them would mean editing a live
// tab that ~40 paying clients use. Duplicating ~20 lines is the cheaper risk.
// If these two ever need to agree, unify them as a separate, reviewed change.

import { detectCols, classifyRow, cellNum, type BankCols, type Dir } from './bankParse'

export interface BankRow {
  desc:   string
  amount: number   // always positive; `dir` carries the direction
  date:   string   // YYYY-MM-DD, or '' when the row had no real Date cell
  dir:    Dir
}

/** How many leading rows to scan for a header before giving up. */
const HEADER_SCAN_ROWS = 15

// Words that identify a BANK statement header, checked here rather than trusting
// detectCols' own matching. detectCols treats 'חיוב' as a debit column, and a
// credit-card export's header says "סכום חיוב" — so relying on it would route
// every credit file into the bank reader and break the path that works today.
// None of these words appear in a credit-card export.
const BANK_IN_WORDS  = ['זכות', 'זיכוי', 'הפקדה']
const BANK_OUT_WORDS = ['חובה', 'משיכה']       // deliberately NOT 'חיוב'

/**
 * Locate the header row of a bank statement. Returns null when the file has no
 * bank-shaped header, which is the signal to leave it on the credit parser.
 *
 * A statement whose only amount column is a single signed one (no חובה/זכות)
 * returns null too, and therefore behaves exactly as it does today. That is a
 * deliberate no-regression choice, not full coverage.
 */
export function detectBankHeader(rows: unknown[][]): { headerIdx: number; cols: BankCols } | null {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS)
  for (let r = 0; r < limit; r++) {
    const row = rows[r]
    if (!row || !row.length) continue
    const words = row.map(c => (typeof c === 'string' ? c.trim() : ''))
    const isBank =
      words.some(w => BANK_IN_WORDS.some(k => w.includes(k))) ||
      words.some(w => BANK_OUT_WORDS.some(k => w.includes(k)))
    if (!isBank) continue
    const cols = detectCols(row)
    if (cols.debitCol >= 0 || cols.creditCol >= 0) return { headerIdx: r, cols }
  }
  return null
}

/** The most human-readable string in the row — mirrors the עו"ש tab's heuristic. */
function pickDesc(row: unknown[]): string {
  for (const c of row) {
    if (typeof c !== 'string') continue
    const s = c.trim()
    if (s.length < 2) continue
    // Mostly letters, not a date/reference/amount rendered as text.
    const letters = s.replace(/[\d\-.\/\s,]/g, '').length
    if (letters / s.length > 0.4) return s
  }
  for (const c of row) {
    if (typeof c === 'string' && c.trim().length > 2) return c.trim()
  }
  return ''
}

/**
 * ISO date from the row's first real Date cell.
 *
 * Local getters, not toISOString: Israel is UTC+3, so a local-midnight Date
 * serialized via ISO lands on the previous day (same reasoning as parsing.ts).
 * ISO specifically — the עו"ש tab renders he-IL for display, but detectMonthSpan
 * only counts YYYY-MM-DD, and the months field it guards is the single input
 * that can silently inflate an entire mapping.
 */
function pickDate(row: unknown[]): string {
  for (const c of row) {
    if (c instanceof Date && !isNaN(c.getTime())) {
      return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`
    }
  }
  return ''
}

/** A data row, as opposed to a header, a spacer, or a running-total line. */
function looksLikeTransaction(row: unknown[], cols: BankCols): boolean {
  if (!row || !row.length) return false
  const filled = row.filter(c => c !== null && c !== undefined && c !== '').length
  if (filled < 3) return false
  const credit = cols.creditCol >= 0 ? cellNum(row[cols.creditCol]) : null
  const debit  = cols.debitCol  >= 0 ? cellNum(row[cols.debitCol])  : null
  const hasAmount = (credit !== null && Math.abs(credit) > 0) || (debit !== null && Math.abs(debit) > 0)
  // Fall back to "has a Date and some number" only when neither named column
  // carried a value, so a statement without חובה/זכות still yields rows.
  return hasAmount || (row.some(c => c instanceof Date) && row.some(c => typeof c === 'number' && Math.abs(c) > 0))
}

const foldQuotes = (s: string) => s.replace(/["'׳״]/g, '').toLowerCase()
const SKIP_DESC = ['סה"כ', 'סהכ', 'יתרת פתיחה', 'יתרת סגירה', 'total'].map(foldQuotes)

/**
 * Read a bank statement into directional rows. Amounts are always positive;
 * `dir` says whether the money came in or went out.
 */
export function extractBankRows(rows: unknown[][]): BankRow[] {
  const header = detectBankHeader(rows)
  if (!header) return []
  const { headerIdx, cols } = header

  const out: BankRow[] = []
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r]
    if (!looksLikeTransaction(row, cols)) continue
    const desc = pickDesc(row)
    if (!desc) continue
    const folded = foldQuotes(desc)
    if (SKIP_DESC.some(p => folded.includes(p))) continue
    const { amount, dir } = classifyRow(row, cols)
    if (!(amount > 0)) continue
    out.push({ desc, amount, date: pickDate(row), dir })
  }
  return out
}

// A card-settlement line in the bank ("פירעון כרטיסי אשראי", "תשלום לישראכרט")
// is a SUMMARY of the credit statement, not a purchase. Counting it alongside
// the credit file's own detail double-counts the client's entire card spend.
//
// The list is deliberately conservative and anchored on settlement wording, not
// on brand names alone: "מקס" and "ויזה" appear inside ordinary merchant names,
// and wrongly dropping a real expense is worse than leaving one summary line in
// — the prompt still warns the model about them, and the UI shows what was
// removed. Each entry must read as "a payment to a card issuer".
// ⚠️ Every entry must be a phrase no ordinary merchant name can contain.
// A bare 'כאל' is the trap: fold the gershayim out of כ״א״ל and it also matches
// inside מיכאל, so "מיכאל שיפוצים" would be silently dropped from the client's
// expenses. Issuer names are kept only where they are distinctive on their own.
const SETTLEMENT_PATTERNS = [
  'פירעון אשראי', 'פרעון אשראי',
  'פירעון כרטיסי אשראי', 'פרעון כרטיסי אשראי',
  'תשלום כרטיס אשראי', 'תשלום כרטיסי אשראי',
  'כרטיסי אשראי', 'כרטיס אשראי',
  'חיוב כרטיס',
  'לאומי קארד', 'ישראכרט', 'אמריקן אקספרס',
  'מקס איט פיננסים',
  'ויזה כאל', 'ויזה קאל',
].map(foldQuotes)

/** True when the bank line is a card settlement rather than a purchase. */
export function isCardSettlement(desc: string): boolean {
  const s = foldQuotes(desc.trim())
  if (!s) return false
  return SETTLEMENT_PATTERNS.some(p => s.includes(p))
}
