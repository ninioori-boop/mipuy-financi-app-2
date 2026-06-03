'use client'

import React, { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useMappingStore } from '@/stores/mappingStore'
import { useBankStore } from '@/stores/bankStore'
import { parseExcelFile } from '@/lib/parseExcel'
import { FileDropzone } from '@/components/credit/FileDropzone'

type BankSection = 'fixed' | 'variable' | 'sub' | 'ins' | 'annual'

const SECTIONS: { id: BankSection; label: string; cls: string }[] = [
  { id: 'fixed',    label: 'קבועות',  cls: 'text-blue-400   border-blue-400/40   bg-blue-400/10   hover:bg-blue-400/25' },
  { id: 'variable', label: 'משתנות',  cls: 'text-purple-400 border-purple-400/40 bg-purple-400/10 hover:bg-purple-400/25' },
  { id: 'sub',      label: 'מנויים',  cls: 'text-cyan-400   border-cyan-400/40   bg-cyan-400/10   hover:bg-cyan-400/25' },
  { id: 'ins',      label: 'ביטוחים', cls: 'text-orange-400 border-orange-400/40 bg-orange-400/10 hover:bg-orange-400/25' },
  { id: 'annual',   label: 'שנתיות',  cls: 'text-gold       border-gold/40       bg-gold/10       hover:bg-gold/25' },
]

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toLocaleDateString('he-IL')
  return String(v)
}

// prefer strings with actual Hebrew / Latin text (skip reference numbers like "202-375561866")
function guessDesc(row: unknown[]): string {
  for (const c of row) {
    if (typeof c !== 'string') continue
    const s = c.trim()
    if (s.length < 2) continue
    const letters = s.replace(/[\d\-\.\/\s,]/g, '').length
    if (letters / s.length > 0.4) return s   // mostly letters → real description
  }
  for (const c of row) {
    if (typeof c === 'string' && c.trim().length > 2) return c.trim()
  }
  return ''
}

// Bank statements: last col = balance (יתרה), second-to-last = debit/credit (חיוב/זכות)
// Skip the last number (balance) and take the second — that's the transaction amount
function guessAmount(row: unknown[]): number {
  const nums: number[] = []
  for (const c of [...row].reverse()) {
    if (c instanceof Date) continue
    const raw = typeof c === 'number' ? c : parseFloat(String(c).replace(/,/g, ''))
    if (!isNaN(raw) && Math.abs(raw) > 0 && Math.abs(raw) < 1_000_000) {
      nums.push(Math.round(Math.abs(raw)))
    }
  }
  // nums[0] = balance/יתרה, nums[1] = debit amount/חיוב
  return nums[1] ?? nums[0] ?? 0
}

interface PickerState { desc: string; amount: number }

export default function BankPage() {
  // persistent state (survives tab switches)
  const { rawRows, fileName, sentRows: sentArr, reportMonths, setData, markSent, setReportMonths, reset } = useBankStore()
  const sentRows = new Set(sentArr)

  // ephemeral UI state (OK to reset on remount)
  const [isLoading, setIsLoading] = useState(false)
  const [activeRow, setActiveRow] = useState<number | null>(null)
  const [picker, setPicker]       = useState<PickerState>({ desc: '', amount: 0 })

  const { importFromBank } = useMappingStore()

  const handleFiles = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    setIsLoading(true)
    try {
      const rows = await parseExcelFile(file)
      setData(rows, file.name)
      setActiveRow(null)
    } catch (e) {
      toast.error('שגיאה בפענוח הקובץ: ' + (e as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [setData])

  const colCount  = rawRows.reduce((max, r) => Math.max(max, r.length), 0)

  // header row = the row with the most string cells (column labels)
  const headerIdx = rawRows.reduce((best, r, i) =>
    r.filter(c => typeof c === 'string' && (c as string).trim()).length >
    (rawRows[best]?.filter(c => typeof c === 'string' && (c as string).trim()).length ?? 0)
      ? i : best
  , 0)
  const headerRow = rawRows[headerIdx] ?? []

  // transaction row = has a date + at least one number (amount)
  function isTransaction(r: unknown[]): boolean {
    const hasDate   = r.some(c => c instanceof Date)
    const hasNumber = r.some(c => typeof c === 'number' && Math.abs(c) > 0)
    const filled    = r.filter(c => c !== null && c !== undefined && c !== '').length
    return hasDate && hasNumber && filled >= 3
  }

  const allData    = rawRows.map((r, i) => ({ r, origIdx: i })).filter(({ origIdx }) => origIdx !== headerIdx)
  const txRows     = allData.filter(({ r }) => isTransaction(r))
  const metaRows   = allData.filter(({ r }) =>
    !isTransaction(r) && r.some(c => c !== null && c !== undefined && c !== '')
  )
  // extract useful metadata strings (non-empty, non-date, length > 1)
  const metaStrings = [...new Set(
    metaRows.flatMap(({ r }) =>
      r.filter(c => typeof c === 'string' && (c as string).trim().length > 1)
       .map(c => (c as string).trim())
    )
  )]

  function openPicker(listIdx: number, row: unknown[]) {
    if (activeRow === listIdx) { setActiveRow(null); return }
    setPicker({ desc: guessDesc(row), amount: guessAmount(row) })
    setActiveRow(listIdx)
  }

  function sendRow(listIdx: number, section: BankSection) {
    const { desc, amount } = picker
    if (!desc.trim() && amount === 0) {
      toast.error('הזן תיאור או סכום')
      return
    }
    // If the statement covers multiple months, the picked amount usually
    // represents the total for the whole period — divide to get a monthly
    // figure. reportMonths defaults to 1 (no change), so this is opt-in.
    const divisor = Math.max(1, reportMonths)
    const monthlyAmount = Math.round(amount / divisor)
    importFromBank([{ name: desc.trim() || `שורה ${listIdx + 1}`, amount: monthlyAmount, section }])
    markSent(listIdx)
    setActiveRow(null)
    const secLabel = SECTIONS.find(s => s.id === section)?.label ?? section
    const divNote = divisor > 1 ? ` (${amount} ÷ ${divisor} = ${monthlyAmount})` : ''
    toast.success(`✅ "${desc.trim() || `שורה ${listIdx + 1}`}" נשלח ל${secLabel}${divNote}`)
  }

  function handleMonthsChange(delta: number) {
    setReportMonths(reportMonths + delta)
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-6">
        <h1 className="text-2xl font-bold text-gold mb-1">🏦 דוח עו&quot;ש</h1>
        <p className="text-muted-txt text-sm">
          העלה קובץ בנק · לחץ <strong className="text-txt">+</strong> על שורה · ערוך תיאור/סכום אם צריך · בחר קטגוריה
        </p>
      </div>

      {/* Upload */}
      <div className="rounded-xl border border-line bg-surface2 p-6 space-y-4">
        <FileDropzone onFiles={handleFiles} isLoading={isLoading} />

        {/* Months selector — divides the picked amount by this number before sending */}
        <div className="flex items-center gap-4 bg-surface border border-line rounded-xl px-4 py-3 flex-wrap">
          <span className="text-lg">📅</span>
          <div className="flex-1 min-w-[140px]">
            <div className="text-sm font-semibold text-txt">מספר חודשים שהדוח מכסה</div>
            <div className="text-xs text-muted-txt mt-0.5">
              אם הדוח של חודש בודד, השאר 1. אם של 2-3 חודשים — הסכום שתבחר יחולק אוטומטית למספר חודשי.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleMonthsChange(-1)}
              className="w-8 h-8 rounded-lg bg-line text-txt hover:bg-gold/20 transition-colors text-base font-bold"
            >−</button>
            <input
              type="number"
              value={reportMonths}
              min={1}
              max={24}
              onChange={e => setReportMonths(parseInt(e.target.value) || 1)}
              className="w-12 text-center bg-bg border border-gold rounded-lg text-gold font-bold text-base py-1 focus:outline-none"
              style={{ direction: 'ltr' }}
            />
            <button
              onClick={() => handleMonthsChange(1)}
              className="w-8 h-8 rounded-lg bg-line text-txt hover:bg-gold/20 transition-colors text-base font-bold"
            >+</button>
            <span className="text-sm text-gold/80 font-semibold min-w-[110px]">
              {reportMonths === 1 ? 'ללא חלוקה' : `חלוקה ל-${reportMonths} חודשים`}
            </span>
          </div>
        </div>

        {fileName && (
          <div className="text-xs text-muted-txt flex items-center gap-3">
            <span>📄 {fileName}</span>
            <span>·</span>
            <span>{txRows.length} שורות</span>
            {sentRows.size > 0 && (
              <><span>·</span><span className="text-green-400">✓ {sentRows.size} נשלחו למיפוי</span></>
            )}
            <button
              onClick={() => { reset(); setActiveRow(null) }}
              className="mr-auto text-xs px-2.5 py-1 rounded-lg border border-line text-muted-txt hover:text-expense hover:border-expense/40 transition-colors"
            >
              🗑 נקה והתחל מחדש
            </button>
          </div>
        )}
        {isLoading && (
          <div className="flex items-center gap-3 text-sm text-muted-txt">
            <span className="size-4 animate-spin rounded-full border-2 border-gold border-t-transparent" />
            טוען...
          </div>
        )}
      </div>

      {/* Metadata banner */}
      {metaStrings.length > 0 && (
        <div className="rounded-xl border border-line bg-surface2 px-4 py-3 flex flex-wrap gap-x-4 gap-y-1">
          {metaStrings.map((s, i) => (
            <span key={i} className="text-xs text-muted-txt">{s}</span>
          ))}
        </div>
      )}

      {/* Transaction table */}
      {txRows.length > 0 && (
        <div className="rounded-xl border border-line bg-surface2 overflow-hidden">
          <div className="p-4 border-b border-line flex items-center justify-between">
            <h2 className="font-semibold text-txt">📋 עסקאות</h2>
            <span className="text-xs text-muted-txt">{txRows.length} עסקאות</span>
          </div>

          <div className="overflow-x-auto">
            {(() => {
              // detect column types from first transaction row
              const sample = txRows[0]?.r ?? []
              const colTypes = Array.from({ length: colCount }, (_, i) => {
                const v = sample[i]
                if (v instanceof Date)              return 'date'
                if (typeof v === 'number')          return 'num'
                return 'text'
              })

              return (
                <table style={{ borderCollapse: 'collapse', direction: 'rtl', width: '100%' }}>
                  <colgroup>
                    {colTypes.map((t, i) => (
                      <col key={i} style={{ width: t === 'date' ? '110px' : t === 'num' ? '100px' : 'auto', minWidth: t === 'text' ? '160px' : undefined }} />
                    ))}
                    <col style={{ width: '44px' }} />
                  </colgroup>

                  {/* Header */}
                  <thead>
                    <tr style={{ backgroundColor: '#1e1e1e' }}>
                      {Array.from({ length: colCount }, (_, i) => (
                        <th key={i} style={{
                          padding: '8px 12px',
                          textAlign: colTypes[i] === 'num' ? 'left' : 'right',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: '#8A8178',
                          whiteSpace: 'nowrap',
                          border: '1px solid #2A2A2A',
                          direction: colTypes[i] === 'num' ? 'ltr' : 'rtl',
                        }}>
                          {cellStr(headerRow[i]) || `עמ׳ ${i + 1}`}
                        </th>
                      ))}
                      <th style={{ width: '44px', border: '1px solid #2A2A2A', position: 'sticky', left: 0, backgroundColor: '#1e1e1e', zIndex: 10 }} />
                    </tr>
                  </thead>

                  <tbody>
                    {txRows.map(({ r: row, origIdx }: { r: unknown[]; origIdx: number }, listIdx: number) => {
                      const isSent  = sentRows.has(listIdx)
                      const isOpen  = activeRow === listIdx
                      const rowBg   = isOpen ? '#1a1800' : listIdx % 2 === 0 ? '#111111' : '#161616'

                      return (
                        <React.Fragment key={origIdx}>
                          {/* Data row */}
                          <tr
                            style={{ backgroundColor: isSent ? undefined : rowBg, opacity: isSent ? 0.4 : 1 }}
                            className="group">
                            {Array.from({ length: colCount }, (_, ci) => {
                              const v      = row[ci]
                              const isDate = v instanceof Date
                              const isNum  = typeof v === 'number' && !isDate
                              return (
                                <td key={ci} style={{
                                  padding: '7px 12px',
                                  fontSize: '13px',
                                  color: '#F0EDEA',
                                  whiteSpace: 'nowrap',
                                  border: '1px solid #2A2A2A',
                                  textAlign: isNum ? 'left' : 'right',
                                  direction: isNum ? 'ltr' : 'rtl',
                                  fontVariantNumeric: 'tabular-nums',
                                }}>
                                  {isDate
                                    ? (v as Date).toLocaleDateString('he-IL')
                                    : isNum && (v as number) === 0
                                      ? ''
                                      : isNum
                                        ? (v as number).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                        : cellStr(v)}
                                </td>
                              )
                            })}
                            {/* + / ✓ */}
                            <td style={{
                              width: '44px', textAlign: 'center',
                              border: '1px solid #2A2A2A',
                              position: 'sticky', left: 0, zIndex: 10,
                              backgroundColor: isSent ? undefined : rowBg,
                            }}>
                              {isSent ? (
                                <span style={{ color: '#4ade80', fontSize: '16px' }}>✓</span>
                              ) : (
                                <button
                                  onClick={() => openPicker(listIdx, row)}
                                  style={{
                                    width: '26px', height: '26px',
                                    borderRadius: '50%',
                                    border: isOpen ? '1px solid rgba(201,168,108,0.6)' : '1px solid rgba(201,168,108,0.3)',
                                    background: isOpen ? 'rgba(201,168,108,0.25)' : 'rgba(201,168,108,0.1)',
                                    color: '#C9A86C',
                                    fontSize: '18px',
                                    lineHeight: 1,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    opacity: isOpen ? 1 : 0,
                                    transition: 'opacity 0.15s',
                                  }}
                                  className="group-hover:!opacity-100"
                                >+</button>
                              )}
                            </td>
                          </tr>

                          {/* Picker row */}
                          {isOpen && (
                            <tr key={`${origIdx}-p`} style={{ backgroundColor: '#1a1800', borderBottom: '2px solid rgba(201,168,108,0.3)' }}>
                              <td colSpan={colCount + 1} style={{ padding: '10px 14px', border: '1px solid #2A2A2A' }}>
                                <div className="flex items-center gap-3 flex-wrap" dir="rtl">
                                  <input
                                    value={picker.desc}
                                    onChange={e => setPicker(p => ({ ...p, desc: e.target.value }))}
                                    placeholder="תיאור"
                                    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt focus:outline-none focus:border-gold/60 min-w-[160px] flex-1"
                                  />
                                  <div className="flex items-center gap-1">
                                    <span className="text-xs text-muted-txt">₪</span>
                                    <input
                                      type="number"
                                      value={picker.amount || ''}
                                      onChange={e => setPicker(p => ({ ...p, amount: parseFloat(e.target.value) || 0 }))}
                                      placeholder="סכום"
                                      min={0}
                                      style={{ direction: 'ltr' }}
                                      className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt focus:outline-none focus:border-gold/60 w-24 text-left tabular-nums"
                                    />
                                  </div>
                                  <span className="text-xs text-muted-txt">← העבר ל:</span>
                                  {SECTIONS.map(s => (
                                    <button key={s.id} onClick={() => sendRow(listIdx, s.id)}
                                      className={`px-3 py-1.5 rounded-lg border text-sm font-semibold transition-all ${s.cls}`}>
                                      {s.label}
                                    </button>
                                  ))}
                                  <button onClick={() => setActiveRow(null)}
                                    className="text-muted-txt hover:text-txt text-xs me-auto">ביטול</button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              )
            })()}
          </div>
        </div>
      )}

    </div>
  )
}
