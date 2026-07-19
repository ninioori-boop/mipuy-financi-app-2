'use client'

import { useState } from 'react'
import { useGoalsStore } from '@/stores/goalsStore'
import {
  analyzeShortTerm, analyzeMediumTerm, analyzeLongTerm,
  SHORT_TERM_PRINCIPLES, MEDIUM_TERM_PRINCIPLES, LONG_TERM_PRINCIPLES,
  SHORT_DISCLAIMER, MEDIUM_DISCLAIMER, LONG_DISCLAIMER,
  type GoalFacts,
} from '@/lib/goalsAnalysis'

// Goal analysis card, one per horizon. Lab-gated by the caller (goals page), so
// regular clients never see it.
//
// The analysis itself is deterministic (see lib/goalsAnalysis.ts) — this
// component only asks the one shared question the rules need (US citizenship,
// which gates the PFIC branch) and renders what the engine returns. The per-goal
// inputs (short: liquidity; medium: risk + investor type) are marked on the goals
// themselves; when one is missing the engine returns a choicePrompt instead of a
// direction.

type Horizon = 'short' | 'medium' | 'long'

const COPY: Record<Horizon, { title: string; sub: string; principles: string; disclaimer: string }> = {
  short: {
    title:      '🧭 ניתוח יעדים · טווח קצר',
    sub:        'קריאה של המטרות שלך לטווח קצר, וכיוון חשיבה לכל אחת. לא המלצה.',
    principles: SHORT_TERM_PRINCIPLES,
    disclaimer: SHORT_DISCLAIMER,
  },
  medium: {
    title:      '🧭 ניתוח יעדים · טווח בינוני',
    sub:        'קריאה של המטרות שלך לטווח בינוני, וכיוון חשיבה לכל אחת. לא המלצה.',
    principles: MEDIUM_TERM_PRINCIPLES,
    disclaimer: MEDIUM_DISCLAIMER,
  },
  long: {
    title:      '🧭 ניתוח יעדים · טווח ארוך',
    sub:        'קריאה של המטרות שלך לטווח ארוך, וכיוון חשיבה לכל אחת. לא המלצה.',
    principles: LONG_TERM_PRINCIPLES,
    disclaimer: LONG_DISCLAIMER,
  },
}

interface Props {
  horizon:       Horizon
  /** Goals for this horizon, with months already computed by the caller. */
  facts:         GoalFacts[]
  /** Monthly savings budget from the checking tab; 0 = unknown. */
  monthlyBudget: number
}

export function GoalsAnalysis({ horizon, facts, monthlyBudget }: Props) {
  const isUSCitizen    = useGoalsStore(s => s.isUSCitizen)
  const setIsUSCitizen = useGoalsStore(s => s.setIsUSCitizen)

  const [showResults, setShowResults] = useState(false)
  const [asking, setAsking]           = useState(false)

  const copy     = COPY[horizon]
  const hasGoals = facts.some(g => g.name.trim() || g.required > 0)

  function start() {
    if (!hasGoals) return
    // The citizenship answer gates the whole product family (PFIC), so we ask
    // it once before the first analysis and remember it after that. It's stored
    // globally, so a horizon that runs later reuses the earlier answer.
    if (isUSCitizen === null) { setAsking(true); return }
    setShowResults(true)
  }

  function answer(v: boolean) {
    setIsUSCitizen(v)
    setAsking(false)
    setShowResults(true)
  }

  const analyze =
    horizon === 'short'  ? analyzeShortTerm
    : horizon === 'medium' ? analyzeMediumTerm
    : analyzeLongTerm
  const results = showResults
    ? analyze(facts, { isUSCitizen: isUSCitizen === true, monthlyBudget })
    : []

  return (
    <div className="rounded-xl border border-gold/40 bg-gold/5 p-4 sm:p-5 space-y-4">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-bold text-gold">{copy.title}</h2>
          <p className="text-xs text-muted-txt mt-0.5">{copy.sub}</p>
        </div>
        {!asking && (
          <button
            onClick={() => (showResults ? setShowResults(false) : start())}
            disabled={!hasGoals}
            className="shrink-0 rounded-lg bg-gold text-surface px-4 py-2 min-h-[44px] inline-flex items-center justify-center text-sm font-bold hover:bg-gold-light transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {showResults ? 'סגור' : '🧭 הרץ ניתוח'}
          </button>
        )}
      </div>

      {!hasGoals && (
        <p className="text-xs text-muted-txt">הוסף מטרה כדי להריץ ניתוח.</p>
      )}

      {/* The one question the rules need before they can run */}
      {asking && (
        <div className="rounded-lg border border-gold/40 bg-surface2 p-4 space-y-3">
          <div className="text-sm font-semibold text-txt">שאלה אחת לפני שמתחילים</div>
          <p className="text-xs text-muted-txt leading-relaxed">
            האם אתה אזרח אמריקאי (או בעל גרין קארד)? זה משנה מהותית את סוגי המוצרים
            שמתאימים לך, בגלל חוק המס האמריקאי PFIC.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => answer(true)}
              className="rounded-lg border border-gold/40 bg-gold/10 text-gold px-4 py-2 min-h-[44px] inline-flex items-center justify-center text-sm font-semibold hover:bg-gold/20 transition-colors"
            >
              כן, אזרח אמריקאי
            </button>
            <button
              onClick={() => answer(false)}
              className="rounded-lg border border-line bg-surface text-txt px-4 py-2 min-h-[44px] inline-flex items-center justify-center text-sm font-semibold hover:border-gold/40 transition-colors"
            >
              לא
            </button>
            <button
              onClick={() => setAsking(false)}
              className="text-xs text-muted-txt hover:text-txt transition-colors ms-1 min-h-[44px] px-3 inline-flex items-center"
            >
              ביטול
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {showResults && (
        <div className="space-y-3">
          <div className="rounded-lg border border-line bg-surface2 p-3 text-xs text-muted-txt leading-relaxed">
            {copy.principles}
            <div className="mt-1.5">
              סטטוס: {isUSCitizen ? 'אזרח אמריקאי (פיקדונות / ברוקר אמריקאי, ללא קרנות ישראליות)' : 'לא אזרח אמריקאי'}
              <button
                onClick={() => { setShowResults(false); setAsking(true) }}
                className="text-gold hover:underline ms-2 inline-block px-1 py-2 -my-2"
              >
                שנה
              </button>
            </div>
          </div>

          {results.map(r => (
            <div key={r.id} className="rounded-lg border border-line bg-surface2 p-3 sm:p-4 space-y-2">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <h3 className="font-bold text-txt min-w-0 break-words">🎯 {r.name || 'מטרה ללא שם'}</h3>
                <span className="text-[11px] text-muted-txt">{r.facts}</span>
              </div>

              {r.opinion && (
                <p className="text-sm text-txt leading-relaxed whitespace-pre-line">{r.opinion}</p>
              )}

              {r.choicePrompt && (
                <p className="text-sm text-gold leading-relaxed">{r.choicePrompt}</p>
              )}

              {r.notes.map((n, i) => (
                <p key={i} className="text-xs text-muted-txt leading-relaxed">{n}</p>
              ))}
            </div>
          ))}

          <p className="text-[11px] text-muted-txt leading-relaxed border-t border-line pt-3">
            ⚠️ {copy.disclaimer}
          </p>
        </div>
      )}
    </div>
  )
}
