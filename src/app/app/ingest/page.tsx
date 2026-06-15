'use client'

/**
 * Deep-link transaction receiver — the machine-facing "sender" endpoint.
 *
 * An iOS Shortcut (Wallet/Transaction automation) or an Android notification
 * listener opens:
 *     /app/ingest?merchant=<name>&amount=<number>&date=<YYYY-MM-DD>&ref=<id>
 * The logged-in PWA reads the params, auto-categorizes via the existing pure
 * categorize() + BUSINESS_DB + learnedDB, and writes through the existing
 * expenseLogStore.add() — so the entry lands in the real הוצאות tab.
 *
 * ISOLATED: new route, no backend, no firebase-admin, no rules change. It only
 * reuses categorize() and expenseLogStore, exactly like the POC sandbox.
 *
 * Two guards that matter:
 *  - Waits for `hydrated` before adding, so the entry isn't clobbered by the
 *    Firestore snapshot load (applySnapshot) that runs right after login.
 *  - Dedups on `ref` (a per-transaction id the sender can pass) within this
 *    account's log, so a page refresh / re-open can't double-log the same charge.
 */

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { categorize } from '@/lib/categorize'
import { useCreditStore } from '@/stores/creditStore'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { useSyncStore } from '@/stores/syncStore'
import { CATEGORY_ICONS } from '@/lib/constants'

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface Logged { merchant: string; amount: number; category: string; date: string }

function IngestInner() {
  const params   = useSearchParams()
  const hydrated = useSyncStore(s => s.hydrated)
  const addExpense = useExpenseLogStore(s => s.add)

  const handled = useRef(false)
  const [result, setResult] = useState<Logged | null>(null)
  const [error,  setError]  = useState<string | null>(null)
  const [dup,    setDup]    = useState(false)

  const merchant  = (params.get('merchant') ?? params.get('m') ?? '').trim()
  const amountRaw = params.get('amount') ?? params.get('a') ?? ''
  const dateRaw   = params.get('date')   ?? params.get('d') ?? ''
  const ref       = (params.get('ref')   ?? params.get('id') ?? '').trim()

  useEffect(() => {
    if (!hydrated || handled.current) return

    const amount = parseFloat(amountRaw)
    if (!merchant) { setError('חסר שם בית עסק (merchant)'); handled.current = true; return }
    if (!Number.isFinite(amount) || amount <= 0) { setError('סכום לא תקין (amount)'); handled.current = true; return }
    handled.current = true

    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : today()

    // Dedup: if this exact ref was already logged, don't add it again. The note
    // carries a hidden "#ref" tag so re-opening the same deep link is a no-op.
    const tag = ref ? ` #${ref}` : ''
    if (ref) {
      const already = useExpenseLogStore.getState().entries.some(e => e.note.endsWith(`#${ref}`))
      if (already) {
        setDup(true)
        setResult({ merchant, amount, category: '—', date })
        return
      }
    }

    const category = categorize(merchant, useCreditStore.getState().mergedLearnedDB())
    addExpense({ date, amount, category, note: merchant + tag })
    setResult({ merchant, amount, category, date })
  }, [hydrated, merchant, amountRaw, dateRaw, ref, addExpense])

  return (
    <div className="max-w-md mx-auto mt-10 space-y-4">
      {!hydrated && !error && (
        <div className="rounded-xl border border-line bg-surface2 p-6 text-center">
          <div className="size-6 mx-auto animate-spin rounded-full border-2 border-gold border-t-transparent" />
          <p className="text-sm text-muted-txt mt-3">טוען נתונים…</p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-expense/30 bg-expense/5 p-6 text-center space-y-2">
          <div className="text-3xl">⚠️</div>
          <p className="text-sm text-expense">{error}</p>
          <p className="text-xs text-muted-txt">
            פורמט: <code dir="ltr">/app/ingest?merchant=שם&amount=סכום</code>
          </p>
        </div>
      )}

      {result && !error && (
        <div className="rounded-xl border border-income/30 bg-income/5 p-6 text-center space-y-3">
          <div className="text-4xl">{dup ? '↩️' : '✅'}</div>
          <p className="text-sm font-semibold text-txt">
            {dup ? 'כבר נרשם קודם (לא נכפל)' : 'העסקה נרשמה בתיעוד ההוצאות'}
          </p>
          <div className="rounded-lg border border-line bg-surface p-4 text-start space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-lg">{CATEGORY_ICONS[result.category] ?? '📦'}</span>
              <span className="flex-1 text-txt font-medium truncate">{result.merchant}</span>
              <span className="font-bold text-gold tabular-nums">₪{result.amount.toLocaleString('he-IL')}</span>
            </div>
            {!dup && (
              <div className="text-xs text-muted-txt">
                קטגוריה: <span className="text-gold font-medium">{result.category}</span> · {result.date}
              </div>
            )}
          </div>
          <Link
            href="/app/expenses"
            className="inline-block w-full py-2.5 rounded-lg bg-gold/20 border border-gold/40 text-gold font-bold text-sm hover:bg-gold/30 transition-colors"
          >
            פתח תיעוד הוצאות →
          </Link>
        </div>
      )}
    </div>
  )
}

export default function IngestPage() {
  return (
    <Suspense fallback={<div className="text-center text-muted-txt mt-10 text-sm">טוען…</div>}>
      <IngestInner />
    </Suspense>
  )
}
