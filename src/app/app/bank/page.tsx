'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useMappingStore } from '@/stores/mappingStore'
import { useBankStore } from '@/stores/bankStore'
import { parseExcelFile } from '@/lib/parseExcel'
import { normalizeForLookup } from '@/lib/categorize'
import { FileDropzone } from '@/components/credit/FileDropzone'
import { detectCols, classifyRow, type Dir } from '@/lib/bankParse'

type BankSection = 'fixed' | 'variable' | 'sub' | 'ins' | 'annual'

const SECTIONS: { id: BankSection; label: string; cls: string }[] = [
  { id: 'fixed',    label: 'קבועות',  cls: 'text-blue-400   border-blue-400/40   bg-blue-400/10   hover:bg-blue-400/25' },
  { id: 'variable', label: 'משתנות',  cls: 'text-purple-400 border-purple-400/40 bg-purple-400/10 hover:bg-purple-400/25' },
  { id: 'sub',      label: 'מנויים',  cls: 'text-cyan-400   border-cyan-400/40   bg-cyan-400/10   hover:bg-cyan-400/25' },
  { id: 'ins',      label: 'ביטוחים', cls: 'text-orange-400 border-orange-400/40 bg-orange-400/10 hover:bg-orange-400/25' },
  { id: 'annual',   label: 'שנתיות',  cls: 'text-gold       border-gold/40       bg-gold/10       hover:bg-gold/25' },
]

interface BankTxn {
  desc:    string
  amount:  number
  date:    string | null
  origIdx: number
  dir:     Dir
}

interface BankGroup {
  key:          string
  displayName:  string
  txns:         BankTxn[]
  totalAmount:  number
  count:        number
}

// pick the best human-readable description from a row
function guessDesc(row: unknown[]): string {
  for (const c of row) {
    if (typeof c !== 'string') continue
    const s = c.trim()
    if (s.length < 2) continue
    const letters = s.replace(/[\d\-\.\/\s,]/g, '').length
    if (letters / s.length > 0.4) return s
  }
  for (const c of row) {
    if (typeof c === 'string' && c.trim().length > 2) return c.trim()
  }
  return ''
}

function guessDate(row: unknown[]): string | null {
  for (const c of row) {
    if (c instanceof Date) return (c as Date).toLocaleDateString('he-IL')
  }
  return null
}

function isTransaction(r: unknown[]): boolean {
  const hasDate   = r.some(c => c instanceof Date)
  const hasNumber = r.some(c => typeof c === 'number' && Math.abs(c as number) > 0)
  const filled    = r.filter(c => c !== null && c !== undefined && c !== '').length
  return hasDate && hasNumber && filled >= 3
}

const txNoun = (n: number, dir: Dir) =>
  dir === 'in' ? (n === 1 ? 'זיכוי' : 'זיכויים') : (n === 1 ? 'חיוב' : 'חיובים')

// Group transactions by normalized merchant name. Already-sent rows are
// skipped so a group shrinks as the user sends parts of it.
function groupByMerchant(txns: BankTxn[], sentRows: Set<number>): BankGroup[] {
  const map = new Map<string, BankGroup>()
  for (const t of txns) {
    if (sentRows.has(t.origIdx)) continue
    const key = normalizeForLookup(t.desc) || t.desc.toLowerCase().trim() || `שורה ${t.origIdx + 1}`
    let g = map.get(key)
    if (!g) {
      g = { key, displayName: t.desc.trim() || `שורה ${t.origIdx + 1}`, txns: [], totalAmount: 0, count: 0 }
      map.set(key, g)
    }
    g.txns.push(t)
    g.totalAmount += t.amount
    g.count++
  }
  return [...map.values()].sort((a, b) => b.totalAmount - a.totalAmount)
}

interface PickerState { desc: string; amount: number }

export default function BankPage() {
  const { rawRows, fileName, sentRows: sentArr, reportMonths, setData, markSent, setReportMonths, reset } = useBankStore()
  const sentRows = new Set(sentArr)

  const [isLoading, setIsLoading]       = useState(false)
  const [activeKey, setActiveKey]       = useState<string | null>(null)
  const [picker, setPicker]             = useState<PickerState>({ desc: '', amount: 0 })
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  // Per-transaction manual direction override (keyed by original row index), so
  // the user can flip a whole group if auto-detection got the direction wrong.
  const [dirOverride, setDirOverride]   = useState<Map<number, Dir>>(new Map())

  const { importFromBank } = useMappingStore()

  const handleFiles = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    setIsLoading(true)
    try {
      const rows = await parseExcelFile(file)
      setData(rows, file.name)
      setActiveKey(null)
      setExpandedKeys(new Set())
      setDirOverride(new Map())
    } catch (e) {
      toast.error('שגיאה בפענוח הקובץ: ' + (e as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [setData])

  // header row = the one with the most non-empty string cells
  const headerIdx = rawRows.reduce((best, r, i) =>
    r.filter(c => typeof c === 'string' && (c as string).trim()).length >
    (rawRows[best]?.filter(c => typeof c === 'string' && (c as string).trim()).length ?? 0)
      ? i : best
  , 0)

  const cols = detectCols(rawRows[headerIdx] ?? [])

  // Extract all transactions (with direction), then group each direction apart.
  const allTxns: BankTxn[] = rawRows
    .map((r, i) => ({ r, origIdx: i }))
    .filter(({ origIdx, r }) => origIdx !== headerIdx && isTransaction(r))
    .map(({ r, origIdx }) => {
      const { amount, dir } = classifyRow(r, cols)
      return {
        desc:    guessDesc(r),
        amount,
        date:    guessDate(r),
        origIdx,
        dir:     dirOverride.get(origIdx) ?? dir,
      }
    })

  const outTxns = allTxns.filter(t => t.dir === 'out')
  const inTxns  = allTxns.filter(t => t.dir === 'in')

  const totalTxCount = allTxns.length
  const outGroups    = groupByMerchant(outTxns, sentRows)
  const inGroups     = groupByMerchant(inTxns, sentRows)
  const sentCount    = sentRows.size

  // Metadata strings (account name, period, balance — for the info banner)
  const metaStrings = [...new Set(
    rawRows
      .map((r, i) => ({ r, origIdx: i }))
      .filter(({ origIdx, r }) => origIdx !== headerIdx && !isTransaction(r))
      .flatMap(({ r }) =>
        r.filter(c => typeof c === 'string' && (c as string).trim().length > 1)
         .map(c => (c as string).trim())
      )
  )]

  function openGroup(g: BankGroup) {
    if (activeKey === g.key) { setActiveKey(null); return }
    setPicker({ desc: g.displayName, amount: g.totalAmount })
    setActiveKey(g.key)
  }

  function toggleExpanded(key: string) {
    setExpandedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  function flipGroup(g: BankGroup, currentDir: Dir) {
    const target: Dir = currentDir === 'in' ? 'out' : 'in'
    setDirOverride(prev => {
      const next = new Map(prev)
      for (const t of g.txns) next.set(t.origIdx, target)
      return next
    })
    if (activeKey === g.key) setActiveKey(null)
  }

  function sendGroup(g: BankGroup, section: BankSection) {
    const { desc, amount } = picker
    if (!desc.trim() && amount === 0) { toast.error('הזן תיאור או סכום'); return }
    const divisor       = Math.max(1, reportMonths)
    const monthlyAmount = Math.round(amount / divisor)
    importFromBank([{
      name:    desc.trim() || g.displayName,
      amount:  monthlyAmount,
      section,
    }])
    for (const t of g.txns) markSent(t.origIdx)
    setActiveKey(null)
    const secLabel = SECTIONS.find(s => s.id === section)?.label ?? section
    const divNote  = divisor > 1 ? ` (${amount} ÷ ${divisor} = ${monthlyAmount})` : ''
    toast.success(
      `✅ "${desc.trim() || g.displayName}" (${g.count} ${txNoun(g.count, 'out')}) נשלח ל${secLabel}${divNote}`
    )
  }

  function handleMonthsChange(delta: number) {
    setReportMonths(reportMonths + delta)
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-6">
        <h1 className="text-2xl font-bold text-gold mb-1">🏦 דוח עו&quot;ש</h1>
        <p className="text-muted-txt text-sm">
          העלה קובץ בנק · המערכת מפרידה בין חיובים לזיכויים שנכנסו ומקבצת לפי שם · בחר מה להעביר ולאיזה סעיף
        </p>
      </div>

      {/* Upload + months selector */}
      <div className="rounded-xl border border-line bg-surface2 p-6 space-y-4">
        <FileDropzone onFiles={handleFiles} isLoading={isLoading} />

        <div className="flex items-center gap-4 bg-surface border border-line rounded-xl px-4 py-3 flex-wrap">
          <span className="text-lg">📅</span>
          <div className="flex-1 min-w-[140px]">
            <div className="text-sm font-semibold text-txt">מספר חודשים שהדוח מכסה</div>
            <div className="text-xs text-muted-txt mt-0.5">
              הסכום של כל קבוצה יחולק במספר זה כדי לקבל סכום חודשי (השאר 1 לדוח חודשי בודד).
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => handleMonthsChange(-1)}
              className="w-8 h-8 rounded-lg bg-line text-txt hover:bg-gold/20 transition-colors text-base font-bold">−</button>
            <input type="number" value={reportMonths} min={1} max={24}
              onChange={e => setReportMonths(parseInt(e.target.value) || 1)}
              className="w-12 text-center bg-bg border border-gold rounded-lg text-gold font-bold text-base py-1 focus:outline-none"
              style={{ direction: 'ltr' }} />
            <button onClick={() => handleMonthsChange(1)}
              className="w-8 h-8 rounded-lg bg-line text-txt hover:bg-gold/20 transition-colors text-base font-bold">+</button>
            <span className="text-sm text-gold/80 font-semibold min-w-[110px]">
              {reportMonths === 1 ? 'ללא חלוקה' : `חלוקה ל-${reportMonths} חודשים`}
            </span>
          </div>
        </div>

        {fileName && (
          <div className="text-xs text-muted-txt flex items-center gap-3 flex-wrap">
            <span>📄 {fileName}</span>
            <span>·</span>
            <span>{totalTxCount} עסקאות</span>
            <span>·</span>
            <span className="text-expense">💸 {outTxns.length} חיובים</span>
            <span>·</span>
            <span className="text-green-400">💰 {inTxns.length} נכנסו</span>
            {sentCount > 0 && (
              <><span>·</span><span className="text-green-400">✓ {sentCount} נשלחו</span></>
            )}
            <button
              onClick={() => { reset(); setActiveKey(null); setExpandedKeys(new Set()); setDirOverride(new Map()) }}
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

      {/* ── חיובים (יציאות) ── */}
      {outGroups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold text-txt">💸 חיובים (יציאות מהחשבון)</h2>
            <span className="text-xs text-muted-txt">מסודרים לפי סכום יורד · לחץ קבוצה לבחירת סעיף</span>
          </div>

          {outGroups.map(g => {
            const isOpen     = activeKey === g.key
            const isExpanded = expandedKeys.has(g.key)
            return (
              <div key={g.key}
                className={`rounded-xl border ${isOpen ? 'border-gold/60 bg-gold/5' : 'border-line bg-surface2'} transition-colors`}>

                {/* Summary header */}
                <div className="flex items-stretch">
                  <button
                    onClick={() => openGroup(g)}
                    className="flex-1 p-4 flex items-center gap-3 hover:bg-gold/5 transition-colors text-right min-w-0"
                    dir="rtl"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-txt truncate">{g.displayName}</div>
                      <div className="text-xs text-muted-txt mt-0.5">
                        {g.count} {txNoun(g.count, 'out')} · ממוצע {Math.round(g.totalAmount / g.count).toLocaleString('he-IL')} ₪
                      </div>
                    </div>
                    <div className="text-left shrink-0">
                      <div className="text-lg font-bold text-gold tabular-nums">
                        {g.totalAmount.toLocaleString('he-IL')} ₪
                      </div>
                      <div className="text-[10px] text-muted-txt">סה&quot;כ בקבוצה</div>
                    </div>
                    <span className="text-gold text-xl shrink-0 w-5 text-center">{isOpen ? '−' : '+'}</span>
                  </button>
                  <button
                    onClick={() => flipGroup(g, 'out')}
                    title="זה בעצם זיכוי / כסף שנכנס — העבר לקבוצת הנכנסים"
                    className="px-3 border-s border-line text-muted-txt hover:text-green-400 hover:bg-green-400/5 transition-colors text-sm shrink-0"
                  >
                    ⇄
                  </button>
                </div>

                {/* Picker */}
                {isOpen && (
                  <div className="border-t border-gold/30 p-4 space-y-3 bg-surface" dir="rtl">
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="text-xs text-muted-txt">תיאור:</label>
                      <input
                        value={picker.desc}
                        onChange={e => setPicker(p => ({ ...p, desc: e.target.value }))}
                        placeholder="תיאור"
                        className="flex-1 min-w-[160px] rounded-lg border border-line bg-surface2 px-3 py-1.5 text-sm text-txt focus:outline-none focus:border-gold/60"
                      />
                      <label className="text-xs text-muted-txt">סכום:</label>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-txt">₪</span>
                        <input
                          type="number"
                          value={picker.amount || ''}
                          onChange={e => setPicker(p => ({ ...p, amount: parseFloat(e.target.value) || 0 }))}
                          placeholder="סכום"
                          min={0}
                          style={{ direction: 'ltr' }}
                          className="rounded-lg border border-line bg-surface2 px-2 py-1.5 text-sm text-txt focus:outline-none focus:border-gold/60 w-28 text-left tabular-nums"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-txt">העבר ל:</span>
                      {SECTIONS.map(s => (
                        <button key={s.id} onClick={() => sendGroup(g, s.id)}
                          className={`px-3 py-1.5 rounded-lg border text-sm font-semibold transition-all ${s.cls}`}>
                          {s.label}
                        </button>
                      ))}
                      <button onClick={() => setActiveKey(null)}
                        className="text-muted-txt hover:text-txt text-xs me-auto">ביטול</button>
                    </div>

                    <button
                      onClick={() => toggleExpanded(g.key)}
                      className="text-xs text-gold/80 hover:text-gold transition-colors"
                    >
                      {isExpanded ? '▲ הסתר עסקאות בקבוצה' : `▼ הצג ${g.count} עסקאות בקבוצה`}
                    </button>

                    {isExpanded && (
                      <div className="border-t border-line pt-3 space-y-1.5 max-h-64 overflow-y-auto">
                        {g.txns.map(t => (
                          <div key={t.origIdx} className="flex items-center justify-between gap-3 text-xs px-2 py-1 rounded bg-surface2/50">
                            <span className="text-muted-txt truncate flex-1">{t.desc}</span>
                            {t.date && <span className="text-[10px] text-muted-txt shrink-0">{t.date}</span>}
                            <span className="tabular-nums text-txt shrink-0">{t.amount.toLocaleString('he-IL')} ₪</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── זיכויים / העברות שנכנסו ── */}
      {inGroups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold text-green-400">💰 זיכויים / העברות שנכנסו</h2>
            <span className="text-xs text-muted-txt">כסף שנכנס לחשבון — מופרד מההוצאות. אם משהו סווג בטעות, לחץ ⇄</span>
          </div>

          {inGroups.map(g => {
            const isExpanded = expandedKeys.has(g.key)
            return (
              <div key={g.key} className="rounded-xl border border-green-400/30 bg-green-400/5">
                <div className="flex items-stretch">
                  <button
                    onClick={() => toggleExpanded(g.key)}
                    className="flex-1 p-4 flex items-center gap-3 hover:bg-green-400/5 transition-colors text-right min-w-0"
                    dir="rtl"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-txt truncate">{g.displayName}</div>
                      <div className="text-xs text-muted-txt mt-0.5">
                        {g.count} {txNoun(g.count, 'in')} · ממוצע {Math.round(g.totalAmount / g.count).toLocaleString('he-IL')} ₪
                      </div>
                    </div>
                    <div className="text-left shrink-0">
                      <div className="text-lg font-bold text-green-400 tabular-nums">
                        +{g.totalAmount.toLocaleString('he-IL')} ₪
                      </div>
                      <div className="text-[10px] text-muted-txt">נכנס לחשבון</div>
                    </div>
                    <span className="text-green-400 text-xl shrink-0 w-5 text-center">{isExpanded ? '−' : '+'}</span>
                  </button>
                  <button
                    onClick={() => flipGroup(g, 'in')}
                    title="זה בעצם חיוב / כסף שיצא — העבר לקבוצת החיובים"
                    className="px-3 border-s border-green-400/20 text-muted-txt hover:text-expense hover:bg-expense/5 transition-colors text-sm shrink-0"
                  >
                    ⇄
                  </button>
                </div>

                {isExpanded && (
                  <div className="border-t border-green-400/20 p-4 space-y-1.5 max-h-64 overflow-y-auto" dir="rtl">
                    {g.txns.map(t => (
                      <div key={t.origIdx} className="flex items-center justify-between gap-3 text-xs px-2 py-1 rounded bg-surface2/50">
                        <span className="text-muted-txt truncate flex-1">{t.desc}</span>
                        {t.date && <span className="text-[10px] text-muted-txt shrink-0">{t.date}</span>}
                        <span className="tabular-nums text-green-400 shrink-0">+{t.amount.toLocaleString('he-IL')} ₪</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* All-sent confirmation */}
      {sentCount > 0 && outGroups.length === 0 && rawRows.length > 0 && (
        <div className="rounded-xl border border-green-400/30 bg-green-400/5 p-4 text-sm text-green-400 text-center">
          ✓ כל {sentCount} החיובים נשלחו למיפוי. סיימת!
        </div>
      )}

      {/* Empty states */}
      {!fileName && (
        <div className="rounded-xl border border-line bg-surface2 p-8 text-center text-muted-txt">
          העלה קובץ דוח עו&quot;ש כדי להתחיל
        </div>
      )}

      {fileName && totalTxCount === 0 && (
        <div className="rounded-xl border border-yellow-400/30 bg-yellow-400/5 p-4 text-sm text-yellow-300">
          לא זוהו עסקאות בקובץ. ייתכן שהפורמט אינו נתמך.
        </div>
      )}
    </div>
  )
}
