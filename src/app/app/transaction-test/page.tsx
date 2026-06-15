'use client'

/**
 * POC — Auto-categorized transaction ingestion (Apple Pay / Google Pay vision).
 *
 * ISOLATED SANDBOX. This route is NOT in the tab nav — reach it directly at
 * /app/transaction-test. It only READS the existing pure `categorize()` logic
 * and WRITES through the existing `expenseLogStore.add()` action. It touches no
 * other tab, store, or file, so it cannot break anything already in the system.
 *
 * What it proves: a transaction arriving as { merchant, amount, date } is
 * auto-categorized (via BUSINESS_DB + the account's learnedDB) and lands in the
 * real expense log — exactly the loop an iOS Shortcut or an Android notification
 * listener would drive. Here the "sender" is a manual form so it can be tested
 * in a browser on any device, with no iPhone, no native app, and no server.
 */

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { categorize } from '@/lib/categorize'
import { useCreditStore } from '@/stores/creditStore'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { CATEGORY_ICONS } from '@/lib/constants'

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface LoggedItem { merchant: string; amount: number; category: string; date: string }

export default function TransactionTestPage() {
  const [merchant, setMerchant] = useState('')
  const [amount,   setAmount]   = useState('')
  const [date,     setDate]     = useState(today())
  const [session,  setSession]  = useState<LoggedItem[]>([])

  const addExpense = useExpenseLogStore(s => s.add)

  // Live category preview as the merchant name is typed — same lookup the real
  // ingestion would run. Recomputed on each keystroke (cheap, pure function).
  const preview = useMemo(() => {
    const m = merchant.trim()
    if (!m) return null
    return categorize(m, useCreditStore.getState().mergedLearnedDB())
  }, [merchant])

  function submit() {
    const m   = merchant.trim()
    const amt = parseFloat(amount)
    if (!m) { toast.error('הזן שם בית עסק'); return }
    if (!Number.isFinite(amt) || amt <= 0) { toast.error('הזן סכום תקין'); return }

    const category = categorize(m, useCreditStore.getState().mergedLearnedDB())
    addExpense({ date, amount: amt, category, note: m })
    setSession(s => [{ merchant: m, amount: amt, category, date }, ...s])
    toast.success(`✅ נרשם: ${m} → ${category}`)
    setMerchant('')
    setAmount('')
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-6">
        <h1 className="text-2xl font-bold text-gold mb-1">🧪 קליטת עסקה אוטומטית — POC</h1>
        <p className="text-muted-txt text-sm">
          הדמיית עסקה (Apple Pay / Google Pay): שם בית עסק + סכום → המערכת מזהה קטגוריה
          אוטומטית ורושמת ב<strong>תיעוד ההוצאות</strong>. זו בדיוק הזרימה שקיצור-דרך ב-iOS
          או מאזין-התראות באנדרואיד יפעילו — כאן הטופס הוא ה"שולח", לבדיקה בכל דפדפן.
        </p>
      </div>

      {/* Form */}
      <div className="rounded-xl border border-line bg-surface2 p-6 space-y-4">
        <div>
          <label className="text-xs font-semibold text-muted-txt">שם בית עסק</label>
          <input
            value={merchant}
            onChange={e => setMerchant(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
            placeholder="לדוגמה: רמי לוי, פז, קפה ארומה"
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt focus:outline-none focus:border-gold/60"
          />
          {preview && (
            <div className="mt-2 text-sm">
              <span className="text-muted-txt">קטגוריה שזוהתה: </span>
              <span className="font-bold text-gold">
                {CATEGORY_ICONS[preview] ?? '📦'} {preview}
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-muted-txt">סכום (₪)</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
              min={0}
              placeholder="0"
              style={{ direction: 'ltr' }}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt text-left tabular-nums focus:outline-none focus:border-gold/60"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-txt">תאריך</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              style={{ direction: 'ltr' }}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt focus:outline-none focus:border-gold/60"
            />
          </div>
        </div>

        <button
          onClick={submit}
          className="w-full py-2.5 rounded-lg bg-gold/20 border border-gold/40 text-gold font-bold text-sm hover:bg-gold/30 transition-colors"
        >
          רשום הוצאה ↵
        </button>
      </div>

      {/* Session log */}
      {session.length > 0 && (
        <div className="rounded-xl border border-line bg-surface2 p-6 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-txt">נרשמו בבדיקה זו ({session.length})</h2>
            <span className="text-xs text-muted-txt">↩ נכנסו גם לתיעוד ההוצאות האמיתי</span>
          </div>
          {session.map((it, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm">
              <span className="text-lg shrink-0">{CATEGORY_ICONS[it.category] ?? '📦'}</span>
              <span className="flex-1 text-txt truncate">{it.merchant}</span>
              <span className="text-xs text-muted-txt shrink-0">{it.category}</span>
              <span className="font-bold text-gold tabular-nums shrink-0">
                ₪{it.amount.toLocaleString('he-IL')}
              </span>
            </div>
          ))}
          <p className="text-xs text-muted-txt pt-2">
            פתח את טאב <strong>הוצאות</strong> כדי לראות את הרשומות מצטברות שם בזמן אמת.
          </p>
        </div>
      )}
    </div>
  )
}
