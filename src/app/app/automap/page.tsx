'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { useLabAccess } from '@/hooks/useLabAccess'
import { aiHeaders } from '@/lib/getAuthToken'
import { fetchWithRetry } from '@/lib/fetchWithRetry'
import { parseExcelFile } from '@/lib/parseExcel'
import { extractTransactions } from '@/lib/parsing'
import { useCreditStore } from '@/stores/creditStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useAutoMapStore } from '@/stores/autoMapStore'
import {
  parseGeneratedMapping, validateMapping,
  buildCategoryBreakdown, formatCategoryBreakdown, detectMonthSpan,
  groupByName, formatIncomeBreakdown,
  buildInstallments, buildStandingOrders, formatInstallments, formatStandingOrders, isInstallment,
  type GeneratedMapping,
} from '@/lib/autoMap'
import { extractBankRows, isCardSettlement, type BankRow } from '@/lib/automapBank'
import {
  ANNUAL_CHECKLIST, ONE_OFF_MIN, detectOneOffCharges, formatAnnualItems, oneOffKey,
} from '@/lib/automapAnnual'
import { buildCompletenessReport } from '@/lib/automapCompleteness'
import { reconcile } from '@/lib/automapReconcile'
import {
  loadIntakeAnswers, listIntakeDocs, intakeFileUrl, routeForQuestion,
  formatIntakeAnswers, countAnswered, type IntakeDoc, type IntakeRoute,
} from '@/lib/automapIntake'
import { useImpersonationStore } from '@/stores/impersonationStore'
import { categorize } from '@/lib/categorize'
import { normalizeForLookup } from '@/lib/normalizeForLookup'
import { VAR_CATEGORIES } from '@/lib/constants'
import { BrandNameHe } from '@/components/layout/BrandProvider'
import { LabMappingView } from '@/components/automap/LabMappingView'
import IntakeFormPanel from '@/components/automap/IntakeFormPanel'
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
    contextText, reportMonths, result, drafts, annualItems, dismissedOneOffs, intakeForm,
    setContextText, setReportMonths, setResult, updateResult, reset,
    setAnnualItem, removeAnnualItem, dismissOneOff,
    setIntakeAnswer, setIntakeForm,
    saveDraft, loadDraft, deleteDraft,
  } = useAutoMapStore()

  // Full page-level guard: only the advisor may view this, even via direct URL.
  // Waits for `ready` — the advisor role loads asynchronously, and redirecting
  // on a not-yet-known role would bounce a real advisor off their own page.
  const { allowed: isAdvisor, ready } = useLabAccess()
  useEffect(() => {
    if (user && ready && !isAdvisor) router.replace('/app/credit')
  }, [user, ready, isAdvisor, router])

  const [txns, setTxns]           = useState<Transaction[]>([])
  // Bank rows are kept apart from credit transactions: they carry a direction
  // (money in vs out), which is the whole reason income used to be wrong.
  const [bankRows, setBankRows]   = useState<BankRow[]>([])
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

  // Inline replacements for window.prompt / window.confirm. Those are suppressed
  // in several in-app WebView configurations — the same shell the Android
  // clients run — so on those devices saving a draft, deleting one, or resetting
  // the lab silently did nothing at all. `confirming` holds the key of the one
  // action awaiting a second click; `draftName` is non-null while the save row
  // is open.
  const [confirming, setConfirming] = useState<string | null>(null)
  const [draftName, setDraftName]   = useState<string | null>(null)
  // Typed guard for the one action that destroys live client data.
  const [replaceGuard, setReplaceGuard] = useState('')

  // Drafts panel collapsed/expanded — kept local, doesn't need persistence.
  const [showDrafts, setShowDrafts] = useState(false)

  // Smart-merge vs full-replace toggle inside the preview panel.
  // 'merge' (the default): keep all existing mapping rows, add only result
  //   rows whose normalized name doesn't already exist in the section.
  //   Safe to run against a live client without wiping manual edits.
  // 'replace' (legacy / explicit): wipe and overwrite with the result, as
  //   the original copyToMapping did. Useful for fresh clients.
  const [copyMode, setCopyMode] = useState<'merge' | 'replace'>('merge')

  // Replace mode wipes every section of a Firestore-synced live mapping, and
  // nothing used to reset it: pick it once for a fresh client, load a draft for
  // an existing one, and the copy panel came up pre-armed to destroy their data.
  // Any new result — generated, loaded from a draft, or cleared — returns to the
  // safe default.
  useEffect(() => { setCopyMode('merge') }, [result])

  // Route each file by type: Excel → parsed transactions (cheap/local);
  // PDF + images → base64 blocks the AI reads directly.
  // parseStatus is updated per-file so the user sees ✓/⏳/✗ next to each one
  // during a multi-file batch instead of a single global spinner.
  const handleFiles = useCallback(async (files: File[], routes?: Map<string, IntakeRoute>) => {
    setIsParsing(true)
    setParseStatus(Object.fromEntries(files.map(f => [f.name, 'parsing'])))
    try {
      const learned = useCreditStore.getState().mergedLearnedDB()
      const all: Transaction[] = []
      const names: string[] = []
      const newDocs: AttachedDoc[] = []
      let bankCount = 0
      for (const file of files) {
        try {
          // A file that came from the questionnaire carries the question it
          // answered, so we KNOW what it is. Sniffing the format is what made a
          // bank export go through the credit parser and count a salary as an
          // expense; when the client told us, we don't guess.
          const route   = routes?.get(file.name)
          const isExcel = route === 'bank' || route === 'credit' || (!route && /\.(xlsx|xls|csv)$/i.test(file.name))
          const isPdf   = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
          const isImage = file.type.startsWith('image/')
          if (isExcel) {
            const rows = await parseExcelFile(file, { allSheets: true })
            // A bank statement must NOT go through the credit parser: it has no
            // concept of חובה/זכות, so it read a salary deposit as an expense.
            // When the questionnaire told us which this is, honour that; only a
            // manual upload falls back to sniffing the header.
            const bank = route === 'credit' ? [] : extractBankRows(rows)
            if (bank.length) {
              bankCount += bank.length
              // Stamp the file each row came from, so detaching one statement
              // removes its rows and leaves the other accounts alone.
              const from = file.name
              setBankRows(prev => [...prev, ...bank.map(b => ({ ...b, source: from }))])
            } else {
              all.push(...extractTransactions(rows, file.name, learned))
            }
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
      if (all.length)      parts.push(`${all.length} עסקאות אשראי`)
      if (bankCount)       parts.push(`${bankCount} תנועות עו"ש`)
      if (newDocs.length)  parts.push(`${newDocs.length} מסמכים`)
      if (parts.length)    toast.success(`נקלטו ${parts.join(' · ')}`)
    } catch (e) {
      toast.error('שגיאה בפענוח: ' + (e as Error).message)
    } finally {
      setIsParsing(false)
      // Keep the per-file strip visible for ~3s after the batch finishes so
      // the user can see what succeeded / what failed before it clears.
      setTimeout(() => setParseStatus({}), 3000)
    }
  }, [])

  // ── the questionnaire as the lab's input ──
  //
  // Files no longer arrive as an anonymous pile. Each one is attached to the
  // question it answers, and that question decides which parser reads it — the
  // format never gets a vote. `attachedByQ` is what the panel displays; the
  // parsed data itself still lives in txns / bankRows / docs.
  const [attachedByQ, setAttachedByQ] = useState<Record<string, string[]>>({})

  const handleQuestionFiles = useCallback(async (files: File[], questionId: string) => {
    const route = routeForQuestion(questionId)
    const routes = new Map<string, IntakeRoute>(files.map(f => [f.name, route]))
    setAttachedByQ(prev => {
      const have = new Set(prev[questionId] ?? [])
      const added = files.map(f => f.name).filter(n => !have.has(n))
      return added.length ? { ...prev, [questionId]: [...(prev[questionId] ?? []), ...added] } : prev
    })
    await handleFiles(files, routes)
  }, [handleFiles])

  /** Detach one file: drop its chip AND everything that was parsed out of it. */
  const removeAttached = useCallback((questionId: string, name: string) => {
    setAttachedByQ(prev => {
      const left = (prev[questionId] ?? []).filter(n => n !== name)
      const next = { ...prev }
      if (left.length) next[questionId] = left
      else delete next[questionId]
      return next
    })
    setTxns(prev => prev.filter(t => t.source !== name))
    setBankRows(prev => prev.filter(b => b.source !== name))
    setFileNames(prev => prev.filter(n => n !== name))
    setDocs(prev => prev.filter(d => d.name !== name))
  }, [])

  const attachedNames = useMemo(
    () => new Set(Object.values(attachedByQ).flat()),
    [attachedByQ],
  )
  /** How many files each question got — the basis of "you said 3, I have 1". */
  const intakeFiles = useMemo(
    () => Object.fromEntries(Object.entries(attachedByQ).map(([q, names]) => [q, names.length])),
    [attachedByQ],
  )
  const intakeLines   = useMemo(() => formatIntakeAnswers(intakeForm), [intakeForm])
  const answeredCount = useMemo(() => countAnswered(intakeForm), [intakeForm])

  // ── the client's questionnaire ──
  //
  // It has existed and been filled in for months, and nothing ever read it back:
  // the client screen only loads the SIGNED-IN user's own intake, so the advisor
  // had no view of it at all. Everything here is read-only; the rules already
  // grant the advisor access through ownsClient().
  const impersonated = useImpersonationStore(s => s.client)
  const [intake, setIntake] = useState<{ answers: Record<string, string>; docs: IntakeDoc[] } | null>(null)
  const [intakeLoaded, setIntakeLoaded] = useState(false)
  const [loadingIntake, setLoadingIntake] = useState(false)

  useEffect(() => {
    const uid = impersonated?.uid
    if (!uid) { setIntake(null); return }
    let alive = true
    ;(async () => {
      try {
        const [answers, docs] = await Promise.all([loadIntakeAnswers(uid), listIntakeDocs(uid)])
        if (alive && (Object.keys(answers).length || docs.length)) setIntake({ answers, docs })
      } catch { /* no intake, or not permitted — the banner simply won't show */ }
    })()
    return () => { alive = false }
  }, [impersonated?.uid])

  // Pull the questionnaire in: answers become a block in the prompt, files go
  // through the SAME pipeline as a manual upload but routed by the question they
  // answered rather than by sniffing the format.
  const loadIntakeIntoLab = useCallback(async () => {
    if (!intake) return
    setLoadingIntake(true)
    try {
      // The client's own answers fill the same form the advisor types into —
      // one questionnaire, whoever answered it. Only non-empty answers are
      // copied, so a blank from the client never wipes something typed here.
      const filled = Object.fromEntries(
        Object.entries(intake.answers).filter(([, v]) => (v ?? '').trim()),
      )
      if (Object.keys(filled).length) setIntakeForm(filled)

      // Skip anything already uploaded by hand, by name — re-adding a file the
      // advisor just dragged in would double every transaction in it.
      const have = new Set([...fileNames, ...Object.values(attachedByQ).flat()])
      const fresh = intake.docs.filter(d => !have.has(d.name))
      const files: File[] = []
      const routes = new Map<string, IntakeRoute>()
      const chips: Record<string, string[]> = {}
      for (const d of fresh) {
        try {
          const res = await fetch(await intakeFileUrl(d.path))
          if (!res.ok) continue
          const blob = await res.blob()
          files.push(new File([blob], d.name, { type: d.type || blob.type }))
          routes.set(d.name, routeForQuestion(d.questionId))
          // Show the file under the question it answered, exactly as if it had
          // been attached there by hand. An untagged file has no slot to sit in.
          if (d.questionId) chips[d.questionId] = [...(chips[d.questionId] ?? []), d.name]
        } catch { /* one unreadable file must not abort the rest */ }
      }
      if (Object.keys(chips).length) {
        setAttachedByQ(prev => {
          const next = { ...prev }
          for (const [q, names] of Object.entries(chips)) next[q] = [...(next[q] ?? []), ...names]
          return next
        })
      }
      if (files.length) await handleFiles(files, routes)

      setIntakeLoaded(true)
      toast.success(`📋 נטען מהשאלון: ${Object.keys(filled).length} תשובות · ${files.length} קבצים`)
    } catch (e) {
      toast.error('שגיאה בטעינת השאלון: ' + (e as Error).message)
    } finally {
      setLoadingIntake(false)
    }
  }, [intake, setIntakeForm, fileNames, attachedByQ, handleFiles])

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

  // Per-category totals AND the merchants inside each one. Refunds NET their
  // category (2026-08-06, same rule as the credit/import tabs) — a refunded
  // charge is not spending, and the AI prompt must see the same numbers the
  // tabs show. Sending the merchants (2026-08-07) is what lets the model break
  // a category into real sub-rows instead of guessing the split; only VARIABLE
  // categories get a merchant list, because the prompt keeps fixed/sub/ins to
  // one row each and listing merchants there invited it to split those too.
  //
  // Split the bank rows three ways.
  //
  // A card-settlement line in the bank is a SUMMARY of the credit statement, so
  // counting it next to the credit file's own detail double-counts the client's
  // whole card spend. It is removed — but ONLY when a credit file actually
  // produced transactions. With no credit detail to fall back on there is no
  // duplication to avoid, and dropping it would lose the expense entirely.
  const { incomeRows, bankExpenses, settlements } = useMemo(() => {
    const hasCreditDetail = txns.length > 0
    const income: BankRow[] = [], expenses: BankRow[] = [], settled: BankRow[] = []
    for (const r of bankRows) {
      if (r.dir === 'in') { income.push(r); continue }
      if (hasCreditDetail && isCardSettlement(r.desc)) { settled.push(r); continue }
      expenses.push(r)
    }
    return { incomeRows: income, bankExpenses: expenses, settlements: settled }
  }, [bankRows, txns])

  // Every transaction we know about. Bank charges become ordinary categorized
  // expenses, so a mortgage or a standing order that never touches the credit
  // card still reaches the mapping.
  const allTxns = useMemo(() => {
    const learned = useCreditStore.getState().mergedLearnedDB()
    const fromBank: Transaction[] = bankExpenses.map(r => ({
      desc: r.desc, amount: r.amount, originalAmount: null,
      category: categorize(r.desc, learned), source: 'עו"ש', notes: '',
      date: r.date, installment: null, isStandingOrder: false, isRefund: false,
    }))
    return [...txns, ...fromBank]
  }, [txns, bankExpenses])

  const installmentLines = useMemo(() => buildInstallments(allTxns), [allTxns])
  const standingOrders   = useMemo(() => buildStandingOrders(allTxns), [allTxns])

  // THE rule this whole round rests on: anything that moves to a block of its
  // own leaves the expense set, and this one set feeds both the breakdown the
  // model reads and the cross-check that grades its answer. Skip it and either
  // the model double-counts, or validateMapping reports a gap it created itself.
  //
  // Two exclusions: installment legs (they have their own section in the
  // mapping) and charges the advisor confirmed as annual (they move from a
  // monthly category to the annual block).
  const confirmedOneOffKeys = useMemo(
    () => new Set(annualItems.filter(a => a.source === 'detected').map(a => a.key)),
    [annualItems],
  )
  const expenseTxns = useMemo(
    () => allTxns.filter(t =>
      !isInstallment(t) &&
      !confirmedOneOffKeys.has(oneOffKey(t.category, normalizeForLookup(t.desc) || t.desc.trim())),
    ),
    [allTxns, confirmedOneOffKeys],
  )

  // Memoized: buildCategoryBreakdown runs normalizeForLookup (~12 regex passes)
  // per transaction — ~9.8ms on a routine 3,000-txn upload vs 0.1ms for the old
  // totals-only pass. Unmemoized it re-ran on every keystroke in the context
  // textarea, which is store-backed: 9.8ms per character, on the biggest files.
  const breakdown = useMemo(() => buildCategoryBreakdown(expenseTxns, VAR_CATEGORIES), [expenseTxns])
  const incomeLines = useMemo(() => groupByName(incomeRows), [incomeRows])

  // Cross-check for the months field. Reads every dated row we have, bank
  // included — a bank statement often spans the period more completely than
  // the credit export does.
  const detectedMonths = useMemo(
    () => detectMonthSpan([...expenseTxns, ...incomeRows.map(r => ({ date: r.date }))]),
    [expenseTxns, incomeRows],
  )

  // Large charges that appeared exactly once. Suspicious for annual, never
  // assumed to be — a new sofa and a yearly insurance premium look identical
  // from the data alone, so this only raises the question.
  const oneOffCandidates = useMemo(
    () => detectOneOffCharges(
      breakdown,
      detectedMonths || reportMonths,
      new Set(dismissedOneOffs),
      confirmedOneOffKeys,
    ),
    [breakdown, detectedMonths, reportMonths, dismissedOneOffs, confirmedOneOffKeys],
  )

  // What the mapping is MISSING, as opposed to what in it is wrong. Deterministic
  // and free, so it runs before generation too — which is when the advisor can
  // still go and fetch what it names.
  const completeness = useMemo(
    () => buildCompletenessReport({
      expenseTxns, incomeRows, docs, contextText, reportMonths, detectedMonths,
      annualItems, installments: installmentLines, settlements,
      // The questionnaire is now filled in here, so it is the one to check.
      // Still null when nothing at all was answered: a blank form is not a
      // client who skipped questions, and conflating them fires on every run.
      intakeAnswers: answeredCount > 0 ? intakeForm : null,
      intakeFiles,
    }),
    [expenseTxns, incomeRows, docs, contextText, reportMonths, detectedMonths,
     annualItems, installmentLines, settlements, answeredCount, intakeForm, intakeFiles],
  )

  // ── the mapping against the account ──
  //
  // Every other check asks whether the mapping is consistent with ITSELF, which
  // a mapping built from two thirds of a client's life passes cleanly — the
  // missing third is missing from both sides of every comparison. The bank
  // account is the one thing that cannot be argued with.
  const flows = useMemo(() => ({
    bankIn:  incomeRows.reduce((s, r) => s + r.amount, 0),
    // Settlements are already out when a credit file supplied the detail; when
    // it did not, they are still here and cardCharges is 0. Either way the card
    // spend is counted exactly once.
    bankOut: bankExpenses.reduce((s, r) => s + r.amount, 0),
    cardCharges: txns.reduce((s, t) => s + (t.isRefund ? -t.amount : t.amount), 0),
    months: detectedMonths || reportMonths,
  }), [incomeRows, bankExpenses, txns, detectedMonths, reportMonths])

  const reconciliation = useMemo(
    () => (result ? reconcile(result, flows) : null),
    [result, flows],
  )

  function confirmOneOffAsAnnual(c: { key: string; name: string; category: string; amount: number }) {
    setAnnualItem({
      key: c.key, name: c.name, category: c.category,
      annualAmount: c.amount, source: 'detected',
    })
    toast.success(`"${c.name}" סומן כהוצאה שנתית והוסר מההוצאות החודשיות`)
  }

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
    if (breakdown.length) {
      lines.push('== הוצאות לפי קטגוריה ובית עסק ==')
      lines.push(...formatCategoryBreakdown(breakdown, reportMonths))
      lines.push('')
    }
    if (incomeLines.length) {
      lines.push('== הכנסות והפקדות שזוהו בעו"ש ==')
      lines.push(...formatIncomeBreakdown(incomeLines, reportMonths))
      lines.push('')
    }
    if (annualItems.length) {
      lines.push('== הוצאות שנתיות שהיועץ אישר ==')
      lines.push(...formatAnnualItems(annualItems))
      lines.push('')
    }
    if (installmentLines.length) {
      lines.push('== עסקאות בתשלומים ==')
      lines.push(...formatInstallments(installmentLines))
      lines.push('')
    }
    if (standingOrders.length) {
      lines.push('== חיובים בהוראת קבע ==')
      lines.push(...formatStandingOrders(standingOrders))
      lines.push('')
    }
    if (settlements.length) {
      const total = settlements.reduce((s, r) => s + r.amount, 0)
      lines.push('== תשלומי ריכוז לחברות אשראי — כבר הוסרו מההוצאות, לא לספור שוב ==')
      lines.push(`${settlements.length} תשלומים, ${Math.round(total)} ש"ח סך הכל. הפירוט האמיתי נמצא בבלוק ההוצאות.`)
      lines.push('')
    }
    // The target the answer has to hit. Grading the mapping after the fact only
    // catches the error; stating the number up front lets the model produce a
    // mapping that reconciles in the first place. The last line matters most:
    // without it the model closes the gap by inventing a row, which is the
    // failure mode this whole panel exists to prevent.
    if (flows.bankIn > 0 || flows.bankOut > 0) {
      const net = (flows.bankIn - flows.bankOut - flows.cardCharges) / Math.max(1, flows.months)
      lines.push('== מבחן ההצלבה — המיפוי חייב לעמוד בו ==')
      lines.push(`בחלון שהועלה נכנסו לעו"ש ${Math.round(flows.bankIn)} ש"ח, יצאו ממנו ${Math.round(flows.bankOut)} ש"ח (בלי תשלומי ריכוז אשראי), וחיובי האשראי היו ${Math.round(flows.cardCharges)} ש"ח.`)
      lines.push(`כלומר בפועל החשבון נע ב‑${Math.round(net)} ש"ח לחודש.`)
      lines.push('העודף החודשי של המיפוי שלך (הכנסות, פחות קבועות+משתנות+מנויים+ביטוחים+החזרי הלוואות+תשלומים+חיסכון+שנתיות חלקי 12) צריך לצאת קרוב למספר הזה.')
      lines.push('🔴 אם אתה לא מגיע לשם — אל תמציא שורה כדי לסגור את הפער ואל תנפח סכום. כתוב ב‑assessment מה לדעתך חסר.')
      lines.push('')
    }

    // The questionnaire goes LAST so it is the freshest thing in context, and it
    // is marked as authoritative: it answers what no document can (which bank
    // holds the account, the balances, the limits, whether loans exist at all).
    // A statement header naming another bank is a clearing detail, not a fact —
    // that is how a Yahav portfolio came back labelled Hapoalim.
    if (intakeLines.length) {
      lines.push('== השאלון — תשובות הלקוח. מקור מוסמך, גובר על כל הסקה מהנתונים ==')
      lines.push(...intakeLines)
      lines.push('')
    }
    if (contextText.trim()) {
      lines.push('== נתונים נוספים מהיועץ (הכנסות, הלוואות, נכסים, חיסכון, מצב משפחתי) ==')
      lines.push(contextText.trim())
    }
    return lines.join('\n')
  }

  async function generate() {
    if (!txns.length && !bankRows.length && !contextText.trim() && !docs.length && !intakeLines.length) {
      toast.error('מלא את השאלון או צרף קבצים קודם')
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
      const stopReason = (data as { stopReason?: string | null }).stopReason ?? null
      try {
        const parsed = parseGeneratedMapping(rawText)
        setResult(parsed)
        // A truncated reply still parses now (extractJsonObject repairs it), but
        // the tail sections are missing — say so rather than let it pass as a
        // clean run the advisor would trust.
        if (stopReason === 'max_tokens') {
          toast.warning(
            'התשובה נקטעה באורך המקסימלי. שוחזר מה שהספיק להיכתב — בדוק אילו סעיפים חסרים והרץ שוב עם פחות מסמכים.',
            { duration: 12000 },
          )
        } else {
          toast.success('✅ נוצר מיפוי — בדוק וערוך לפי הצורך')
        }
      } catch (parseErr) {
        // Surface what Claude actually returned so we can debug "no JSON"
        // failures from the console instead of guessing. The toast keeps
        // the user-facing message short; the console has the full payload.
        console.error('[automap] failed to parse AI response', {
          error:      (parseErr as Error).message,
          stopReason,
          textLen:    rawText.length,
          textHead:   rawText.slice(0, 300),
          textTail:   rawText.slice(-300),
        })
        const preview = rawText.slice(0, 80).replace(/\s+/g, ' ')
        toast.error(
          stopReason === 'max_tokens'
            ? 'התשובה נקטעה באורך המקסימלי לפני שנכתב מיפוי שאפשר לשחזר. הסר חלק מהמסמכים או צמצם את הטקסט החופשי ונסה שוב.'
            : `שגיאה בקריאת תשובת ה‑AI. תחילת התשובה: "${preview || '(ריק)'}…" — פתח קונסול לפרטים`,
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
    setDraftName('')
  }

  function commitDraft() {
    const name = draftName ?? ''
    const id = saveDraft(name)
    if (id) toast.success(`💾 הטיוטה "${name.trim() || 'ללא שם'}" נשמרה`)
    setDraftName(null)
  }

  // Load a draft into the live editor. Overwrites contextText / reportMonths /
  // result, so an existing result costs a second click.
  function handleLoadDraft(id: string, name: string) {
    if (result && confirming !== `load-${id}`) { setConfirming(`load-${id}`); return }
    setConfirming(null)
    if (loadDraft(id)) {
      toast.success(`📂 הטיוטה "${name}" נטענה`)
      setShowDrafts(false)
    }
  }

  function handleDeleteDraft(id: string) {
    if (confirming !== `del-${id}`) { setConfirming(`del-${id}`); return }
    setConfirming(null)
    deleteDraft(id)
    toast.success('🗑️ הטיוטה נמחקה')
  }

  function handleReset() {
    if (confirming !== 'reset') { setConfirming('reset'); return }
    setConfirming(null)
    reset(); setTxns([]); setBankRows([]); setFileNames([]); setDocs([])
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
  // `seen` grows as rows are accepted, so a result that contains the same name
  // twice — likely now that sub-row names come from merchant groupings, e.g.
  // "משלוחים" under both אוכל בחוץ and מזון לבית — appends it once, not twice.
  // Without this the duplicate became permanent: on the next run both copies
  // dedup against the single existing name and neither is ever cleaned up.
  function newRowsOnly<T extends { name: string }>(newRows: T[], existing: { name: string }[]): T[] {
    const seen = new Set(existing.map(r => normName(r.name)))
    const out: T[] = []
    for (const r of newRows) {
      const k = normName(r.name)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(r)
    }
    return out
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

  // Merge mode deliberately never overwrites an existing row's amount, so a
  // manual edit is never clobbered. The cost is that re-running automap on an
  // existing client to REFRESH the numbers looks like it worked ("מוזג למיפוי")
  // while silently changing nothing. Count those rows so the preview can say so
  // out loud instead of leaving the advisor to discover it later.
  function staleAmountCount(): number {
    if (!result) return 0
    const m = useMappingStore.getState()
    const sections: [{ name: string; amount: number }[], { name: string; amount: number }[]][] = [
      [result.income,   m.income],
      [result.fixed,    m.fixed],
      [result.variable, m.variable],
      [result.sub,      m.sub],
      [result.ins,      m.ins],
    ]
    let n = 0
    for (const [rows, existing] of sections) {
      const byName = new Map(existing.map(e => [normName(e.name), e.amount]))
      for (const r of rows) {
        const cur = byName.get(normName(r.name))
        if (cur !== undefined && Math.round(cur) !== Math.round(r.amount)) n++
      }
    }
    return n
  }

  // Local sanity checks on the AI result — runs free, instantly, on every
  // edit. Surfaces zeroed-out rows, paid>total installments, AI sums that
  // disagree with the underlying txns, etc. Recomputed when result or
  // txns change.
  // reportMonths is load-bearing here: txns are the raw period, the AI's rows
  // are monthly. Passing it is what keeps the check from firing on correct
  // multi-month results (and staying silent on inflated ones).
  const issues = useMemo(
    () => (result ? validateMapping(result, expenseTxns, reportMonths) : []),
    [result, expenseTxns, reportMonths],
  )

  const monthlyExpense = result
    ? [...result.fixed, ...result.variable, ...result.sub, ...result.ins].reduce((s, r) => s + r.amount, 0)
      + result.annual.reduce((s, r) => s + r.annualAmount / 12, 0)
      + result.debts.reduce((s, r) => s + r.monthlyPayment, 0)
      + result.installments.reduce((s, r) => s + r.monthlyPayment, 0)
    : 0
  const monthlyIncome = result ? result.income.reduce((s, r) => s + r.amount, 0) : 0

  // Block render for anyone who isn't the advisor (guard above handles the redirect).
  if (!isAdvisor) return null

  // max-w-6xl, not 4xl: the result renders as two columns of mapping panels, and
  // each row is name + category picker + source chip + drill + amount + delete.
  // At 4xl each column was ~430px, narrower than the row's own minimum — the
  // chips added 2026-08-07 pushed it past the edge and the content spilled
  // outside the card border. ~576px per column fits.
  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20 sm:pb-0">

      {/* Header */}
      <div className="rounded-xl border border-gold/40 bg-gold/5 p-6">
        <h1 className="text-2xl font-bold text-gold mb-1">🧪 מיפוי אוטומטי (ניסיוני)</h1>
        <p className="text-muted-txt text-sm">
          מעבדה עצמאית: מזינים את הנתונים (Excel · PDF · תמונות · טקסט), ה‑AI קורא הכל ובונה תמונת מצב — מיפוי שלם לפי עקרונות <BrandNameHe />.
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
                    onBlur={() => confirming === `load-${d.id}` && setConfirming(null)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
                      confirming === `load-${d.id}`
                        ? 'border-gold bg-gold/25 text-gold font-semibold'
                        : 'border-gold/40 bg-gold/10 text-gold hover:bg-gold/20'
                    }`}
                  >
                    {confirming === `load-${d.id}` ? 'ידרוס את התוצאה — לחץ שוב' : '📂 טען'}
                  </button>
                  <button
                    onClick={() => handleDeleteDraft(d.id)}
                    onBlur={() => confirming === `del-${d.id}` && setConfirming(null)}
                    aria-label={`מחק את ${d.name}`}
                    className={`flex items-center justify-center rounded-lg border transition-colors ${
                      confirming === `del-${d.id}`
                        ? 'px-2 h-8 text-xs font-semibold border-expense/60 bg-expense/10 text-expense'
                        : 'size-8 border-line text-muted-txt hover:text-expense hover:border-expense/40'
                    }`}
                  >
                    {confirming === `del-${d.id}` ? 'למחוק?' : '🗑️'}
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

        {/* The client may have answered this very questionnaire already, on the
            "העלאת מסמכים" screen, and until now nothing ever read it back. One
            button fills the form below from their answers and files. A button
            rather than an auto-load: the files cost bandwidth. */}
        {intake && !intakeLoaded && (
          <div className="rounded-xl border border-income/40 bg-income/5 p-3 flex items-center gap-3 flex-wrap">
            <span className="text-sm text-txt flex-1 min-w-[200px]">
              📋 <strong>{impersonated?.name || 'הלקוח'}</strong> כבר מילא את השאלון הזה
              <span className="text-muted-txt">
                {' · '}{countAnswered(intake.answers)} תשובות
                {intake.docs.length > 0 && ` · ${intake.docs.length} מסמכים`}
              </span>
            </span>
            <button
              onClick={loadIntakeIntoLab}
              disabled={loadingIntake}
              className="shrink-0 rounded-lg border border-income/50 bg-income/10 px-3 py-1.5 text-sm font-semibold text-income hover:bg-income/20 transition-colors disabled:opacity-60"
            >
              {loadingIntake ? 'טוען…' : 'מלא מהתשובות שלו'}
            </button>
          </div>
        )}
        {intakeLoaded && (
          <div className="rounded-xl border border-line bg-surface2/60 px-3 py-2 text-xs text-income">
            ✓ השאלון מולא מתשובות הלקוח, וכל מסמך נכנס לשאלה שהוא עונה עליה. אפשר להשלים ולתקן ידנית.
          </div>
        )}

        {/* The questionnaire IS the input. Each answer and each attached file is
            tagged with the question it belongs to, so the mapping is built from
            known material instead of from a guess at what each file is. */}
        <IntakeFormPanel
          answers={intakeForm}
          onAnswer={setIntakeAnswer}
          onFiles={handleQuestionFiles}
          attached={attachedByQ}
          onRemoveAttached={removeAttached}
          parseStatus={parseStatus}
          disabled={isParsing}
        />

        {/* Catch-all for anything the questionnaire has no slot for. Kept small
            and last on purpose: a file dropped here is un-tagged, so its type is
            sniffed — the old behaviour, and the old risk. */}
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
            'relative flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-4 cursor-pointer transition-colors text-center select-none',
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
          <span className="text-sm text-muted-txt">
            {isDragging ? '⬇️ שחרר כאן' : '📎 קבצים נוספים — משהו שאין לו שאלה'}
          </span>
          <span className="text-xs text-muted-txt/60">
            Excel · PDF · תמונות · <kbd dir="ltr" className="px-1 py-0.5 rounded bg-line text-[10px]">Ctrl+V</kbd> להדבקה
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
        {/* Only files with no question of their own — the ones attached to a
            question already show their status on their own row. */}
        {Object.keys(parseStatus).some(n => !attachedNames.has(n)) && (
          <div className="rounded-lg border border-line bg-surface px-3 py-2 space-y-1">
            {Object.entries(parseStatus).filter(([name]) => !attachedNames.has(name)).map(([name, status]) => (
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
            <span>
              📊 {fileNames.join(', ')} · {expenseTxns.length} הוצאות · {breakdown.length} קטגוריות
              {incomeRows.length > 0 && <> · <span className="text-income">{incomeRows.length} הפקדות</span></>}
              {installmentLines.length > 0 && <> · {installmentLines.length} עסקאות בתשלומים</>}
              {/* Say what was removed. A silently vanished expense is worse
                  than a visible one the advisor can argue with. */}
              {settlements.length > 0 && <> · {settlements.length} תשלומי ריכוז אשראי (לא נספרו)</>}
            </span>
            <button onClick={() => { setTxns([]); setBankRows([]); setFileNames([]) }}
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

        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-txt">מספר חודשים שהנתונים מכסים:</span>
            <input type="number" min={1} max={24} value={reportMonths}
              onChange={e => setReportMonths(parseInt(e.target.value) || 1)}
              style={{ direction: 'ltr' }} className={`${inputCls} w-16 text-center`} />
          </div>

          {/* This field drives BOTH the prompt and the validation cross-check,
              and it defaults to 1 while the usual export is 3 months. Getting it
              wrong yields a silently 3x-inflated mapping that nothing downstream
              can catch, because every number is then self-consistent. So check
              the advisor's answer against the dates in the files. */}
          {detectedMonths > 0 && detectedMonths !== reportMonths && (
            <div className="flex items-center gap-2 flex-wrap rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-gold">
              <span>
                ⚠️ בקבצים שהעלית יש עסקאות מ‑{detectedMonths} חודשים שונים, ורשום {reportMonths}.
                מספר שגוי כאן מכפיל או מחלק את כל המיפוי.
              </span>
              <button
                onClick={() => setReportMonths(detectedMonths)}
                className="shrink-0 rounded-md border border-gold/50 bg-gold/15 px-2 py-1 font-semibold hover:bg-gold/25 transition-colors"
              >
                עדכן ל‑{detectedMonths}
              </button>
            </div>
          )}
        </div>

        {/* What's MISSING, as opposed to what's wrong. A mapping built from 60%
            of a client's life looks identical to one built from 95% — every
            number present reconciles and nothing says otherwise. Shown before
            generation, because that's when it can still be acted on. */}
        {completeness.length > 0 && (
          <div className="rounded-xl border border-line bg-surface2/60 p-3 space-y-2">
            <div className="text-sm font-semibold text-txt">
              🔍 מה חסר לתמונה
              <span className="text-xs font-normal text-muted-txt"> · {completeness.filter(i => i.severity === 'gap').length} פערים</span>
            </div>
            <ul className="space-y-1.5">
              {completeness.map(item => (
                <li
                  key={item.key}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                    item.severity === 'gap'
                      ? 'border-gold/40 bg-gold/10 text-gold'
                      : 'border-line bg-surface text-muted-txt'
                  }`}
                >
                  <div className="font-semibold">{item.title}</div>
                  {item.detail && <div className="mt-0.5 opacity-90">{item.detail}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Annual expenses — the hole a 3-month upload always has, closed two
            ways that never overlap: charges that ARE in the data and are being
            silently divided by the month count, and expenses that are NOT in
            the data at all. Placed before generation, where it still changes
            the answer. */}
        <div className="rounded-xl border border-line bg-surface2/60 p-3 space-y-3">
          <div className="text-sm font-semibold text-txt">📆 הוצאות שנתיות</div>
          <p className="text-xs text-muted-txt">
            הוצאה שנתית לא מופיעה בחלון של שלושה חודשים, ולכן היא נעלמת מהמיפוי בלי שום סימן.
            שתי דרכים לסגור את זה, בלי להעלות עוד קבצים.
          </p>

          {/* Path 1: charges already in the data */}
          {oneOffCandidates.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-gold">
                חיובים מעל {ONE_OFF_MIN.toLocaleString('he-IL')} ש&quot;ח שהופיעו פעם אחת בלבד — שנתיים?
              </div>
              {oneOffCandidates.map(c => (
                <div key={c.key} className="flex items-center gap-2 flex-wrap rounded-lg border border-line bg-surface px-2.5 py-1.5">
                  <span className="text-xs text-txt flex-1 min-w-0 truncate">
                    {c.name} <span className="text-muted-txt">· {c.category}</span>
                  </span>
                  <span className="text-xs tabular-nums text-txt shrink-0">{fmt(c.amount)}</span>
                  <button
                    onClick={() => confirmOneOffAsAnnual(c)}
                    className="shrink-0 rounded-md border border-gold/50 bg-gold/15 px-2 py-1 text-xs font-semibold text-gold hover:bg-gold/25 transition-colors"
                  >
                    שנתי
                  </button>
                  <button
                    onClick={() => dismissOneOff(c.key)}
                    className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-muted-txt hover:text-txt transition-colors"
                  >
                    לא
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Path 2: expenses that never reach the files */}
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold text-gold list-none">
              צ&apos;קליסט שנתיות שלא מופיעות בדוחות
              <span className="text-muted-txt font-normal"> · {annualItems.filter(a => a.source === 'checklist').length} סומנו</span>
            </summary>
            <div className="mt-2 space-y-2">
              {[...new Set(ANNUAL_CHECKLIST.map(i => i.group))].map(group => (
                <div key={group} className="space-y-1">
                  <div className="text-[11px] text-muted-txt">{group}</div>
                  {ANNUAL_CHECKLIST.filter(i => i.group === group).map(item => {
                    const current = annualItems.find(a => a.key === item.key)
                    return (
                      <div key={item.key} className="flex items-center gap-2">
                        <span className="text-xs text-txt flex-1 min-w-0 truncate">{item.label}</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={current?.annualAmount || ''}
                          placeholder="₪ לשנה"
                          onChange={e => {
                            const n = parseFloat(e.target.value) || 0
                            if (n > 0) {
                              setAnnualItem({
                                key: item.key, name: item.label, category: item.category,
                                annualAmount: n, source: 'checklist',
                              })
                            } else {
                              removeAnnualItem(item.key)
                            }
                          }}
                          style={{ direction: 'ltr' }}
                          className={`${inputCls} w-28 text-left tabular-nums shrink-0`}
                        />
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </details>

          {annualItems.length > 0 && (
            <div className="text-xs text-income">
              ✓ {annualItems.length} הוצאות שנתיות, {fmt(annualItems.reduce((s, a) => s + a.annualAmount, 0))} לשנה
            </div>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="text-xs text-muted-txt">נתונים נוספים (טקסט חופשי) — הכנסות, הלוואות, נכסים, חיסכון, מצב משפחתי…</label>
            <button
              type="button"
              onClick={prefillFromMapping}
              className="text-xs px-2.5 py-1 rounded border border-line bg-surface text-muted-txt hover:text-gold hover:border-gold/40 transition-colors whitespace-nowrap"
              title="טוען את המיפוי הקיים כקונטקסט — ה‑AI יראה אותו וידע מה כבר קיים"
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
            <button
              onClick={handleReset}
              onBlur={() => confirming === 'reset' && setConfirming(null)}
              className={`me-auto text-xs transition-colors ${
                confirming === 'reset' ? 'text-expense font-semibold' : 'text-muted-txt hover:text-expense'
              }`}
            >
              {confirming === 'reset' ? 'בטוח? לחץ שוב' : 'אפס מעבדה'}
            </button>
          )}
        </div>

        {/* Inline draft-name row — replaces window.prompt, which the app's
            WebView suppresses. */}
        {draftName !== null && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <input
              autoFocus
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitDraft()
                if (e.key === 'Escape') setDraftName(null)
              }}
              placeholder='שם הטיוטה, למשל "יוסי כהן - יוני 2026"'
              className={`${inputCls} flex-1 min-w-[180px]`}
            />
            <button onClick={commitDraft}
              className="text-xs px-3 py-1.5 rounded-lg border border-gold/40 bg-gold/10 text-gold hover:bg-gold/20 transition-colors">
              שמור
            </button>
            <button onClick={() => setDraftName(null)}
              className="text-xs px-2 py-1.5 text-muted-txt hover:text-txt transition-colors">
              ביטול
            </button>
          </div>
        )}
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

                  {/* Business rows are not part of the household mapping and
                      doCopyToMapping never writes them. Say so, so their absence
                      afterwards reads as intended rather than as a lost row. */}
                  {((result.businessIncome?.length ?? 0) + (result.businessExpenses?.length ?? 0)) > 0 && (
                    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs text-muted-txt">
                      🏢 {(result.businessIncome?.length ?? 0) + (result.businessExpenses?.length ?? 0)} שורות עסקיות לא יועתקו — הן שייכות לטאב העסקי, לא למשק הבית.
                    </div>
                  )}

                  {/* Merge keeps existing amounts by design. Say so when it
                      actually costs the advisor something, so a "refresh the
                      numbers" run can't look like it worked when it didn't. */}
                  {copyMode === 'merge' && staleAmountCount() > 0 && (
                    <div className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-gold">
                      ⚠️ {staleAmountCount()} שורות קיימות הגיעו מה‑AI עם סכום שונה. מיזוג לא מעדכן סכומים של שורות קיימות, אז הן יישארו כפי שהן. לעדכון סכומים ערוך אותן במיפוי, או בחר החלפה מלאה.
                    </div>
                  )}
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
                  {/* Replace wipes a mapping that is synced to the client's own
                      Firestore document — and this page is normally used while
                      viewing AS that client. Two clicks was not enough distance
                      from a permanent, un-undoable loss of their work, so it
                      costs a typed word. Merge is untouched: it only adds. */}
                  {(() => {
                    const existingRows = diff.reduce((s, d) => s + d.current, 0)
                    const needsGuard   = copyMode === 'replace' && existingRows > 0
                    const armed        = !needsGuard || replaceGuard.trim() === 'מחק'
                    return (
                      <>
                        {needsGuard && (
                          <div className="rounded-lg border border-expense/50 bg-expense/10 px-3 py-2 space-y-2">
                            <div className="text-xs text-expense font-semibold">
                              ⚠️ ההחלפה תמחק {existingRows} שורות קיימות מהמיפוי. אין ביטול.
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-muted-txt">הקלד <strong className="text-txt">מחק</strong> כדי לאשר:</span>
                              <input
                                value={replaceGuard}
                                onChange={e => setReplaceGuard(e.target.value)}
                                className={`${inputCls} w-24`}
                                placeholder="מחק"
                              />
                            </div>
                          </div>
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => { doCopyToMapping(); setReplaceGuard('') }}
                            disabled={!armed}
                            className={`rounded-lg px-4 py-2.5 text-sm font-bold transition-colors ${
                              armed
                                ? 'bg-gold text-surface hover:bg-gold-light'
                                : 'bg-surface border border-line text-muted-txt cursor-not-allowed'
                            }`}
                          >
                            ✓ אשר והעתק
                          </button>
                          <button
                            onClick={() => { setShowCopyPreview(false); setReplaceGuard('') }}
                            className="rounded-lg border border-line bg-surface px-4 py-2.5 text-sm text-muted-txt hover:text-txt hover:border-gold/40 transition-colors"
                          >
                            ביטול
                          </button>
                        </div>
                      </>
                    )
                  })()}
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

          {/* The account's verdict on the mapping. Shown FIRST and always —
              including when it passes, because "this reconciles" is the one
              statement that lets the advisor stop gathering. Everything below
              only checks the mapping against itself. */}
          {reconciliation && (
            <div className={`rounded-xl border-2 p-3 sm:p-4 space-y-2 ${
              reconciliation.verdict === 'ok'          ? 'border-income/40 bg-income/5'
              : reconciliation.verdict === 'no-bank-data' ? 'border-line bg-surface2'
              : 'border-expense/40 bg-expense/5'
            }`}>
              <div className={`text-sm font-semibold ${
                reconciliation.verdict === 'ok'          ? 'text-income'
                : reconciliation.verdict === 'no-bank-data' ? 'text-muted-txt'
                : 'text-expense'
              }`}>
                {reconciliation.verdict === 'ok' ? '✓' : reconciliation.verdict === 'no-bank-data' ? '○' : '⚠️'}
                {' '}{reconciliation.title}
              </div>
              <div className="text-xs text-txt leading-relaxed">{reconciliation.detail}</div>
              {reconciliation.verdict !== 'no-bank-data' && (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-surface border border-line rounded-lg p-2">
                    <div className="text-[10px] text-muted-txt">בפועל בחשבון</div>
                    <div className={`text-sm font-bold tabular-nums ${reconciliation.actualPerMonth >= 0 ? 'text-income' : 'text-expense'}`}>
                      {fmt(reconciliation.actualPerMonth)}
                    </div>
                  </div>
                  <div className="bg-surface border border-line rounded-lg p-2">
                    <div className="text-[10px] text-muted-txt">לפי המיפוי</div>
                    <div className={`text-sm font-bold tabular-nums ${reconciliation.mappingPerMonth >= 0 ? 'text-income' : 'text-expense'}`}>
                      {fmt(reconciliation.mappingPerMonth)}
                    </div>
                  </div>
                  <div className="bg-surface border border-line rounded-lg p-2">
                    <div className="text-[10px] text-muted-txt">פער</div>
                    <div className={`text-sm font-bold tabular-nums ${reconciliation.verdict === 'ok' ? 'text-muted-txt' : 'text-expense'}`}>
                      {fmt(Math.abs(reconciliation.gapPerMonth))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

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
          {/* allTxns, not txns: the credit-only list left every bank-sourced
              category (health fund, mortgage, standing orders) with no פירוט at
              all, which is exactly where the advisor most needs to see what the
              row is made of. incomeRows does the same for the income section. */}
          <LabMappingView
            result={result}
            txns={allTxns}
            incomeRows={incomeRows}
            months={detectedMonths || reportMonths}
            onChange={updateResult}
          />

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
