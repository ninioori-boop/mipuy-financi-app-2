'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { aiHeaders } from '@/lib/getAuthToken'
import { fetchWithRetry } from '@/lib/fetchWithRetry'
import { useCreditStore } from '@/stores/creditStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useMonthlyStore } from '@/stores/monthlyStore'
import { parseExcelFile } from '@/lib/parseExcel'
import { extractTransactions, isStandingOrderDesc, rowsToText } from '@/lib/parsing'
import { normalizeForLookup, categorize } from '@/lib/categorize'
import { fileToBase64, imageToJpegBase64 } from '@/lib/fileEncoding'
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

// ── AI safety-net: read a credit statement (PDF / image, or Excel-rows-as-text)
// when the deterministic parser can't, and turn it into Transaction[]. Same
// path as the credit tab (/api/credit-statement). ──
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
      const learned = useCreditStore.getState().mergedLearnedDB()
      const allTxns: Transaction[] = []
      const names: string[] = []
      for (const file of files) {
        const isPdf   = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
        const isImage = file.type.startsWith('image/')

        if (isPdf || isImage) {
          // PDF / photo of a statement → read with AI (same path as the credit tab).
          setLoadingMessage(`קורא ${file.name} עם AI…`)
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
            setLoadingMessage(`קורא ${file.name} עם AI…`)
            const ai = await aiExtractCredit([{ type: 'text', text:
              'חלץ את כל העסקאות מדוח האשראי הבא (טבלה, עמודות מופרדות ב‑| ):\n\n' + rowsToText(rows) }])
            txns = creditTxnsFromAi(ai, file.name, learned)
          }
          allTxns.push(...txns)
        }
        names.push(file.name)
      }
      if (!allTxns.length) throw new Error('לא זוהו עסקאות בקובץ')
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
    // Capture each row's stable id at batch creation so a delete during the
    // run can't shift indices onto a neighbouring row.
    const unmatched = txns.map(t => ({ id: t.id, t })).filter(({ t, id }) => t.category === 'שונות' && !t.isRefund && !!id)
    if (!unmatched.length) return
    const BATCH = 80
    let updated = 0
    setIsLoading(true)
    setLoadingMessage(`מנתח ${unmatchedCount} עסקאות לא מזוהות...`)

    const failedBatches: typeof unmatched[] = []
    let lastError: Error | null = null

    try {
      for (let b = 0; b < unmatched.length; b += BATCH) {
        const batch = unmatched.slice(b, b + BATCH)
        setLoadingMessage(`מנתח... (${Math.min(b + BATCH, unmatched.length)}/${unmatched.length})`)

        try {
          const lines = batch.map(({ t }) => `${t.desc} | ₪${t.amount.toFixed(2)}`).join('\n')
          const res = await fetchWithRetry('/api/categorize', {
            method: 'POST',
            headers: await aiHeaders(),
            body: JSON.stringify({ system: SYSTEM_PROMPT, message: `סווג את העסקאות הבאות:\n${lines}` }),
          })
          if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error ?? `שגיאת API ${res.status}`) }
          const data = await res.json()
          const rawText: string = data.text ?? ''
          const jsonMatch = rawText.match(/\{[\s\S]*\}/)
          if (!jsonMatch) throw new Error('תגובה לא תקינה מ-Claude')
          const parsed = JSON.parse(jsonMatch[0].replace(/,\s*([}\]])/g, '$1'))
          // Categories as a plain string array, in input order. Tolerate the older
          // {"expenses":[{category}]} shape too. (description is never used — matched by id.)
          const cats: string[] = Array.isArray(parsed.categories)
            ? parsed.categories
            : Array.isArray(parsed.expenses)
              ? parsed.expenses.map((e: { category?: string }) => e?.category ?? '')
              : []
          setTransactions(prev => {
            const next = [...prev]
            for (let i = 0; i < Math.min(cats.length, batch.length); i++) {
              const cat = cats[i]
              const id  = batch[i].id
              if (!id || !ALL_CATEGORIES.includes(cat) || cat === 'שונות') continue
              const idx = next.findIndex(t => t.id === id)
              if (idx < 0) continue   // row was deleted mid-run — skip
              next[idx] = { ...next[idx], category: cat }
              updated++
            }
            return next
          })
        } catch (batchErr) {
          // Single batch failed — record it and keep going so other batches still run
          lastError = batchErr as Error
          failedBatches.push(batch)
          console.warn(`[AI batch ${b / BATCH + 1}] נכשל:`, batchErr)
        }
      }

      setIsLoading(false)
      const failedCount = failedBatches.reduce((s, b) => s + b.length, 0)

      if (failedCount === 0) {
        if (updated > 0) toast.success(`🤖 סיווג ${updated} מתוך ${unmatchedCount} עסקאות`)
        else toast.info('לא נמצאו עסקאות חדשות לסיווג')
      } else {
        const retryTxns = failedBatches.flat().map(({ t }) => t)
        toast.warning(
          `🤖 סיווג ${updated}/${unmatchedCount}. ${failedCount} נכשלו (${lastError?.message ?? 'שגיאה'}).`,
          { action: { label: `נסה שוב ${failedCount}`, onClick: () => runAI(retryTxns, failedCount) } },
        )
      }
    } catch (e) {
      // Catastrophic failure outside any batch — full-run retry as a safety net
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

    // Per-business totals (name + category) so applyImport can fill the ACTUAL of
    // matching named rows in קבועות/מנויים/ביטוחים per specific business; anything
    // unmatched folds into its category total. Grouped by normalized business name.
    const merchantMap = new Map<string, { name: string; amount: number; category: string }>()
    filtered.forEach(t => {
      const k = normalizeForLookup(t.desc)
      if (!k) return
      const e = merchantMap.get(k) ?? { name: t.desc, amount: 0, category: t.category }
      e.amount += t.amount
      merchantMap.set(k, e)
    })
    const merchantSums = [...merchantMap.values()]

    initMonth(targetMonth)
    applyImport(
      targetMonth, catSums,
      mapping.fixed, mapping.variable, mapping.sub, mapping.ins,
      mapping.installments, mapping.debts, mapping.savings,
      mapping.varMonths,
      merchantSums,
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
          העלה דוחות אשראי (Excel · PDF · תמונה) — סיווג אוטומטי + ניתוח AI → שליחה לתקציב החודשי
        </p>
      </div>

      {/* Upload + months selector — identical to credit tab */}
      <div className="rounded-xl border border-line bg-surface2 p-6 space-y-4">
        <div className="text-sm font-semibold text-txt">📂 העלאת קבצים</div>
        <FileDropzone
          onFiles={handleFiles}
          isLoading={isLoading}
          accept=".xlsx,.xls,.csv,.pdf,image/*"
          match={f => /\.(xlsx|xls|csv|pdf)$/i.test(f.name) || f.type.startsWith('image/')}
          title="גררו דוחות לכאן, או לחצו לבחירה"
          hint="Excel · PDF · תמונה / צילום — אפשר כמה קבצים"
        />

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
            {/* Display-only here: the import tab routes everything to the chosen
                month via the "שלח ביצוע לתקציב" CTA below, so no send-to-mapping
                buttons (those belong to the credit tab). */}
            <SmartPatterns transactions={transactions} showSend={false} />
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
