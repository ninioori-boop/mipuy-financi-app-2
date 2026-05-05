'use client'

import { useCallback } from 'react'
import { toast } from 'sonner'
import { getAuthHeader } from '@/lib/getAuthToken'
import { fetchWithRetry } from '@/lib/fetchWithRetry'
import { useCreditStore } from '@/stores/creditStore'
import { useMappingStore } from '@/stores/mappingStore'
import { parseExcelFile } from '@/lib/parseExcel'
import { extractTransactions } from '@/lib/parsing'
import { ALL_CATEGORIES } from '@/lib/constants'
import { FileDropzone } from '@/components/credit/FileDropzone'
import { SmartPatterns } from '@/components/credit/SmartPatterns'
import { CategoryBreakdown } from '@/components/credit/CategoryBreakdown'
import { AiAnalysis } from '@/components/credit/AiAnalysis'

const SYSTEM_PROMPT =
  'אתה מומחה לניתוח הוצאות פיננסיות בישראל.\n' +
  'קבל רשימת עסקאות מכרטיס אשראי ישראלי וסווג כל עסקה לקטגוריה אחת.\n\n' +
  'קטגוריות אפשריות בלבד:\n' + ALL_CATEGORIES.join(', ') + '\n\n' +
  'כללים:\n' +
  '- בע"מ / ltd / llc — התעלם מסיומות משפטיות\n' +
  '- שם עיר בסוף — חלק ממיקום, לא מהשם\n' +
  '- אם לא בטוח — השתמש ב"שונות"\n' +
  '- אל תמציא קטגוריות חדשות\n\n' +
  'פורמט תגובה — JSON בלבד ללא טקסט נוסף:\n' +
  '{"expenses":[{"description":"תיאור","category":"קטגוריה"}]}'

// Push latest transactions from store to mapping (reads fresh state)
function pushToMapping() {
  const { transactions, reportMonths } = useCreditStore.getState()
  useMappingStore.getState().importFromCredit(transactions, reportMonths)
}

export default function CreditPage() {
  const {
    transactions, uploadedFileNames, isLoading, loadingMessage,
    reportMonths, setReportMonths,
    setTransactions, updateCategory, updateDesc, updateAmount, deleteTransaction, setLoading,
  } = useCreditStore()

  const handleFiles = useCallback(async (files: File[]) => {
    setLoading(true, 'מנתח קבצים...')
    try {
      const allTxns: ReturnType<typeof extractTransactions> = []
      const fileNames: string[] = []
      for (const file of files) {
        const rows = await parseExcelFile(file)
        const txns = extractTransactions(rows, file.name, useCreditStore.getState().learnedDB)
        allTxns.push(...txns)
        fileNames.push(file.name)
      }
      setTransactions(allTxns, fileNames)
      setLoading(false)

      // ייבוא ראשוני למיפוי — לפני AI (עם סיווג מה-learnedDB)
      useMappingStore.getState().importFromCredit(allTxns, useCreditStore.getState().reportMonths)

      const unmatchedCount = allTxns.filter(t => t.category === 'שונות').length
      if (unmatchedCount > 0) {
        runAI(allTxns, unmatchedCount)
      }
    } catch (e) {
      setLoading(false)
      toast.error('שגיאה בפענוח הקובץ: ' + (e as Error).message)
    }
  }, [setTransactions, setLoading])

  const runAI = useCallback(async (txns: typeof transactions, unmatchedCount: number) => {
    const unmatched = txns
      .map((t, idx) => ({ idx, t }))
      .filter(({ t }) => t.category === 'שונות' && !t.isRefund)

    if (!unmatched.length) return

    const BATCH = 80
    let updated = 0

    setLoading(true, `מנתח ${unmatchedCount} עסקאות לא מזוהות...`)

    try {
      for (let b = 0; b < unmatched.length; b += BATCH) {
        const batch = unmatched.slice(b, b + BATCH)
        setLoading(true, `מנתח... (${Math.min(b + BATCH, unmatched.length)}/${unmatched.length})`)

        const lines = batch.map(({ t }) => `${t.desc} | ₪${t.amount.toFixed(2)}`).join('\n')

        const res = await fetchWithRetry('/api/categorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': await getAuthHeader() },
          body: JSON.stringify({ system: SYSTEM_PROMPT, message: `סווג את העסקאות הבאות:\n${lines}` }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error ?? `שגיאת API ${res.status}`)
        }

        const data = await res.json()
        const rawText: string = data.text ?? ''
        const jsonMatch = rawText.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error('תגובה לא תקינה מ-Claude')
        const jsonClean = jsonMatch[0].replace(/,\s*([}\]])/g, '$1')
        const parsed = JSON.parse(jsonClean)
        const aiExpenses: { description: string; category: string }[] = parsed.expenses ?? []

        for (let i = 0; i < Math.min(aiExpenses.length, batch.length); i++) {
          const cat = aiExpenses[i].category
          if (ALL_CATEGORIES.includes(cat) && cat !== 'שונות') {
            updateCategory(batch[i].idx, cat)
            updated++
          }
        }
      }

      setLoading(false)
      if (updated > 0) toast.success(`🤖 סיווג ${updated} מתוך ${unmatchedCount} עסקאות`)
      else toast.info('לא נמצאו עסקאות חדשות לסיווג')

      // ייבוא מחדש למיפוי עם הקטגוריות המעודכנות מה-AI
      pushToMapping()
    } catch (e) {
      setLoading(false)
      toast.error('שגיאה בניתוח AI: ' + (e as Error).message, {
        action: { label: 'נסה שוב', onClick: () => runAI(txns, unmatchedCount) },
      })
    }
  }, [setLoading, updateCategory])

  function handleMonthsChange(delta: number) {
    const next = Math.max(1, Math.min(24, reportMonths + delta))
    setReportMonths(next)
    // עדכן מיפוי אם יש עסקאות
    if (useCreditStore.getState().transactions.length) {
      useMappingStore.getState().importFromCredit(
        useCreditStore.getState().transactions,
        next,
      )
    }
  }

  const hasResults = transactions.length > 0

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-6">
        <h1 className="text-2xl font-bold text-gold mb-1">💳 דוחות אשראי</h1>
        <p className="text-muted-txt text-sm">
          העלה קבצי Excel מכרטיסי אשראי — מיסיווג אוטומטי + ניתוח AI
        </p>
      </div>

      {/* Upload + months selector */}
      <div className="rounded-xl border border-line bg-surface2 p-6 space-y-4">
        <div className="text-sm font-semibold text-txt">📂 העלאת קבצים</div>
        <FileDropzone onFiles={handleFiles} isLoading={isLoading} />

        {/* Months selector — identical logic to v1 */}
        <div className="flex items-center gap-4 bg-surface border border-line rounded-xl px-4 py-3 flex-wrap">
          <span className="text-lg">📅</span>
          <div className="flex-1 min-w-[140px]">
            <div className="text-sm font-semibold text-txt">מספר חודשים בדוח</div>
            <div className="text-xs text-muted-txt mt-0.5">
              הדוח מכסה כמה חודשים? הסכומים יחולקו בהתאם לקבלת ממוצע חודשי
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
              onChange={e => {
                const v = Math.max(1, Math.min(24, parseInt(e.target.value) || 1))
                setReportMonths(v)
                if (useCreditStore.getState().transactions.length) {
                  useMappingStore.getState().importFromCredit(
                    useCreditStore.getState().transactions, v,
                  )
                }
              }}
              className="w-12 text-center bg-bg border border-gold rounded-lg text-gold font-bold text-base py-1 focus:outline-none"
              style={{ direction: 'ltr' }}
            />
            <button
              onClick={() => handleMonthsChange(1)}
              className="w-8 h-8 rounded-lg bg-line text-txt hover:bg-gold/20 transition-colors text-base font-bold"
            >+</button>
            <span className="text-sm text-gold/80 font-semibold min-w-[110px]">
              {reportMonths === 1 ? 'ללא חלוקה' : `ממוצע ל-${reportMonths} חודשים`}
            </span>
          </div>
        </div>

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-center gap-3 text-sm text-muted-txt">
            <span className="size-4 animate-spin rounded-full border-2 border-gold border-t-transparent" />
            {loadingMessage}
          </div>
        )}
      </div>

      {/* Results */}
      {hasResults && (
        <>
          {/* Uploaded files */}
          {uploadedFileNames.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {uploadedFileNames.map(name => (
                <span key={name} className="text-xs px-2.5 py-1 rounded-full border border-line text-muted-txt">
                  📄 {name}
                </span>
              ))}
            </div>
          )}

          {/* Smart patterns */}
          <div className="rounded-xl border border-line bg-surface2 p-6">
            <SmartPatterns transactions={transactions} />
          </div>

          {/* Category breakdown — expandable per-category with editing */}
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

          {/* AI Full Analysis */}
          <AiAnalysis transactions={transactions} reportMonths={reportMonths} />

          {/* Bottom actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={pushToMapping}
              className="text-sm px-4 py-2 rounded-lg border border-gold/30 bg-gold/10 text-gold hover:bg-gold/20 transition-colors"
            >
              🗂️ עדכן מיפוי ידני
            </button>
            <button
              onClick={() => {
                const count = transactions.filter(t => t.category === 'שונות').length
                runAI(transactions, count)
              }}
              disabled={isLoading}
              className="text-sm px-4 py-2 rounded-lg border border-line bg-surface2 text-muted-txt hover:text-txt hover:border-gold/50 transition-colors disabled:opacity-50"
            >
              🤖 הרץ ניתוח AI שוב
            </button>
          </div>
        </>
      )}
    </div>
  )
}
