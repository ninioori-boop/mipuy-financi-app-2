'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { aiHeaders } from '@/lib/getAuthToken'
import { fetchWithRetry } from '@/lib/fetchWithRetry'
import { parseExcelFile } from '@/lib/parseExcel'
import { extractTransactions } from '@/lib/parsing'
import { useCreditStore } from '@/stores/creditStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useAutoMapStore } from '@/stores/autoMapStore'
import { parseGeneratedMapping, type GeneratedMapping } from '@/lib/autoMap'
import type { Transaction } from '@/types/transaction'

const fmt = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')
const mkId = () => Math.random().toString(36).slice(2)

// Experimental advisor-only tool. Anyone else is redirected away even on a direct URL.
const ADVISOR_EMAIL = 'ninioori@gmail.com'

// Non-Excel documents (PDF / images) sent to Claude as base64 blocks so it reads
// them directly — no OCR of our own.
type AttachedDoc = { id: string; name: string; kind: 'image' | 'pdf'; mediaType: string; data: string }

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload  = () => resolve(r.result as string)
    r.onerror = () => reject(new Error('שגיאה בקריאת הקובץ'))
    r.readAsDataURL(file)
  })
}
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload  = () => resolve(img)
    img.onerror = () => reject(new Error('שגיאה בטעינת התמונה'))
    img.src = src
  })
}
// Downscale + JPEG so large photos fit under the request-size cap.
async function imageToJpegBase64(file: File, maxDim = 1500, quality = 0.7): Promise<string> {
  const img = await loadImage(await readAsDataURL(file))
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas לא נתמך')
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? ''
}
async function fileToBase64(file: File): Promise<string> {
  return (await readAsDataURL(file)).split(',')[1] ?? ''
}

type SimpleKey = 'income' | 'fixed' | 'sub' | 'ins' | 'variable'
const SIMPLE_SECTIONS: { key: SimpleKey; label: string; icon: string }[] = [
  { key: 'income',   label: 'הכנסות',         icon: '💰' },
  { key: 'fixed',    label: 'הוצאות קבועות',  icon: '📌' },
  { key: 'variable', label: 'הוצאות משתנות',  icon: '🛒' },
  { key: 'sub',      label: 'מנויים',         icon: '🔄' },
  { key: 'ins',      label: 'ביטוחים',        icon: '🛡️' },
]

const DEBT_FIELDS:  [keyof GeneratedMapping['debts'][number], string][] = [
  ['remainingBalance', 'יתרה'], ['monthlyPayment', 'החזר חודשי'], ['remainingMonths', 'חודשים'],
  ['interestRate', 'ריבית %'], ['originalBalance', 'קרן מקורית'],
]
const INST_FIELDS:  [keyof GeneratedMapping['installments'][number], string][] = [
  ['totalAmount', 'סכום כולל'], ['monthlyPayment', 'חודשי'], ['paidCount', 'שולמו'], ['totalCount', 'סה"כ'],
]
const SAV_FIELDS:   [keyof GeneratedMapping['savings'][number], string][] = [
  ['monthlyContribution', 'הפקדה חודשית'], ['accumulated', 'נצבר'], ['feeBalance', 'ד.ניהול צבירה %'], ['feeDeposit', 'ד.ניהול הפקדה %'],
]

const inputCls = 'rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60'

export default function AutoMapPage() {
  const router = useRouter()
  const { user } = useAuthStore()
  const { contextText, reportMonths, result, setContextText, setReportMonths, setResult, updateResult, reset } = useAutoMapStore()

  // Full page-level guard: only the advisor may view this, even via direct URL.
  const isAdvisor = !!user && user.email === ADVISOR_EMAIL
  useEffect(() => {
    if (user && user.email !== ADVISOR_EMAIL) router.replace('/app/credit')
  }, [user, router])

  const [txns, setTxns]           = useState<Transaction[]>([])
  const [fileNames, setFileNames] = useState<string[]>([])
  const [docs, setDocs]           = useState<AttachedDoc[]>([])
  const [isParsing, setIsParsing] = useState(false)
  const [isGenerating, setIsGen]  = useState(false)

  // Drag-and-drop visual feedback + per-file progress during parse.
  // parseStatus is cleared at the start of every handleFiles call so the
  // strip below the dropzone only shows the current batch's progress.
  const [isDragging, setIsDragging]     = useState(false)
  const [parseStatus, setParseStatus]   = useState<Record<string, 'parsing' | 'done' | 'failed'>>({})
  const fileInputRef                    = useRef<HTMLInputElement | null>(null)

  // Live "elapsed seconds" counter while the AI is generating. Honest signal
  // to the advisor that something is happening — the call usually takes 8-30s
  // depending on doc count + size. Updated by a 1s interval that only runs
  // while isGenerating is true.
  const [genElapsed, setGenElapsed] = useState(0)
  const genStartRef                 = useRef<number>(0)

  // Defer-copy: instead of a blocking confirm() before "📋 העתק למיפוי",
  // we surface an inline panel showing exactly which sections will change
  // and by how much. The advisor confirms or cancels with full context.
  const [showCopyPreview, setShowCopyPreview] = useState(false)

  // Route each file by type: Excel → parsed transactions (cheap/local);
  // PDF + images → base64 blocks the AI reads directly.
  // parseStatus is updated per-file so the user sees ✓/⏳/✗ next to each one
  // during a multi-file batch instead of a single global spinner.
  const handleFiles = useCallback(async (files: File[]) => {
    setIsParsing(true)
    setParseStatus(Object.fromEntries(files.map(f => [f.name, 'parsing'])))
    try {
      const learned = useCreditStore.getState().mergedLearnedDB()
      const all: Transaction[] = []
      const names: string[] = []
      const newDocs: AttachedDoc[] = []
      for (const file of files) {
        try {
          const isExcel = /\.(xlsx|xls|csv)$/i.test(file.name)
          const isPdf   = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
          const isImage = file.type.startsWith('image/')
          if (isExcel) {
            const rows = await parseExcelFile(file, { allSheets: true })
            all.push(...extractTransactions(rows, file.name, learned))
            names.push(file.name)
          } else if (isImage) {
            newDocs.push({ id: mkId(), name: file.name, kind: 'image', mediaType: 'image/jpeg', data: await imageToJpegBase64(file) })
          } else if (isPdf) {
            newDocs.push({ id: mkId(), name: file.name, kind: 'pdf', mediaType: 'application/pdf', data: await fileToBase64(file) })
          } else {
            setParseStatus(prev => ({ ...prev, [file.name]: 'failed' }))
            toast.warning(`סוג קובץ לא נתמך: ${file.name}`)
            continue
          }
          setParseStatus(prev => ({ ...prev, [file.name]: 'done' }))
        } catch (fileErr) {
          setParseStatus(prev => ({ ...prev, [file.name]: 'failed' }))
          console.warn(`[automap parse] ${file.name} נכשל:`, fileErr)
        }
      }
      if (all.length)     { setTxns(prev => [...prev, ...all]); setFileNames(prev => [...prev, ...names]) }
      if (newDocs.length) setDocs(prev => [...prev, ...newDocs])
      const parts: string[] = []
      if (all.length)     parts.push(`${all.length} עסקאות`)
      if (newDocs.length) parts.push(`${newDocs.length} מסמכים`)
      if (parts.length)   toast.success(`נקלטו ${parts.join(' · ')}`)
    } catch (e) {
      toast.error('שגיאה בפענוח: ' + (e as Error).message)
    } finally {
      setIsParsing(false)
      // Keep the per-file strip visible for ~3s after the batch finishes so
      // the user can see what succeeded / what failed before it clears.
      setTimeout(() => setParseStatus({}), 3000)
    }
  }, [])

  // Clipboard paste: capture screenshots / images directly with Ctrl+V.
  // Only activated on this page (window-level listener cleaned up on unmount).
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      const imageFiles: File[] = []
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        if (it.type.startsWith('image/')) {
          const blob = it.getAsFile()
          if (blob) {
            const ext   = it.type.split('/')[1] ?? 'png'
            const named = new File([blob], `clipboard-${Date.now()}-${i}.${ext}`, { type: it.type })
            imageFiles.push(named)
          }
        }
      }
      if (imageFiles.length) {
        e.preventDefault()
        handleFiles(imageFiles)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [handleFiles])

  // Tick the elapsed-seconds counter while generation is in flight.
  // Interval is cleared on unmount and whenever isGenerating flips back to
  // false, so there's no stray timer when the panel is idle.
  useEffect(() => {
    if (!isGenerating) return
    const id = setInterval(() => {
      setGenElapsed(Math.round((Date.now() - genStartRef.current) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [isGenerating])

  // Category totals from the parsed transactions (excluding refunds).
  const catTotals = (() => {
    const map = new Map<string, { sum: number; count: number }>()
    for (const t of txns) {
      if (t.isRefund) continue
      const e = map.get(t.category) ?? { sum: 0, count: 0 }
      e.sum += t.amount; e.count++
      map.set(t.category, e)
    }
    return [...map.entries()].sort((a, b) => b[1].sum - a[1].sum)
  })()

  const docsBytes = docs.reduce((s, d) => s + d.data.length, 0)
  const tooBig    = docsBytes > 3_800_000

  // Build the multimodal user content: a text block + one image/document block
  // per attached file, passed straight to Claude.
  function buildContent(): unknown[] {
    const blocks: unknown[] = [{ type: 'text', text: buildMessage() }]
    for (const d of docs) {
      blocks.push(d.kind === 'image'
        ? { type: 'image',    source: { type: 'base64', media_type: d.mediaType, data: d.data } }
        : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.data } })
    }
    return blocks
  }

  function buildMessage(): string {
    const lines: string[] = []
    lines.push(`מספר החודשים שהנתונים מכסים: ${reportMonths}`)
    lines.push('')
    if (catTotals.length) {
      lines.push('== סיכום עסקאות לפי קטגוריה (מתוך הקבצים שהועלו) ==')
      for (const [cat, { sum, count }] of catTotals) {
        lines.push(`${cat}: ${Math.round(sum)} ש"ח (${count} עסקאות)`)
      }
      lines.push('')
    }
    if (contextText.trim()) {
      lines.push('== נתונים נוספים מהיועץ (הכנסות, הלוואות, נכסים, חיסכון, מצב משפחתי) ==')
      lines.push(contextText.trim())
    }
    return lines.join('\n')
  }

  async function generate() {
    if (!txns.length && !contextText.trim() && !docs.length) {
      toast.error('העלה קובץ/מסמך או הזן נתונים בטקסט קודם')
      return
    }
    if (tooBig) { toast.error('הקבצים גדולים מדי — הסר חלק או הקטן תמונות'); return }
    setIsGen(true)
    genStartRef.current = Date.now()
    setGenElapsed(0)
    try {
      const res = await fetchWithRetry('/api/automap', {
        method: 'POST',
        headers: await aiHeaders(),
        body: JSON.stringify(docs.length ? { content: buildContent() } : { message: buildMessage() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error ?? `שגיאת שרת ${res.status}`)
      }
      const data = await res.json()
      const parsed = parseGeneratedMapping((data as { text?: string }).text ?? '')
      setResult(parsed)
      toast.success('✅ נוצר מיפוי — בדוק וערוך לפי הצורך')
    } catch (e) {
      toast.error('שגיאה ביצירת המיפוי: ' + (e as Error).message)
    } finally {
      setIsGen(false)
    }
  }

  // ── editing helpers (operate on the stored result) ──
  function editSimple(key: SimpleKey, idx: number, field: 'name' | 'amount', value: string) {
    if (!result) return
    const rows = [...result[key]]
    rows[idx] = { ...rows[idx], [field]: field === 'amount' ? (parseFloat(value) || 0) : value }
    updateResult({ [key]: rows })
  }
  function editAnnual(idx: number, field: 'name' | 'annualAmount', value: string) {
    if (!result) return
    const rows = [...result.annual]
    rows[idx] = { ...rows[idx], [field]: field === 'annualAmount' ? (parseFloat(value) || 0) : value }
    updateResult({ annual: rows })
  }
  function editComplex<K extends 'debts' | 'installments' | 'savings'>(key: K, idx: number, field: string, value: string) {
    if (!result) return
    const rows = [...(result[key] as unknown as Record<string, unknown>[])]
    rows[idx] = { ...rows[idx], [field]: field === 'name' ? value : (parseFloat(value) || 0) }
    updateResult({ [key]: rows } as Partial<GeneratedMapping>)
  }
  function delRow<K extends keyof GeneratedMapping>(key: K, idx: number) {
    if (!result || !Array.isArray(result[key])) return
    const rows = (result[key] as unknown[]).filter((_, i) => i !== idx)
    updateResult({ [key]: rows } as Partial<GeneratedMapping>)
  }

  // Actual copy. Wrapped in a confirm step (the preview panel) so the user
  // sees exactly what they're about to overwrite before committing.
  function doCopyToMapping() {
    if (!result) return
    useMappingStore.setState({
      income:   result.income.map(r => ({ id: mkId(), name: r.name, amount: Math.round(r.amount) })),
      fixed:    result.fixed.map(r => ({ id: mkId(), name: r.name, amount: Math.round(r.amount) })),
      sub:      result.sub.map(r => ({ id: mkId(), name: r.name, amount: Math.round(r.amount) })),
      ins:      result.ins.map(r => ({ id: mkId(), name: r.name, amount: Math.round(r.amount) })),
      variable: result.variable.map(r => ({ id: mkId(), name: r.name, amount: Math.round(r.amount) })),
      annual:   result.annual.map(r => ({ id: mkId(), name: r.name, annualAmount: Math.round(r.annualAmount) })),
      debts:    result.debts.map(r => ({ id: mkId(), name: r.name, originalBalance: Math.round(r.originalBalance), remainingBalance: Math.round(r.remainingBalance), interestRate: r.interestRate, remainingMonths: Math.round(r.remainingMonths), monthlyPayment: Math.round(r.monthlyPayment) })),
      installments: result.installments.map(r => ({ id: mkId(), name: r.name, totalAmount: Math.round(r.totalAmount), monthlyPayment: Math.round(r.monthlyPayment), paidCount: Math.round(r.paidCount), totalCount: Math.round(r.totalCount) })),
      savings:  result.savings.map(r => ({ id: mkId(), name: r.name, monthlyContribution: Math.round(r.monthlyContribution), accumulated: Math.round(r.accumulated), feeBalance: r.feeBalance, feeDeposit: r.feeDeposit })),
      varMonths: 1,
    })
    setShowCopyPreview(false)
    toast.success('📋 הועתק למיפוי הרגיל', {
      action: { label: 'פתח מיפוי', onClick: () => router.push('/app/mapping') },
    })
  }

  // Per-section before/after counts for the copy preview panel. Read from
  // mappingStore + result; safe to call without a result (returns nulls).
  function copyDiff() {
    if (!result) return null
    const m = useMappingStore.getState()
    const len = (a: unknown): number => Array.isArray(a) ? a.length : 0
    return [
      { key: 'income',       label: '💰 הכנסות',         current: len(m.income),       next: len(result.income) },
      { key: 'fixed',        label: '📌 הוצאות קבועות',  current: len(m.fixed),        next: len(result.fixed) },
      { key: 'variable',     label: '🛒 הוצאות משתנות',  current: len(m.variable),     next: len(result.variable) },
      { key: 'sub',          label: '🔄 מנויים',         current: len(m.sub),          next: len(result.sub) },
      { key: 'ins',          label: '🛡️ ביטוחים',        current: len(m.ins),          next: len(result.ins) },
      { key: 'annual',       label: '📆 שנתיות',         current: len(m.annual),       next: len(result.annual) },
      { key: 'debts',        label: '💳 חובות',          current: len(m.debts),        next: len(result.debts) },
      { key: 'installments', label: '🛍️ תשלומים',        current: len(m.installments), next: len(result.installments) },
      { key: 'savings',      label: '🏦 חיסכון',         current: len(m.savings),      next: len(result.savings) },
    ]
  }

  const monthlyExpense = result
    ? [...result.fixed, ...result.variable, ...result.sub, ...result.ins].reduce((s, r) => s + r.amount, 0)
      + result.annual.reduce((s, r) => s + r.annualAmount / 12, 0)
      + result.debts.reduce((s, r) => s + r.monthlyPayment, 0)
      + result.installments.reduce((s, r) => s + r.monthlyPayment, 0)
    : 0
  const monthlyIncome = result ? result.income.reduce((s, r) => s + r.amount, 0) : 0

  // Block render for anyone who isn't the advisor (guard above handles the redirect).
  if (!isAdvisor) return null

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-gold/40 bg-gold/5 p-6">
        <h1 className="text-2xl font-bold text-gold mb-1">🧪 מיפוי אוטומטי (ניסיוני)</h1>
        <p className="text-muted-txt text-sm">
          מעבדה עצמאית: מזינים את נתוני הלקוח (Excel · PDF · תמונות · טקסט), ה‑AI קורא הכל ובונה תמונת מצב — מיפוי שלם לפי עקרונות הכלכלן של הבית.
          <strong className="text-txt"> מנותק מהמערכת</strong> — שום דבר לא נשמר למיפוי הרגיל עד שתלחץ "העתק למיפוי".
        </p>
      </div>

      {/* Inputs */}
      <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-4">
        <div className="text-sm font-semibold text-txt">1️⃣ נתונים</div>

        {/* Drag-and-drop zone — keyboard-equivalent click triggers the hidden input */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragging(false)
            const fs = Array.from(e.dataTransfer.files)
            if (fs.length) handleFiles(fs)
          }}
          onClick={() => fileInputRef.current?.click()}
          className={[
            'relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors text-center select-none',
            isDragging
              ? 'border-gold bg-gold/15 ring-2 ring-gold/40'
              : 'border-line bg-surface hover:border-gold/50 hover:bg-surface/70',
          ].join(' ')}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".xlsx,.xls,.csv,.pdf,image/*"
            className="hidden"
            onChange={e => { const input = e.currentTarget; const fs = Array.from(input.files ?? []); input.value = ''; if (fs.length) handleFiles(fs) }}
          />
          <span className="text-3xl">{isDragging ? '⬇️' : '📎'}</span>
          <span className="text-sm font-medium text-txt">
            {isDragging ? 'שחרר כאן' : 'גרור קבצים לכאן, או לחץ לבחירה'}
          </span>
          <span className="text-xs text-muted-txt/70">
            Excel · PDF · תמונות · צילומי מסך · <kbd dir="ltr" className="px-1 py-0.5 rounded bg-line text-[10px]">Ctrl+V</kbd> להדבקה
          </span>
        </div>

        {/* Mobile-only camera shortcut — opens the native camera UI on phones */}
        <label className="sm:hidden flex items-center justify-center gap-2 rounded-lg border border-line bg-surface hover:border-gold/50 hover:bg-gold/5 px-3 py-2 text-sm text-txt cursor-pointer transition-colors">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={e => { const input = e.currentTarget; const fs = Array.from(input.files ?? []); input.value = ''; if (fs.length) handleFiles(fs) }}
          />
          <span>📸</span>
          <span>צלם תלוש / מסך</span>
        </label>

        {/* Per-file parse status strip — shows ✓/⏳/✗ next to each filename
            during a batch and lingers ~3s after the batch ends. */}
        {Object.keys(parseStatus).length > 0 && (
          <div className="rounded-lg border border-line bg-surface px-3 py-2 space-y-1">
            {Object.entries(parseStatus).map(([name, status]) => (
              <div key={name} className="flex items-center gap-2 text-xs">
                <span className="shrink-0">
                  {status === 'parsing' ? <span className="inline-block size-3 animate-spin rounded-full border-2 border-gold border-t-transparent align-middle" /> : status === 'done' ? '✓' : '✗'}
                </span>
                <span className={status === 'failed' ? 'text-expense' : status === 'done' ? 'text-txt' : 'text-muted-txt'}>
                  {name}
                </span>
              </div>
            ))}
          </div>
        )}

        {fileNames.length > 0 && (
          <div className="text-xs text-muted-txt flex items-center gap-2 flex-wrap">
            <span>📊 {fileNames.join(', ')} · {txns.length} עסקאות · {catTotals.length} קטגוריות</span>
            <button onClick={() => { setTxns([]); setFileNames([]) }}
              className="me-auto text-xs px-2 py-0.5 rounded border border-line hover:text-expense hover:border-expense/40 transition-colors">נקה</button>
          </div>
        )}
        {docs.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {docs.map(d => (
              <div key={d.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface ps-1 pe-2 py-1 text-xs text-txt">
                {d.kind === 'pdf' ? (
                  <span className="size-8 shrink-0 rounded bg-line/60 flex items-center justify-center text-base">📕</span>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={`data:${d.mediaType};base64,${d.data}`}
                    alt={d.name}
                    className="size-8 shrink-0 rounded object-cover border border-line"
                  />
                )}
                <span className="max-w-[160px] truncate">{d.name}</span>
                <button
                  onClick={() => setDocs(prev => prev.filter(x => x.id !== d.id))}
                  className="size-7 flex items-center justify-center text-muted-txt hover:text-expense text-base leading-none rounded hover:bg-line/40 transition-colors"
                  aria-label={`הסר ${d.name}`}
                >×</button>
              </div>
            ))}
          </div>
        )}

        {/* Byte meter — visible whenever any doc is attached so the user sees
            how close they are to the 4MB cap. Turns red at the threshold. */}
        {docs.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-txt">נפח מסמכים</span>
              <span className={tooBig ? 'text-expense font-semibold tabular-nums' : 'text-muted-txt tabular-nums'}>
                {(docsBytes / 1_000_000).toFixed(2)} / 4.0 MB
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-line overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${tooBig ? 'bg-expense' : 'bg-gold'}`}
                style={{ width: `${Math.min(100, (docsBytes / 4_000_000) * 100)}%` }}
              />
            </div>
            {tooBig && (
              <div className="text-xs text-expense">הקבצים גדולים מדי — הסר חלק או הקטן תמונות לפני יצירה.</div>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-muted-txt">מספר חודשים שהנתונים מכסים:</span>
          <input type="number" min={1} max={24} value={reportMonths}
            onChange={e => setReportMonths(parseInt(e.target.value) || 1)}
            style={{ direction: 'ltr' }} className={`${inputCls} w-16 text-center`} />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-txt">נתונים נוספים (טקסט חופשי) — הכנסות, הלוואות, נכסים, חיסכון, מצב משפחתי…</label>
          <textarea value={contextText} onChange={e => setContextText(e.target.value)} rows={5}
            placeholder={'לדוגמה:\nמשכורת נטו 18,000\nמשכנתא: יתרה 800,000, החזר 4,500, נותרו 22 שנה\nקרן חירום 30,000, מפקידים 1,000 לחודש'}
            className={`${inputCls} w-full leading-relaxed`} />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={generate} disabled={isGenerating}
            className="bg-gold/20 hover:bg-gold/30 text-gold border border-gold/40 rounded-lg px-5 py-2 text-sm font-semibold transition-colors disabled:opacity-50">
            {isGenerating
              ? `🤖 מנתח… ${Math.floor(genElapsed / 60)}:${String(genElapsed % 60).padStart(2, '0')}`
              : result
                ? '🔁 צור מיפוי שוב'
                : '🤖 צור מיפוי'}
          </button>
          {result && (
            <span className="text-xs text-muted-txt">
              קיימת תוצאה — לחיצה תיצור מיפוי חדש מאותם קבצים
            </span>
          )}
          {result && (
            <button onClick={() => { if (confirm('לאפס את המעבדה (קלט ותוצאה)?')) { reset(); setTxns([]); setFileNames([]); setDocs([]) } }}
              className="me-auto text-xs text-muted-txt hover:text-expense transition-colors">אפס מעבדה</button>
          )}
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm font-semibold text-txt">2️⃣ המיפוי שנוצר (ניתן לעריכה)</div>
              <button onClick={() => setShowCopyPreview(v => !v)}
                className="bg-gold text-surface rounded-lg px-4 py-1.5 text-sm font-bold hover:bg-gold-light transition-colors">
                📋 העתק למיפוי
              </button>
            </div>

            {/* Pre-copy preview — replaces the blocking confirm() with a
                structured before/after table so the advisor sees exactly
                what's about to overwrite the real mapping. */}
            {showCopyPreview && (() => {
              const diff = copyDiff()
              if (!diff) return null
              return (
                <div className="rounded-lg border-2 border-gold/40 bg-gold/5 p-3 sm:p-4 space-y-3">
                  <div className="text-sm font-semibold text-gold">📋 השוואה לפני העתקה</div>
                  <div className="text-xs text-muted-txt">
                    זה יחליף את המיפוי הנוכחי שלך בתוצאת ה-AI. בדוק שמספרים בעמודה "אחרי" הגיוניים — הם יהפכו לערכים החדשים במיפוי.
                  </div>
                  <div className="rounded-lg overflow-hidden border border-line">
                    <table className="w-full text-xs">
                      <thead className="bg-surface2 border-b border-line">
                        <tr>
                          <th className="text-start px-3 py-2 font-medium text-muted-txt">סעיף</th>
                          <th className="text-center px-3 py-2 font-medium text-muted-txt">לפני</th>
                          <th className="text-center px-3 py-2 font-medium text-muted-txt">אחרי</th>
                          <th className="text-center px-3 py-2 font-medium text-muted-txt">שינוי</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/50">
                        {diff.map(d => {
                          const delta = d.next - d.current
                          const sign  = delta > 0 ? '+' : ''
                          return (
                            <tr key={d.key} className="hover:bg-surface2/40">
                              <td className="px-3 py-1.5 text-txt">{d.label}</td>
                              <td className="px-3 py-1.5 text-center text-muted-txt tabular-nums">{d.current}</td>
                              <td className="px-3 py-1.5 text-center text-gold font-semibold tabular-nums">{d.next}</td>
                              <td className={`px-3 py-1.5 text-center tabular-nums ${delta > 0 ? 'text-income' : delta < 0 ? 'text-expense' : 'text-muted-txt'}`}>
                                {delta === 0 ? '—' : `${sign}${delta}`}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={doCopyToMapping}
                      className="bg-gold text-surface rounded-lg px-4 py-2.5 text-sm font-bold hover:bg-gold-light transition-colors"
                    >
                      ✓ אשר והעתק
                    </button>
                    <button
                      onClick={() => setShowCopyPreview(false)}
                      className="rounded-lg border border-line bg-surface px-4 py-2.5 text-sm text-muted-txt hover:text-txt hover:border-gold/40 transition-colors"
                    >
                      ביטול
                    </button>
                  </div>
                </div>
              )
            })()}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-surface border border-line rounded-lg p-2">
                <div className="text-[10px] text-muted-txt">הכנסות/חודש</div>
                <div className="text-sm font-bold text-green-400 tabular-nums">{fmt(monthlyIncome)}</div>
              </div>
              <div className="bg-surface border border-line rounded-lg p-2">
                <div className="text-[10px] text-muted-txt">הוצאות/חודש</div>
                <div className="text-sm font-bold text-expense tabular-nums">{fmt(monthlyExpense)}</div>
              </div>
              <div className="bg-surface border border-line rounded-lg p-2">
                <div className="text-[10px] text-muted-txt">תזרים/חודש</div>
                <div className={`text-sm font-bold tabular-nums ${monthlyIncome - monthlyExpense >= 0 ? 'text-green-400' : 'text-expense'}`}>{fmt(monthlyIncome - monthlyExpense)}</div>
              </div>
            </div>
            {result.assessment && (
              <div className="text-xs text-txt bg-surface border border-line rounded-lg p-3 whitespace-pre-wrap leading-relaxed">
                {result.assessment}
              </div>
            )}
          </div>

          {/* Simple sections */}
          {SIMPLE_SECTIONS.map(({ key, label, icon }) => (
            result[key].length > 0 && (
              <div key={key} className="rounded-xl border border-line bg-surface2 p-3 sm:p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-txt">{icon} {label}</h3>
                  <span className="text-xs text-muted-txt tabular-nums">{fmt(result[key].reduce((s, r) => s + r.amount, 0))}</span>
                </div>
                {result[key].map((r, i) => (
                  <div key={i} className="flex items-center gap-2 group">
                    <input value={r.name} onChange={e => editSimple(key, i, 'name', e.target.value)} className={`${inputCls} flex-1`} />
                    <input type="number" value={r.amount || ''} onChange={e => editSimple(key, i, 'amount', e.target.value)} style={{ direction: 'ltr' }} className={`${inputCls} w-28 text-left tabular-nums`} />
                    <button onClick={() => delRow(key, i)} className="text-muted-txt hover:text-expense opacity-0 group-hover:opacity-100 text-sm">×</button>
                  </div>
                ))}
              </div>
            )
          ))}

          {/* Annual */}
          {result.annual.length > 0 && (
            <div className="rounded-xl border border-line bg-surface2 p-3 sm:p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-txt">📆 שנתיות</h3>
                <span className="text-xs text-muted-txt tabular-nums">{fmt(result.annual.reduce((s, r) => s + r.annualAmount, 0))}/שנה</span>
              </div>
              {result.annual.map((r, i) => (
                <div key={i} className="flex items-center gap-2 group">
                  <input value={r.name} onChange={e => editAnnual(i, 'name', e.target.value)} className={`${inputCls} flex-1`} />
                  <input type="number" value={r.annualAmount || ''} onChange={e => editAnnual(i, 'annualAmount', e.target.value)} style={{ direction: 'ltr' }} className={`${inputCls} w-28 text-left tabular-nums`} placeholder="שנתי" />
                  <button onClick={() => delRow('annual', i)} className="text-muted-txt hover:text-expense opacity-0 group-hover:opacity-100 text-sm">×</button>
                </div>
              ))}
            </div>
          )}

          {/* Complex sections */}
          {([
            { key: 'debts' as const,        label: '💳 חובות',   fields: DEBT_FIELDS },
            { key: 'installments' as const, label: '🛍️ תשלומים', fields: INST_FIELDS },
            { key: 'savings' as const,      label: '🏦 חיסכון',  fields: SAV_FIELDS },
          ]).map(({ key, label, fields }) => (
            result[key].length > 0 && (
              <div key={key} className="rounded-xl border border-line bg-surface2 p-3 sm:p-4 space-y-2">
                <h3 className="text-sm font-semibold text-txt">{label}</h3>
                {(result[key] as unknown as Record<string, unknown>[]).map((r, i) => (
                  <div key={i} className="bg-surface/40 rounded-lg p-2 space-y-1.5 group">
                    <div className="flex items-center gap-2">
                      <input value={String(r.name ?? '')} onChange={e => editComplex(key, i, 'name', e.target.value)} className={`${inputCls} flex-1`} placeholder="שם" />
                      <button onClick={() => delRow(key, i)} className="text-muted-txt hover:text-expense text-sm">×</button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                      {fields.map(([f, l]) => (
                        <div key={String(f)} className="space-y-0.5">
                          <div className="text-[10px] text-muted-txt px-1">{l}</div>
                          <input type="number" value={(r[f as string] as number) || ''} onChange={e => editComplex(key, i, f as string, e.target.value)} style={{ direction: 'ltr' }} className={`${inputCls} w-full text-left tabular-nums`} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  )
}
