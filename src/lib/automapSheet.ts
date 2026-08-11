// A spreadsheet that is not a statement, turned into text the model can read.
//
// The lab parses exactly two things: a bank statement and a credit statement.
// Everything else a client uploads is a table with its own shape — a הר הביטוח
// export with two banner rows, a header at row 4, blank rows, a second banner
// and the REAL header at row 13; a pension report; a securities portfolio; a
// loan schedule. Writing a parser per format is a losing race: there are dozens
// of issuers, each with its own layout, and each layout changes.
//
// So they are not parsed. The sheet becomes a compact text table and goes to
// the model, which reads a table the way a person does. That costs input tokens
// (the cheap direction — output is 5x) and needs no parser, no OCR, and no
// maintenance when an issuer moves a column.
//
// 🔴 Before this, an Excel routed to "document" fell between the cases in
// handleFiles: not sent to a parser, not a PDF, not an image — rejected as
// "סוג קובץ לא נתמך" and dropped. A client's insurance report simply vanished.

/** Rows past this are dropped, with a line saying so. */
export const MAX_SHEET_ROWS = 400
/** Characters past this end the table, with a line saying so. */
export const MAX_SHEET_CHARS = 24_000

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).replace(/\s+/g, ' ').trim()
}

/**
 * A sheet as a tab-separated table.
 *
 * Fully-blank rows are dropped: the layouts this exists for are full of them,
 * and they cost tokens while carrying nothing. Blank CELLS are kept, because a
 * column's position is what makes the table readable — collapsing them would
 * shift every value one column left and quietly change what the model reads.
 */
export function sheetToText(rows: unknown[][], name = ''): string {
  const out: string[] = []
  if (name) out.push(`### ${name}`)

  let used = 0
  let kept = 0
  let truncatedAt = 0

  for (let i = 0; i < rows.length; i++) {
    const cells = (rows[i] ?? []).map(cell)
    if (!cells.some(c => c)) continue          // a blank row says nothing
    if (kept >= MAX_SHEET_ROWS) { truncatedAt = i; break }

    // Trailing empties are noise; the ones between values are structure.
    let last = cells.length - 1
    while (last >= 0 && !cells[last]) last--
    const line = cells.slice(0, last + 1).join('\t')

    if (used + line.length > MAX_SHEET_CHARS) { truncatedAt = i; break }
    out.push(line)
    used += line.length + 1
    kept++
  }

  if (truncatedAt) {
    out.push(`… הטבלה נקטעה אחרי ${kept} שורות מתוך ${rows.length}. אם חסר מידע, בקש את הקובץ בנפרד.`)
  }
  return out.join('\n')
}

/**
 * Does this sheet look like a transaction list at all?
 *
 * Used only for a file dropped into the catch-all with no question behind it:
 * if neither parser found anything, the sheet still has to reach the model
 * rather than disappear. A file attached to a QUESTION never needs this — the
 * question already said what it is.
 */
export function looksLikeStatement(rows: unknown[][]): boolean {
  const head = rows.slice(0, 20).map(r => (r ?? []).map(cell).join(' ')).join(' ')
  const money = /סכום|חיוב|זכות|חובה|יתרה|תשלום/.test(head)
  const when  = /תאריך|מועד/.test(head)
  return money && when
}
