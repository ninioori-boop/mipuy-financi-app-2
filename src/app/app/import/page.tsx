'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { getAuthHeader } from '@/lib/getAuthToken'
import { fetchWithRetry } from '@/lib/fetchWithRetry'
import { useCreditStore } from '@/stores/creditStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useMonthlyStore } from '@/stores/monthlyStore'
import { parseExcelFile } from '@/lib/parseExcel'
import { extractTransactions } from '@/lib/parsing'
import { normalizeForLookup } from '@/lib/categorize'
import { ALL_CATEGORIES, MONTHS_LIST } from '@/lib/constants'
import { FileDropzone } from '@/components/credit/FileDropzone'
import { SmartPatterns } from '@/components/credit/SmartPatterns'
import { CategoryBreakdown } from '@/components/credit/CategoryBreakdown'
import type { Transaction } from '@/types/transaction'

const MONTH_IDS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']

const SYSTEM_PROMPT =
  'אתה מומחה לניתוח הוצאות פיננסיות בישראל.\n' +
  'קבל רשימת עסקאות מכרטיס אשראי ישראלי וסווג כל עסקה לקטגוריה אחת.\n\n' +
  'קטגוריות אפשריות בלבד:\n' + ALL_CATEGORIES.join(', ') + '\n\n' +
  'כללים:\n' +
  '- בע"מ / ltd / llc — התעלם מסיומות משפטיות\n' +
  '- שם עיר בסוף — חלק ממיקום, לא מהשם\n' +
  '- אם לא בטוח — השתמש ב"שונות"\n' +
  '- אל תמציא קטגוריות חדשות\n\n' +
  'החזר אך ורק את הקטגוריות, באותו סדר בדיוק של העסקאות שקיבלת (קטגוריה אחת לכל שורה).\n' +
  'פורמט תגובה — JSON בלבד ללא טקסט נוסף, מערך מחרוזות לפי הסדר:\n' +
  '{"categories":["קטגוריה1","קטגוריה2"]}'

export default function ImportPage() {
  // ── local state — מבודד לחלוטין מ-creditStore ──
  const [transactions,     setTransactions]     = useState<Transaction[]>([])
  const [uploadedNames,    setUploadedNames]     = useState<string[]>([])
  const [isLoading,        setIsLoading]         = useState(false)
  const [loadingMessage,   setLoadingMessage]    = useState('')
  const [reportMonths,     setReportMonths]      = useState(3)
  const [targetMonth,      setTargetMonth]       = useState('')

  const mapping = useMappingStore()
  const { initMonth, applyImport } = useMonthlyStore()
  const router = useRouter()

  // ── local transaction edits ──
  // Manual correction: apply to every row with the same merchant in this batch,
  // and feed the shared cross-account learning pool (behind the scenes).
  const updateCategory = useCallback((idx: number, category: string) => {
    const target = transactions[idx]
    if (!target) return
    const key = normalizeForLookup(target.desc)
    setTransactions(prev => prev.map(t => normalizeForLookup(t.desc) === key ? { ...t, category } : t))
    useCreditStore.getState().learn(target.desc, category)
  }, [transactions])
  const updateDesc     = useCallback((idx: number, desc: string) =>
    setTransactions(prev => prev.map((t, i) => i === idx ? { ...t, desc } : t)), [])
  const updateAmount   = useCallback((idx: number, amount: number) =>
    setTransactions(prev => prev.map((t, i) => i === idx ? { ...t, amount } : t)), [])
  const deleteTransaction = useCallback((idx: number) =>
    setTransactions(prev => prev.filter((_, i) => i !== idx)), [])

  // ── file parsing ──
  const handleFiles = useCallback(async (files: File[]) => {
    setIsLoading(true)
    setLoadingMessage('מנתח קבצים...')
    try {
      const allTxns: Transaction[] = []
      const names: string[] = []
      for (const file of files) {
        const rows = await parseExcelFile(file)
        const txns = extractTransactions(rows, file.name, useCreditStore.getState().mergedLearnedDB())
        allTxns.push(...txns)
        names.push(file.name)
      }
      setTransactions(allTxns)
      setUploadedNames(names)
      setIsLoading(false)
      autoDetectMonth(allTxns)

      const unmatchedCount = allTxns.filter(t => t.category === 'שונות').length
      if (unmatchedCount > 0) runAI(allTxns, unmatchedCount)
    } catch (e) {
      setIsLoading(false)
      toast.error('שגיאה בפענוח הקובץ: ' + (e as Error).message)
    }
  }, [])

  function autoDetectMonth(txns: Transaction[]) {
    const counts: Record<string, number> = {}
    txns.forEach(t => { if (t.date) { const m = t.date.substring(0, 7); counts[m] = (counts[m] || 0) + 1 } })
    const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]
    if (!best) return
    const [, mon] = best.split('-')
    const moId = MONTH_IDS[parseInt(mon) - 1]
    if (moId) setTargetMonth(prev => prev || moId)
  }

  function handleMonthsChange(delta: number) {
    setReportMonths(prev => Math.max(1, Math.min(24, prev + delta)))
  }

  // ── AI categorization (same logic as credit page, updates local state) ──
  const runAI = useCallback(async (txns: Transaction[], unmatchedCount: number) => {
    const unmatched = txns.map((t, idx) => ({ idx, t })).filter(({ t }) => t.category === 'שונות' && !t.isRefund)
    if (!unmatched.length) return
    const BATCH = 80
    let updated = 0
    setIsLoading(true)
    setLoadingMessage(`מנתח ${unmatchedCount} עסקאות לא מזוהות...`)
    try {
      for (let b = 0; b < unmatched.length; b += BATCH) {
        const batch = unmatched.slice(b, b + BATCH)
        setLoadingMessage(`מנתח... (${Math.min(b + BATCH, unmatched.length)}/${unmatched.length})`)
        const lines = batch.map(({ t }) => `${t.desc} | ₪${t.amount.toFixed(2)}`).join('\n')
        const res = await fetchWithRetry('/api/categorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': await getAuthHeader() },
          body: JSON.stringify({ system: SYSTEM_PROMPT, message: `סווג את העסקאות הבאות:\n${lines}` }),
        })
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error ?? `שגיאת API ${res.status}`) }
        const data = await res.json()
        const rawText: string = data.text ?? ''
        const jsonMatch = rawText.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error('תגובה לא תקינה מ-Claude')
        const parsed = JSON.parse(jsonMatch[0].replace(/,\s*([}\]])/g, '$1'))
        // Categories as a plain string array, in input order. Tolerate the older
        // {"expenses":[{category}]} shape too. (description is never used — matched by index.)
        const cats: string[] = Array.isArray(parsed.categories)
          ? parsed.categories
          : Array.isArray(parsed.expenses)
            ? parsed.expenses.map((e: { category?: string }) => e?.category ?? '')
            : []
        setTransactions(prev => {
          const next = [...prev]
          for (let i = 0; i < Math.min(cats.length, batch.length); i++) {
            const cat = cats[i]
            if (ALL_CATEGORIES.includes(cat) && cat !== 'שונות') {
              next[batch[i].idx] = { ...next[batch[i].idx], category: cat }
              updated++
            }
          }
          return next
        })
      }
      setIsLoading(false)
      if (updated > 0) toast.success(`🤖 סיווג ${updated} מתוך ${unmatchedCount} עסקאות`)
      else toast.info('לא נמצאו עסקאות חדשות לסיווג')
    } catch (e) {
      setIsLoading(false)
      toast.error('שגיאה בניתוח AI: ' + (e as Error).message, {
        action: { label: 'נסה שוב', onClick: () => runAI(txns, unmatchedCount) },
      })
    }
  }, [])

  // ── send to monthly budget ──
  function sendToBudget() {
    if (!targetMonth) { toast.error('יש לבחור חודש יעד לפני השליחה'); return }
    if (!transactions.length) { toast.error('אין עסקאות — העלה קובץ קודם'); return }

    // שולחים את כל העסקאות (ללא פילטר תאריך) — המשתמש בוחר לאיזה חודש
    const filtered = transactions.filter(t => !t.isRefund)

    const catSums: Record<string, number> = {}
    filtered.forEach(t => { catSums[t.category] = (catSums[t.category] || 0) + t.amount })

    initMonth(targetMonth)
    applyImport(
      targetMonth, catSums,
      mapping.fixed, mapping.variable, mapping.sub, mapping.ins,
      mapping.installments, mapping.debts, mapping.savings,
      mapping.varMonths,
    )

    const monthName = MONTHS_LIST.find(m => m.id === targetMonth)?.name
    toast.success(`✅ יובאו ${filtered.length} עסקאות לתקציב ${monthName}`)
    router.push(`/app/monthly/${targetMonth}`)
  }

  const hasResults = transactions.length > 0
  const monthName  = MONTHS_LIST.find(m => m.id === targetMonth)?.name

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-6">
        <h1 className="text-2xl font-bold text-gold mb-1">📥 ייבוא לתקציב</h1>
        <p className="text-muted-txt text-sm">
          העלה קבצי Excel מכרטיסי אשראי — סיווג אוטומטי + ניתוח AI → שליחה לתקציב החודשי
        </p>
      </div>

      {/* Upload + months selector — identical to credit tab */}
      <div className="rounded-xl border border-line bg-surface2 p-6 space-y-4">
        <div className="text-sm font-semibold text-txt">📂 העלאת קבצים</div>
        <FileDropzone onFiles={handleFiles} isLoading={isLoading} />

        <div className="flex items-center gap-4 bg-surface border border-line rounded-xl px-4 py-3 flex-wrap">
          <span className="text-lg">📅</span>
          <div className="flex-1 min-w-[140px]">
            <div className="text-sm font-semibold text-txt">מספר חודשים בדוח</div>
            <div className="text-xs text-muted-txt mt-0.5">
              הדוח מכסה כמה חודשים? הסכומים יחולקו בהתאם לקבלת ממוצע חודשי
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => handleMonthsChange(-1)}
              className="w-8 h-8 rounded-lg bg-line text-txt hover:bg-gold/20 transition-colors text-base font-bold">−</button>
            <input
              type="number"
              value={reportMonths}
              min={1}
              max={24}
              onChange={e => setReportMonths(Math.max(1, Math.min(24, parseInt(e.target.value) || 1)))}
              className="w-12 text-center bg-bg border border-gold rounded-lg text-gold font-bold text-base py-1 focus:outline-none"
              style={{ direction: 'ltr' }}
            />
            <button onClick={() => handleMonthsChange(1)}
              className="w-8 h-8 rounded-lg bg-line text-txt hover:bg-gold/20 transition-colors text-base font-bold">+</button>
            <span className="text-sm text-gold/80 font-semibold min-w-[110px]">
              {reportMonths === 1 ? 'ללא חלוקה' : `ממוצע ל-${reportMonths} חודשים`}
            </span>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center gap-3 text-sm text-muted-txt">
            <span className="size-4 animate-spin rounded-full border-2 border-gold border-t-transparent" />
            {loadingMessage}
          </div>
        )}
      </div>

      {/* Results — identical layout to credit tab */}
      {hasResults && (
        <>
          {uploadedNames.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {uploadedNames.map(name => (
                <span key={name} className="text-xs px-2.5 py-1 rounded-full border border-line text-muted-txt">
                  📄 {name}
                </span>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-line bg-surface2 p-6">
            <SmartPatterns transactions={transactions} />
          </div>

          <div className="rounded-xl border border-line bg-surface2 p-6">
            <div className="text-sm font-semibold text-txt mb-4">📊 הוצאות לפי קטגוריה</div>
            <CategoryBreakdown
              transactions={transactions}
              onCategoryChange={updateCategory}
              onDescChange={updateDesc}
              onAmountChange={updateAmount}
              onDelete={deleteTransaction}
            />
          </div>

          {/* Bottom actions — send to budget instead of push to mapping */}
          <div className="rounded-xl border border-line bg-surface2 p-5 space-y-4">
            <div className="text-sm font-semibold text-txt">🎯 שליחה לתקציב חודשי</div>
            <p className="text-xs text-muted-txt">
              כל העסקאות בקובץ יישלחו לעמודת הביצוע של החודש שתבחר
            </p>

            <div className="flex items-center gap-3 flex-wrap">
              {MONTHS_LIST.map(m => (
                <button
                  key={m.id}
                  onClick={() => setTargetMonth(m.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    targetMonth === m.id
                      ? 'bg-gold/20 border-gold/60 text-gold'
                      : 'bg-surface border-line text-muted-txt hover:text-txt hover:border-gold/40'
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={sendToBudget}
                disabled={!targetMonth || isLoading}
                className="flex-1 py-3 rounded-xl bg-gold/20 border border-gold/40 text-gold font-bold text-sm hover:bg-gold/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                📤 שלח ביצוע לתקציב {monthName ?? '...'}
              </button>
              <button
                onClick={() => {
                  const count = transactions.filter(t => t.category === 'שונות').length
                  runAI(transactions, count)
                }}
                disabled={isLoading}
                className="text-sm px-4 py-2 rounded-lg border border-line bg-surface text-muted-txt hover:text-txt hover:border-gold/50 transition-colors disabled:opacity-50"
              >
                🤖 AI שוב
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
