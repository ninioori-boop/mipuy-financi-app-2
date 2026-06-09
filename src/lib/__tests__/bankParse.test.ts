import { describe, it, expect } from 'vitest'
import { detectCols, classifyRow } from '@/lib/bankParse'

describe('detectCols — finds debit/credit/balance columns by header keyword', () => {
  it('detects separate חובה / זכות / יתרה columns', () => {
    const header = ['תאריך', 'תיאור', 'אסמכתא', 'חובה', 'זכות', 'יתרה']
    expect(detectCols(header)).toEqual({ debitCol: 3, creditCol: 4, balanceCol: 5 })
  })

  it('recognises wording variants (בחובה / זיכוי / הפקדה)', () => {
    expect(detectCols(['תאריך', 'פרטים', 'תנועות בחובה', 'זיכוי', 'יתרה בש"ח']))
      .toEqual({ debitCol: 2, creditCol: 3, balanceCol: 4 })
    expect(detectCols(['תאריך', 'תיאור', 'משיכה', 'הפקדה']).creditCol).toBe(3)
  })

  it('returns -1 for columns it cannot find', () => {
    expect(detectCols(['תאריך', 'תיאור', 'סכום'])).toEqual({ debitCol: -1, creditCol: -1, balanceCol: -1 })
  })
})

describe('classifyRow — distinguishes a charge (out) from incoming money (in)', () => {
  // Columns: [date, desc, ref, חובה(3), זכות(4), יתרה(5)]
  const cols = { debitCol: 3, creditCol: 4, balanceCol: 5 }

  it('a value in the credit column → incoming (in)', () => {
    const row = [new Date('2026-06-01'), 'העברה מרינה', '123', '', 5000, 12000]
    expect(classifyRow(row, cols)).toEqual({ amount: 5000, dir: 'in' })
  })

  it('a value in the debit column → charge (out)', () => {
    const row = [new Date('2026-06-02'), 'שופרסל', '124', 312.9, '', 11687.1]
    expect(classifyRow(row, cols)).toEqual({ amount: 313, dir: 'out' })
  })

  it('handles string amounts with thousands separators', () => {
    const row = [new Date('2026-06-03'), 'משכורת', '125', '', '8,540', '20,227']
    expect(classifyRow(row, cols)).toEqual({ amount: 8540, dir: 'in' })
  })
})

describe('classifyRow — fallback to sign when there are no חובה/זכות columns', () => {
  // Single signed amount column + balance; columns not detected.
  const cols = { debitCol: -1, creditCol: -1, balanceCol: 3 }

  it('negative amount → charge (out), stored as a positive number', () => {
    const row = [new Date('2026-06-04'), 'דלק פז', -250, 9000]
    expect(classifyRow(row, cols)).toEqual({ amount: 250, dir: 'out' })
  })

  it('positive amount → incoming (in)', () => {
    const row = [new Date('2026-06-05'), 'החזר מס', 1340, 10340]
    expect(classifyRow(row, cols)).toEqual({ amount: 1340, dir: 'in' })
  })

  it('balance column is excluded so it is not mistaken for the amount', () => {
    // Only the balance is positive; the real (negative) charge must win.
    const row = [new Date('2026-06-06'), 'ארנונה', -540, 8460]
    expect(classifyRow(row, cols).dir).toBe('out')
  })
})
