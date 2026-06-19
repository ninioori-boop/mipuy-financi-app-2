'use client'

import { useCallback } from 'react'
import { toast } from 'sonner'
import { aiHeaders } from '@/lib/getAuthToken'
import { fetchWithRetry } from '@/lib/fetchWithRetry'
import { useCreditStore } from '@/stores/creditStore'
import { useMappingStore } from '@/stores/mappingStore'
import { parseExcelFile } from '@/lib/parseExcel'
import { extractTransactions, isStandingOrderDesc, rowsToText } from '@/lib/parsing'
import { categorize } from '@/lib/categorize'
import { fileToBase64, imageToJpegBase64 } from '@/lib/fileEncoding'
import { ALL_CATEGORIES } from '@/lib/constants'
import type { Transaction } from '@/types/transaction'
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
  'החזר אך ורק את הקטגוריות, באותו סדר בדיוק של העסקאות שקיבלת (קטגוריה אחת לכל שורה).\n' +
  'פורמט תגובה — JSON בלבד ללא טקסט נוסף, מערך מחרוזות לפי הסדר:\n' +
  '{"categories":["קטגוריה1","קטגוריה2"]}'

// Push latest transactions from store to mapping. Reads fresh state at call
// time, so any manual category edits the advisor made before clicking are
// included. Manual approval flow (no auto-sync on upload / AI / months change).
function pushToMapping() {
  const { transactions, reportMonths } = useCreditStore.getState()
  if (!transactions.length) {
    toast.warning('אין עסקאות לשליחה')
    return
  }
  useMappingStore.getState().importFromCredit(transactions, reportMonths)
  toast.success(`📤 ${transactions.length} עסקאות נשלחו למיפוי`)
}

// ── AI safety-net: read a credit statement (PDF/image, or Excel-rows-as-text)
// when the deterministic parser can't, and turn it into Transaction[]. ──
const aiUid = () => Math.random().toString(36).slice(2)
type AiCreditTxn = { date: string; desc: string; amount: number; isRefund: boolean }

function parseAiCreditTxns(text: string): AiCreditTxn[] {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return []
  let parsed: unknown
  try { parsed = JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1')) } catch { return [] }
  const arr = (parsed as { transactions?: unknown }).transactions
  if (!Array.isArray(arr)) return []
  return arr
    .map(o => {
      const r = (o ?? {}) as Record<string, unknown>
      return { date: String(r.date ?? ''), desc: String(r.desc ?? ''), amount: Number(r.amount) || 0, isRefund: !!r.isRefund }
    })
    .filter(t => t.desc && t.amount)
}

function creditTxnsFromAi(ai: AiCreditTxn[], fileName: string, learnedDB: Record<string, string>): Transaction[] {
  return ai.map(t => ({
    id: aiUid(),
    desc: t.desc,
    amount: Math.abs(t.amount),
    originalAmount: null,
    category: categorize(t.desc, learnedDB),
    source: fileName,
    notes: '',
    date: t.date || '',
    installment: null,
    isStandingOrder: isStandingOrderDesc(t.desc),
    isRefund: t.isRefund || t.amount < 0,
  }))
}

async function aiExtractCredit(content: unknown[]): Promise<AiCreditTxn[]> {
  const res = await fetchWithRetry('/api/credit-statement', {
    method: 'POST',
    headers: await aiHeaders(),
    body: JSON.stringify({ content }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? `שגיאת שרת ${res.status}`)
  }
  const json = await res.json()
  return parseAiCreditTxns((json as { text?: string }).text ?? '')
}

export default function CreditPage() {
  const {
    transactions, uploadedFileNames, isLoading, loadingMessage,
    reportMonths, setReportMonths,
    setTransactions, updateCategory, applyAiCategoryById, updateDesc, updateAmount, deleteTransaction, setLoading,
  } = useCreditStore()

  const handleFiles = useCallback(async (files: File[]) => {
    setLoading(true, 'מנתח קבצים...')
    try {
      const learned = useCreditStore.getState().mergedLearnedDB()
      const allTxns: Transaction[] = []
      const fileNames: string[] = []
      for (const file of files) {
        const isPdf   = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
        const isImage = file.type.startsWith('image/')

        if (isPdf || isImage) {
          // PDF / photo of a statement → read with AI.
          setLoading(true, `קורא ${file.name} עם AI…`)
          const data = isImage ? await imageToJpegBase64(file) : await fileToBase64(file)
          const block = isImage
            ? { type: 'image',    source: { type: 'base64', media_type: 'image/jpeg', data } }
            : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
          const ai = await aiExtractCredit([{ type: 'text', text: 'חלץ את כל העסקאות מדוח האשראי המצורף.' }, block])
          allTxns.push(...creditTxnsFromAi(ai, file.name, learned))
        } else {
          // Excel → deterministic parser first (rich: installments etc.); if it
          // recognizes nothing, fall back to the AI so no format gets rejected.
          const rows = await parseExcelFile(file, { allSheets: true })
          let txns = extractTransactions(rows, file.name, learned)
          if (txns.length === 0) {
            setLoading(true, `קורא ${file.name} עם AI…`)
            const ai = await aiExtractCredit([{ type: 'text', text:
              'חלץ את כל העסקאות מדוח האשראי הבא (טבלה, עמודות מופרדות ב‑| ):\n\n' + rowsToText(rows) }])
            txns = creditTxnsFromAi(ai, file.name, learned)
          }
          allTxns.push(...txns)
        }
        fileNames.push(file.name)
      }

      if (!allTxns.length) throw new Error('לא זוהו עסקאות בקובץ')
      setTransactions(allTxns, fileNames)
      setLoading(false)

      // No auto-sync to mapping. The advisor reviews + edits categories
      // here, then clicks "📤 שלח למיפוי" when they're satisfied — manual
      // approval flow. AI still runs automatically on unmatched rows.

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
    // Capture each row's stable id at batch creation. If the user deletes a row
    // mid-run (or any earlier row), the id still points to the right transaction
    // — index-based lookup would have shifted onto a neighbour.
    const unmatched = txns
      .map(t => ({ id: t.id, t }))
      .filter(({ t, id }) => t.category === 'שונות' && !t.isRefund && !!id)

    if (!unmatched.length) return

    const BATCH = 80
    let updated = 0

    setLoading(true, `מנתח ${unmatchedCount} עסקאות לא מזוהות...`)

    // Failed batches accumulate here so a single bad call doesn't kill the
    // whole run; the user gets a "retry just the failed ones" toast at the end.
    const failedBatches: typeof unmatched[] = []
    let lastError: Error | null = null

    try {
      for (let b = 0; b < unmatched.length; b += BATCH) {
        const batch = unmatched.slice(b, b + BATCH)
        setLoading(true, `מנתח... (${Math.min(b + BATCH, unmatched.length)}/${unmatched.length})`)

        try {
          const lines = batch.map(({ t }) => `${t.desc} | ₪${t.amount.toFixed(2)}`).join('\n')

          const res = await fetchWithRetry('/api/categorize', {
            method: 'POST',
            headers: await aiHeaders(),
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
          // Categories come back as a plain string array, in input order. Tolerate the
          // older {"expenses":[{category}]} shape too. (description is never used — matched by id.)
          const cats: string[] = Array.isArray(parsed.categories)
            ? parsed.categories
            : Array.isArray(parsed.expenses)
              ? parsed.expenses.map((e: { category?: string }) => e?.category ?? '')
              : []

          for (let i = 0; i < Math.min(cats.length, batch.length); i++) {
            const cat = cats[i]
            const id  = batch[i].id
            if (id && ALL_CATEGORIES.includes(cat) && cat !== 'שונות') {
              applyAiCategoryById(id, cat)
              updated++
            }
          }
        } catch (batchErr) {
          // Single batch failed — record it and keep going so other batches still run
          lastError = batchErr as Error
          failedBatches.push(batch)
          console.warn(`[AI batch ${b / BATCH + 1}] נכשל:`, batchErr)
        }
      }

      setLoading(false)
      const failedCount = failedBatches.reduce((s, b) => s + b.length, 0)

      // No auto-push to mapping — AI updates the categories in creditStore;
      // advisor reviews and presses "📤 שלח למיפוי" when ready.

      if (failedCount === 0) {
        if (updated > 0) toast.success(`🤖 סיווג ${updated} מתוך ${unmatchedCount} עסקאות`)
        else toast.info('לא נמצאו עסקאות חדשות לסיווג')
      } else {
        // Partial success — show what worked AND offer to retry the failed slices
        const retryTxns = failedBatches.flat().map(({ t }) => t)
        toast.warning(
          `🤖 סיווג ${updated}/${unmatchedCount}. ${failedCount} נכשלו (${lastError?.message ?? 'שגיאה'}).`,
          { action: { label: `נסה שוב ${failedCount}`, onClick: () => runAI(retryTxns, failedCount) } },
        )
      }
    } catch (e) {
      // Catastrophic failure outside any batch — keep the original full-run retry as a safety net
      setLoading(false)
      toast.error('שגיאה בניתוח AI: ' + (e as Error).message, {
        action: { label: 'נסה שוב', onClick: () => runAI(txns, unmatchedCount) },
      })
    }
  }, [setLoading, applyAiCategoryById])

  function handleMonthsChange(delta: number) {
    const next = Math.max(1, Math.min(24, reportMonths + delta))
    setReportMonths(next)
    // Months selector affects the per-month division used by importFromCredit.
    // Under manual flow, the new value just gets stored — it'll be applied on
    // the NEXT click of "📤 שלח למיפוי".
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
        <FileDropzone
          onFiles={handleFiles}
          isLoading={isLoading}
          accept=".xlsx,.xls,.csv,.pdf,image/*"
          match={f => /\.(xlsx|xls|csv|pdf)$/i.test(f.name) || f.type.startsWith('image/')}
          title="גררו דוחות אשראי לכאן, או לחצו לבחירה"
          hint="Excel · PDF · תמונה / צילום — אפשר כמה קבצים, הניתוח יתחיל בלחיצה על 'נתח'"
        />

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

          {/* Hint about the manual-approval flow — shown above the editable table */}
          <div className="rounded-xl border border-gold/30 bg-gold/5 px-4 py-3 text-sm text-txt">
            <span className="font-semibold text-gold">✏️ עריכה ידנית פעילה.</span>{' '}
            ניתן לתקן קטגוריות בטבלה למטה. <strong>לא נשלח כלום למיפוי אוטומטית</strong> —
            כשתסיים, לחץ <span className="text-gold font-semibold">"📤 שלח למיפוי"</span> בתחתית הדף.
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

          {/* Bottom actions — primary CTA: send to mapping (manual approval flow) */}
          <div className="rounded-xl border-2 border-gold/40 bg-gold/5 p-5 space-y-3">
            <div className="text-sm text-muted-txt">
              💡 כשתסיים לערוך קטגוריות ולוודא שהכל תקין — שלח את הדוח למיפוי.
              <br />
              הקטגוריות הנוכחיות בטבלה (כולל עריכות ידניות) יועתקו למיפוי. ניתן ללחוץ שוב אחרי עריכה נוספת.
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <button
                onClick={pushToMapping}
                className="text-base font-bold px-6 py-3 rounded-xl bg-gold text-surface hover:bg-gold-light transition-colors shadow-md"
              >
                📤 שלח {transactions.length} עסקאות למיפוי
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
          </div>
        </>
      )}
    </div>
  )
}
