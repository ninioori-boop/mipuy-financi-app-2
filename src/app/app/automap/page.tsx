'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { hasLabAccess } from '@/lib/labAccess'
import { takeHandoffFiles } from '@/lib/intakeHandoff'
import { aiHeaders } from '@/lib/getAuthToken'
import { fetchWithRetry } from '@/lib/fetchWithRetry'
import { parseExcelFile } from '@/lib/parseExcel'
import { extractTransactions } from '@/lib/parsing'
import { useCreditStore } from '@/stores/creditStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useAutoMapStore } from '@/stores/autoMapStore'
import { parseGeneratedMapping, validateMapping, type GeneratedMapping } from '@/lib/autoMap'
import { LabMappingView } from '@/components/automap/LabMappingView'
import type { Transaction } from '@/types/transaction'

const fmt = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')
const mkId = () => Math.random().toString(36).slice(2)

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

const inputCls = 'rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60'

export default function AutoMapPage() {
  const router = useRouter()
  const { user } = useAuthStore()
  const {
    contextText, reportMonths, result, drafts,
    setContextText, setReportMonths, setResult, updateResult, reset,
    saveDraft, loadDraft, deleteDraft,
  } = useAutoMapStore()

  // Full page-level guard: only the advisor may view this, even via direct URL.
  const isAdvisor = hasLabAccess(user?.email)
  useEffect(() => {
    if (user && !hasLabAccess(user.email)) router.replace('/app/credit')
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

  // Drafts panel collapsed/expanded — kept local, doesn't need persistence.
  const [showDrafts, setShowDrafts] = useState(false)

  // Smart-merge vs full-replace toggle inside the preview panel.
  // 'merge' (the default): keep all existing mapping rows, add only result
  //   rows whose normalized name doesn't already exist in the section.
  //   Safe to run against a live client without wiping manual edits.
  // 'replace' (legacy / explicit): wipe and overwrite with the result, as
  //   the original copyToMapping did. Useful for fresh clients.
  const [copyMode, setCopyMode] = useState<'merge' | 'replace'>('merge')

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

  // Handoff from the advisor's intake-review "פתח במעבדה": load the client's
  // files straight into the lab once, on mount.
  const handoffConsumed = useRef(false)
  useEffect(() => {
    if (handoffConsumed.current) return
    const h = takeHandoffFiles()
    if (h?.files.length) {
      handoffConsumed.current = true
      handleFiles(h.files)
    }
  }, [handleFiles])

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
      const rawText: string = (data as { text?: string }).text ?? ''
      try {
        const parsed = parseGeneratedMapping(rawText)
        setResult(parsed)
        toast.success('✅ נוצר מיפוי — בדוק וערוך לפי הצורך')
      } catch (parseErr) {
        // Surface what Claude actually returned so we can debug "no JSON"
        // failures from the console instead of guessing. The toast keeps
        // the user-facing message short; the console has the full payload.
        console.error('[automap] failed to parse AI response', {
          error:     (parseErr as Error).message,
          textLen:   rawText.length,
          textHead:  rawText.slice(0, 300),
          textTail:  rawText.slice(-300),
        })
        const preview = rawText.slice(0, 80).replace(/\s+/g, ' ')
        toast.error(
          `שגיאה בקריאת תשובת ה‑AI. תחילת התשובה: "${preview || '(ריק)'}…" — פתח קונסול לפרטים`,
          { duration: 12000 },
        )
      }
    } catch (e) {
      toast.error('שגיאה ביצירת המיפוי: ' + (e as Error).message)
    } finally {
      setIsGen(false)
    }
  }

  // Row editing / adding / deleting on the AI result lives inside
  // LabMappingView, which drives the shared mapping-tab panels and writes
  // back through updateResult. Kept out of this page to keep it focused on
  // input, generation, drafts, and the copy-to-mapping flow.

  // Save the current session (context + months + result) as a named draft.
  // The advisor names the draft via prompt() — quick + good-enough for the
  // advisor-only sandbox; can graduate to a proper modal if drafts grow.
  function handleSaveDraft() {
    if (!result) {
      toast.warning('אין תוצאה לשמירה — צור מיפוי קודם')
      return
    }
    const name = window.prompt('שם הטיוטה (למשל "יוסי כהן - יוני 2026"):', '') ?? ''
    if (name === '') return
    const id = saveDraft(name)
    if (id) toast.success(`💾 הטיוטה "${name.trim() || 'ללא שם'}" נשמרה`)
  }

  // Load a draft into the live editor. If there's an existing result, warn
  // first — loading overwrites contextText / reportMonths / result.
  function handleLoadDraft(id: string, name: string) {
    if (result && !window.confirm(`לטעון את "${name}"? זה ידרוס את התוצאה הנוכחית.`)) return
    if (loadDraft(id)) {
      toast.success(`📂 הטיוטה "${name}" נטענה`)
      setShowDrafts(false)
    }
  }

  function handleDeleteDraft(id: string, name: string) {
    if (!window.confirm(`למחוק את הטיוטה "${name}"?`)) return
    deleteDraft(id)
    toast.success('🗑️ הטיוטה נמחקה')
  }

  // Pre-fill the context textarea from the client's existing mapping rows.
  // Useful when re-running the lab on an active client — the AI sees what's
  // already mapped and focuses on extracting only the NEW / DIFFERENT items
  // from the uploaded reports instead of re-deriving everything from scratch.
  // Appends to whatever the advisor has already typed (doesn't wipe).
  function prefillFromMapping() {
    const m = useMappingStore.getState()
    const lines: string[] = ['=== המיפוי הקיים של הלקוח ===']

    const simpleSummary = (rows: { name: string; amount: number }[]): string =>
      rows.map(r => `${r.name} ${Math.round(r.amount)}`).join(', ')
    const annualSummary = (rows: { name: string; annualAmount: number }[]): string =>
      rows.map(r => `${r.name} ${Math.round(r.annualAmount)}/שנה`).join(', ')

    if (m.income.length)       lines.push(`הכנסות: ${simpleSummary(m.income)}`)
    if (m.fixed.length)        lines.push(`קבועות: ${simpleSummary(m.fixed)}`)
    if (m.variable.length)     lines.push(`משתנות: ${simpleSummary(m.variable)}`)
    if (m.sub.length)          lines.push(`מנויים: ${simpleSummary(m.sub)}`)
    if (m.ins.length)          lines.push(`ביטוחים: ${simpleSummary(m.ins)}`)
    if (m.annual.length)       lines.push(`שנתיות: ${annualSummary(m.annual)}`)
    if (m.debts.length)        lines.push(`חובות: ${m.debts.map(d => `${d.name} — יתרה ${Math.round(d.remainingBalance)}, חודשי ${Math.round(d.monthlyPayment)}`).join('; ')}`)
    if (m.installments.length) lines.push(`תשלומים: ${m.installments.map(i => `${i.name} — ${Math.round(i.monthlyPayment)} × ${i.paidCount}/${i.totalCount}`).join('; ')}`)
    if (m.savings.length)      lines.push(`חיסכון: ${m.savings.map(s => `${s.name} — ${Math.round(s.monthlyContribution)}/חודש`).join('; ')}`)

    if (lines.length === 1) {
      toast.warning('המיפוי הקיים ריק — אין מה לטעון')
      return
    }
    lines.push('=== עדכן/הוסף לפי הנתונים החדשים שמועלים ===')

    const summary = lines.join('\n')
    const newContext = contextText.trim() ? `${contextText.trim()}\n\n${summary}` : summary
    setContextText(newContext)
    toast.success('📥 המיפוי הקיים נטען לקונטקסט')
  }

  // Normalized name comparison — trim + lowercase. Used by smart-merge to
  // decide whether a generated row already exists in mappingStore.
  function normName(s: string): string { return s.trim().toLowerCase() }

  // Filter result rows to those whose name doesn't already appear in the
  // existing section (matched by normName). Used in 'merge' mode below.
  function newRowsOnly<T extends { name: string }>(newRows: T[], existing: { name: string }[]): T[] {
    const seen = new Set(existing.map(r => normName(r.name)))
    return newRows.filter(r => !seen.has(normName(r.name)))
  }

  // Actual copy. Wrapped in a confirm step (the preview panel) so the user
  // sees exactly what they're about to overwrite before committing.
  // In 'merge' mode (default): preserves all existing mapping rows and adds
  // only result rows whose name doesn't already exist. Safe on live clients.
  // In 'replace' mode: wipes the mapping and overwrites with the result.
  function doCopyToMapping() {
    if (!result) return
    const existing = useMappingStore.getState()

    if (copyMode === 'replace') {
      useMappingStore.setState({
        creditScore:  Math.round(result.creditScore ?? 0),
        creditCards:  (result.creditCards ?? []).map(r => ({ id: mkId(), name: r.name, limit: Math.round(r.limit), chargeDay: Math.round(r.chargeDay) || 2 })),
        bankAccounts: (result.bankAccounts ?? []).map(r => ({ id: mkId(), name: r.name, balance: Math.round(r.balance), overdraftLimit: Math.round(r.overdraftLimit) })),
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
    } else {
      // merge mode: existing rows untouched, new rows appended where the
      // normalized name doesn't already exist in the section.
      useMappingStore.setState({
        // creditScore: keep the advisor's existing value; fill it only if empty.
        creditScore:  existing.creditScore || Math.round(result.creditScore ?? 0),
        creditCards:  [...existing.creditCards,  ...newRowsOnly(result.creditCards  ?? [], existing.creditCards).map(r  => ({ id: mkId(), name: r.name, limit: Math.round(r.limit), chargeDay: Math.round(r.chargeDay) || 2 }))],
        bankAccounts: [...existing.bankAccounts, ...newRowsOnly(result.bankAccounts ?? [], existing.bankAccounts).map(r => ({ id: mkId(), name: r.name, balance: Math.round(r.balance), overdraftLimit: Math.round(r.overdraftLimit) }))],
        income:   [...existing.income,       ...newRowsOnly(result.income,       existing.income).map(r       => ({ id: mkId(), name: r.name, amount: Math.round(r.amount) }))],
        fixed:    [...existing.fixed,        ...newRowsOnly(result.fixed,        existing.fixed).map(r        => ({ id: mkId(), name: r.name, amount: Math.round(r.amount) }))],
        sub:      [...existing.sub,          ...newRowsOnly(result.sub,          existing.sub).map(r          => ({ id: mkId(), name: r.name, amount: Math.round(r.amount) }))],
        ins:      [...existing.ins,          ...newRowsOnly(result.ins,          existing.ins).map(r          => ({ id: mkId(), name: r.name, amount: Math.round(r.amount) }))],
        variable: [...existing.variable,     ...newRowsOnly(result.variable,     existing.variable).map(r     => ({ id: mkId(), name: r.name, amount: Math.round(r.amount) }))],
        annual:   [...existing.annual,       ...newRowsOnly(result.annual,       existing.annual).map(r       => ({ id: mkId(), name: r.name, annualAmount: Math.round(r.annualAmount) }))],
        debts:    [...existing.debts,        ...newRowsOnly(result.debts,        existing.debts).map(r        => ({ id: mkId(), name: r.name, originalBalance: Math.round(r.originalBalance), remainingBalance: Math.round(r.remainingBalance), interestRate: r.interestRate, remainingMonths: Math.round(r.remainingMonths), monthlyPayment: Math.round(r.monthlyPayment) }))],
        installments: [...existing.installments, ...newRowsOnly(result.installments, existing.installments).map(r => ({ id: mkId(), name: r.name, totalAmount: Math.round(r.totalAmount), monthlyPayment: Math.round(r.monthlyPayment), paidCount: Math.round(r.paidCount), totalCount: Math.round(r.totalCount) }))],
        savings:  [...existing.savings,      ...newRowsOnly(result.savings,      existing.savings).map(r      => ({ id: mkId(), name: r.name, monthlyContribution: Math.round(r.monthlyContribution), accumulated: Math.round(r.accumulated), feeBalance: r.feeBalance, feeDeposit: r.feeDeposit }))],
        // varMonths preserved in merge mode — advisor's existing setting stays
      })
    }

    setShowCopyPreview(false)
    toast.success(copyMode === 'replace' ? '📋 הועתק למיפוי (החלפה מלאה)' : '🔀 מוזג למיפוי — שורות קיימות נשמרו', {
      action: { label: 'פתח מיפוי', onClick: () => router.push('/app/mapping') },
    })
  }

  // Per-section before/after counts for the copy preview panel. Read from
  // mappingStore + result; safe to call without a result (returns nulls).
  // The "next" column depends on copyMode — in merge mode we only count the
  // rows that would actually be added (skipping name duplicates).
  function copyDiff() {
    if (!result) return null
    const m = useMappingStore.getState()
    const len = (a: unknown): number => Array.isArray(a) ? a.length : 0
    const nextFor = <T extends { name: string }>(newRows: T[], existing: { name: string }[]): number =>
      copyMode === 'replace' ? newRows.length : existing.length + newRowsOnly(newRows, existing).length
    return [
      { key: 'creditCards',  label: '💳 כרטיסי אשראי',    current: len(m.creditCards),  next: nextFor(result.creditCards  ?? [], m.creditCards) },
      { key: 'bankAccounts', label: '🏛️ עו&quot;ש',        current: len(m.bankAccounts), next: nextFor(result.bankAccounts ?? [], m.bankAccounts) },
      { key: 'income',       label: '💰 הכנסות',         current: len(m.income),       next: nextFor(result.income,       m.income) },
      { key: 'fixed',        label: '📌 הוצאות קבועות',  current: len(m.fixed),        next: nextFor(result.fixed,        m.fixed) },
      { key: 'variable',     label: '🛒 הוצאות משתנות',  current: len(m.variable),     next: nextFor(result.variable,     m.variable) },
      { key: 'sub',          label: '🔄 מנויים',         current: len(m.sub),          next: nextFor(result.sub,          m.sub) },
      { key: 'ins',          label: '🛡️ ביטוחים',        current: len(m.ins),          next: nextFor(result.ins,          m.ins) },
      { key: 'annual',       label: '📆 שנתיות',         current: len(m.annual),       next: nextFor(result.annual,       m.annual) },
      { key: 'debts',        label: '💳 חובות',          current: len(m.debts),        next: nextFor(result.debts,        m.debts) },
      { key: 'installments', label: '🛍️ תשלומים',        current: len(m.installments), next: nextFor(result.installments, m.installments) },
      { key: 'savings',      label: '🏦 חיסכון',         current: len(m.savings),      next: nextFor(result.savings,      m.savings) },
    ]
  }

  // Local sanity checks on the AI result — runs free, instantly, on every
  // edit. Surfaces zeroed-out rows, paid>total installments, AI sums that
  // disagree with the underlying txns, etc. Recomputed when result or
  // txns change.
  const issues = result ? validateMapping(result, txns) : []

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
    <div className="max-w-4xl mx-auto space-y-6 pb-20 sm:pb-0">

      {/* Header */}
      <div className="rounded-xl border border-gold/40 bg-gold/5 p-6">
        <h1 className="text-2xl font-bold text-gold mb-1">🧪 מיפוי אוטומטי (ניסיוני)</h1>
        <p className="text-muted-txt text-sm">
          מעבדה עצמאית: מזינים את נתוני הלקוח (Excel · PDF · תמונות · טקסט), ה‑AI קורא הכל ובונה תמונת מצב — מיפוי שלם לפי עקרונות הכלכלן של הבית.
          <strong className="text-txt"> מנותק מהמערכת</strong> — שום דבר לא נשמר למיפוי הרגיל עד שתלחץ "העתק למיפוי".
        </p>
      </div>

      {/* Saved drafts — only rendered when there are any. Collapsed by default;
          the badge shows the count so the advisor can see at a glance how
          many past sessions are recoverable without paying for a fresh AI run. */}
      {drafts.length > 0 && (
        <div className="rounded-xl border border-line bg-surface2 p-3 sm:p-4 space-y-2">
          <button
            onClick={() => setShowDrafts(v => !v)}
            className="w-full flex items-center justify-between gap-2 text-sm font-semibold text-txt hover:text-gold transition-colors"
          >
            <span>📂 טיוטות שמורות ({drafts.length})</span>
            <span className="text-muted-txt">{showDrafts ? '▲' : '▼'}</span>
          </button>
          {showDrafts && (
            <div className="space-y-1.5">
              {drafts.map(d => (
                <div key={d.id} className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface px-3 py-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-txt truncate">{d.name}</div>
                    <div className="text-[11px] text-muted-txt">
                      נשמר {new Date(d.savedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}
                    </div>
                  </div>
                  <button
                    onClick={() => handleLoadDraft(d.id, d.name)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gold/40 bg-gold/10 text-gold hover:bg-gold/20 transition-colors whitespace-nowrap"
                  >
                    📂 טען
                  </button>
                  <button
                    onClick={() => handleDeleteDraft(d.id, d.name)}
                    aria-label={`מחק את ${d.name}`}
                    className="size-8 flex items-center justify-center rounded-lg border border-line text-muted-txt hover:text-expense hover:border-expense/40 transition-colors"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="text-xs text-muted-txt">נתונים נוספים (טקסט חופשי) — הכנסות, הלוואות, נכסים, חיסכון, מצב משפחתי…</label>
            <button
              type="button"
              onClick={prefillFromMapping}
              className="text-xs px-2.5 py-1 rounded border border-line bg-surface text-muted-txt hover:text-gold hover:border-gold/40 transition-colors whitespace-nowrap"
              title="טוען את המיפוי הקיים של הלקוח כקונטקסט — ה‑AI יראה אותו וידע מה כבר קיים"
            >
              📥 טען מהמיפוי הקיים
            </button>
          </div>
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
            <button
              onClick={handleSaveDraft}
              className="text-xs px-3 py-1.5 rounded-lg border border-gold/40 bg-gold/10 text-gold hover:bg-gold/20 transition-colors whitespace-nowrap"
              title="שמור את הסשן הנוכחי כטיוטה לטעינה מאוחר יותר — חוסך עלות AI חוזרת"
            >
              💾 שמור כטיוטה
            </button>
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

                  {/* Mode toggle — merge (safe, keeps existing rows) vs
                      replace (legacy, wipes mapping). Default is merge. */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-txt">אופן ההעתקה:</span>
                    <button
                      onClick={() => setCopyMode('merge')}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${copyMode === 'merge' ? 'border-gold bg-gold/15 text-gold font-semibold' : 'border-line bg-surface text-muted-txt hover:border-gold/40'}`}
                    >
                      🔀 מיזוג חכם
                    </button>
                    <button
                      onClick={() => setCopyMode('replace')}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${copyMode === 'replace' ? 'border-expense bg-expense/10 text-expense font-semibold' : 'border-line bg-surface text-muted-txt hover:border-expense/40'}`}
                    >
                      ♻️ החלפה מלאה
                    </button>
                  </div>

                  <div className="text-xs text-muted-txt">
                    {copyMode === 'merge'
                      ? 'מיזוג: שורות קיימות במיפוי נשארות. רק שורות חדשות (לפי שם) יתווספו. עריכות ידניות לא ידרסו.'
                      : 'החלפה: כל המיפוי הנוכחי יימחק ויוחלף בתוצאת ה‑AI. עריכות ידניות יאבדו.'}
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
                <div className="text-sm font-bold text-income tabular-nums">{fmt(monthlyIncome)}</div>
              </div>
              <div className="bg-surface border border-line rounded-lg p-2">
                <div className="text-[10px] text-muted-txt">הוצאות/חודש</div>
                <div className="text-sm font-bold text-expense tabular-nums">{fmt(monthlyExpense)}</div>
              </div>
              <div className="bg-surface border border-line rounded-lg p-2">
                <div className="text-[10px] text-muted-txt">תזרים/חודש</div>
                <div className={`text-sm font-bold tabular-nums ${monthlyIncome - monthlyExpense >= 0 ? 'text-income' : 'text-expense'}`}>{fmt(monthlyIncome - monthlyExpense)}</div>
              </div>
            </div>
            {result.assessment && (
              <div className="text-xs text-txt bg-surface border border-line rounded-lg p-3 whitespace-pre-wrap leading-relaxed">
                {result.assessment}
              </div>
            )}
          </div>

          {/* Local validation panel — surfaces any sanity-check issues found
              in the result. Pure heuristics, no AI call. Errors (red) vs
              warnings (gold) sorted by severity. Hidden when the result is
              clean. */}
          {issues.length > 0 && (() => {
            const errs  = issues.filter(i => i.severity === 'error')
            const warns = issues.filter(i => i.severity === 'warning')
            return (
              <div className="rounded-xl border-2 border-gold/30 bg-gold/5 p-3 sm:p-4 space-y-2">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <div className="font-semibold text-gold">
                    ⚠️ דגלים בתוצאה ({issues.length})
                  </div>
                  <div className="text-xs text-muted-txt">
                    {errs.length > 0 && <span className="text-expense font-semibold">{errs.length} שגיאות</span>}
                    {errs.length > 0 && warns.length > 0 && <span> · </span>}
                    {warns.length > 0 && <span>{warns.length} אזהרות</span>}
                  </div>
                </div>
                <ul className="space-y-1">
                  {[...errs, ...warns].map((iss, i) => (
                    <li
                      key={i}
                      className={`flex items-start gap-2 text-xs rounded-lg border px-2.5 py-1.5 ${
                        iss.severity === 'error'
                          ? 'border-expense/40 bg-expense/5 text-expense'
                          : 'border-line bg-surface text-txt'
                      }`}
                    >
                      <span className="shrink-0">{iss.severity === 'error' ? '🛑' : '⚠️'}</span>
                      <span className="leading-snug">{iss.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })()}

          {/* Full mapping-tab view — the AI result rendered through the exact
              same panels as the manual mapping tab. Edits flow back into the
              isolated autoMapStore via updateResult; nothing touches the real
              mapping until "העתק למיפוי". */}
          <LabMappingView result={result} txns={txns} onChange={updateResult} />

        </div>
      )}

      {/* Mobile sticky CTA — keeps "📋 העתק למיפוי" reachable without
          scrolling through 9 expanded result sections. Desktop users get
          the inline button at the top of the result, so hidden ≥ sm. */}
      {result && (
        <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur border-t border-line p-3">
          <button
            onClick={() => setShowCopyPreview(v => !v)}
            className="w-full bg-gold text-surface rounded-xl py-3 text-base font-bold hover:bg-gold-light transition-colors shadow-lg"
          >
            📋 העתק למיפוי
          </button>
        </div>
      )}
    </div>
  )
}
