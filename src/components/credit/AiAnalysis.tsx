'use client'

import { useState } from 'react'
import type { Transaction } from '@/types/transaction'
import { CATEGORY_ICONS } from '@/lib/constants'
import { getAuthHeader } from '@/lib/getAuthToken'

interface Props {
  transactions: Transaction[]
  reportMonths: number
}

function fmt(n: number) {
  return '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const SYSTEM_PROMPT = `אתה יועץ פיננסי מומחה לשוק הישראלי. קבל סיכום של הוצאות חודש/חודשים מכרטיסי אשראי וספק ניתוח פיננסי מקצועי ומפורט.

הניתוח שלך יכלול:
1. **תמונה כוללת** — סיכום הכנסות/הוצאות, תזרים משוער
2. **דגלים אדומים** — קטגוריות חריגות, הוצאות חוזרות גבוהות, דפוסים מדאיגים
3. **נקודות חוזקה** — דפוסים פיננסיים חיוביים
4. **המלצות** — 3-5 צעדים מעשיים לשיפור
5. **שאלות להמשך** — שאלות שהיועץ צריך לשאול את הלקוח

כתוב בעברית, בסגנון מקצועי אך נגיש. השתמש ב-markdown (כותרות, רשימות, עיצוב).`

export function AiAnalysis({ transactions, reportMonths }: Props) {
  const [analysis, setAnalysis] = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  async function runAnalysis() {
    setLoading(true)
    setError(null)

    // Build summary by category
    const totals: Record<string, number> = {}
    const counts: Record<string, number> = {}
    let totalExpenses = 0
    let totalRefunds  = 0

    transactions.forEach(t => {
      if (t.isRefund) { totalRefunds += t.amount; return }
      totals[t.category] = (totals[t.category] ?? 0) + t.amount
      counts[t.category] = (counts[t.category] ?? 0) + 1
      totalExpenses += t.amount
    })

    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1])
    const avgMonthly = Math.round(totalExpenses / Math.max(1, reportMonths))

    const lines = sorted.map(([cat, total]) => {
      const icon = CATEGORY_ICONS[cat] ?? '📦'
      const mo   = Math.round(total / Math.max(1, reportMonths))
      return `${icon} ${cat}: סה"כ ${fmt(total)} | ממוצע חודשי ${fmt(mo)} | ${counts[cat]} עסקאות`
    })

    const message = `
דוח כרטיס אשראי — ${reportMonths} חודשים

**סיכום:**
- סך הוצאות לתקופה: ${fmt(totalExpenses)}
- ממוצע חודשי: ${fmt(avgMonthly)}
- זיכויים/החזרים: ${fmt(totalRefunds)}
- מספר עסקאות: ${transactions.length}

**פירוט לפי קטגוריה:**
${lines.join('\n')}

אנא ספק ניתוח מקצועי מפורט על בסיס נתונים אלה.
`.trim()

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': await getAuthHeader() },
        body: JSON.stringify({ system: SYSTEM_PROMPT, message }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error ?? `שגיאת שרת ${res.status}`)
      }

      const data = await res.json()
      setAnalysis((data as { text?: string }).text ?? '')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface2 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-txt">🤖 ניתוח AI מלא</h2>
          <p className="text-xs text-muted-txt mt-0.5">
            Claude מנתח את כל הדוח ומייצר תובנות פיננסיות מקצועיות
          </p>
        </div>
        <button
          onClick={runAnalysis}
          disabled={loading}
          className="text-sm px-4 py-2 rounded-lg bg-gold/10 border border-gold/30 text-gold hover:bg-gold/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {loading ? (
            <>
              <span className="size-3.5 animate-spin rounded-full border-2 border-gold border-t-transparent" />
              מנתח...
            </>
          ) : (
            <>✨ הפעל ניתוח</>
          )}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-expense/10 border border-expense/30 px-4 py-3 text-sm text-expense">
          {error}
        </div>
      )}

      {analysis && (
        <div className="rounded-lg border border-line bg-surface p-5 prose prose-invert prose-sm max-w-none text-txt leading-relaxed">
          <MarkdownText text={analysis} />
        </div>
      )}
    </div>
  )
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="space-y-1.5 text-sm">
      {lines.map((line, i) => {
        if (line.startsWith('### ')) return <h3 key={i} className="text-base font-bold text-gold mt-4 mb-1">{line.slice(4)}</h3>
        if (line.startsWith('## '))  return <h2 key={i} className="text-lg font-bold text-gold mt-5 mb-2">{line.slice(3)}</h2>
        if (line.startsWith('# '))   return <h1 key={i} className="text-xl font-bold text-gold mt-5 mb-2">{line.slice(2)}</h1>
        if (line.startsWith('**') && line.endsWith('**')) {
          return <p key={i} className="font-bold text-txt">{line.slice(2, -2)}</p>
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return <li key={i} className="text-txt mr-4 list-disc">{inlineFormat(line.slice(2))}</li>
        }
        if (/^\d+\.\s/.test(line)) {
          return <li key={i} className="text-txt mr-4 list-decimal">{inlineFormat(line.replace(/^\d+\.\s/, ''))}</li>
        }
        if (line.trim() === '') return <div key={i} className="h-1" />
        return <p key={i} className="text-txt">{inlineFormat(line)}</p>
      })}
    </div>
  )
}

function inlineFormat(text: string): React.ReactNode {
  const parts = text.split(/(\*\*.*?\*\*)/g)
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="font-semibold text-gold">{part.slice(2, -2)}</strong>
      : part
  )
}
