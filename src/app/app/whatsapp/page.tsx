'use client'

import { useState } from 'react'
import { getIdToken } from 'firebase/auth'
import { auth } from '@/lib/firebase'

// The product bot's WhatsApp number (digits only, no +). The default is the real
// production number — deliberately not left to an env var, because a missing one
// used to fall back to the Meta test number, which reaches ~5 verified recipients
// and would silently swallow every client's very first message.
// NEXT_PUBLIC_WA_BOT_NUMBER still overrides it, for a per-firm number later on.
const WA_BOT_NUMBER = process.env.NEXT_PUBLIC_WA_BOT_NUMBER || '972542544043'

// Same number, formatted for a human to dial or search for by hand — the escape
// hatch when the wa.me handoff fails on a device we cannot test.
const DISPLAY_NUMBER = WA_BOT_NUMBER.startsWith('972')
  ? `0${WA_BOT_NUMBER.slice(3)}`.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3')
  : `+${WA_BOT_NUMBER}`

type Phase = 'idle' | 'loading' | 'ready' | 'error'

/**
 * WhatsApp linking screen. A logged-in client requests a one-time code, then
 * sends it to the product bot once — the bot binds their phone to their account
 * (whatsappLinks). From then on they log expenses and ask questions in chat.
 */
export default function WhatsAppLinkPage() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  async function generate() {
    setPhase('loading')
    setError('')
    try {
      const user = auth.currentUser
      if (!user) throw new Error('צריך להתחבר קודם')
      const idToken = await getIdToken(user, /* forceRefresh */ true)
      const res = await fetch('/api/wa-link-code', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'לא הצלחנו ליצור קוד')
      setCode(data.code as string)
      setPhase('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה לא צפויה')
      setPhase('error')
    }
  }

  const waHref = `https://wa.me/${WA_BOT_NUMBER}?text=${encodeURIComponent(`קוד ${code}`)}`

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8 text-txt">
      <h1 className="text-2xl font-bold text-gold mb-1">עוזר פיננסי בוואטסאפ</h1>
      <p className="text-muted-txt text-sm mb-6">
        חברו את הוואטסאפ פעם אחת, ותנהלו את הכסף ישירות מהצ'אט, בלי לפתוח את האפליקציה.
      </p>

      {/* How the bot helps */}
      <ul className="mb-8 space-y-2.5">
        {[
          { icon: '🧾', title: 'תיעוד במשפט', body: `כתבו "קניתי ב-50 בסופר" והבוט רושם אוטומטית בקטגוריה הנכונה, ישר לתיעוד ההוצאות, עם התראה אם חרגתם מהתקציב.` },
          { icon: '💬', title: 'שאלות על הכסף', body: `שאלו "כמה נשאר לי לאוכל החודש?" וקבלו תשובה מיידית.` },
          { icon: '⚡', title: 'בלי לפתוח את האפליקציה', body: `הכול קורה בצ'אט שאתם ממילא נמצאים בו כל היום.` },
          { icon: '🔒', title: 'פרטי ומאובטח', body: `מקושר רק לחשבון שלכם, אחרי חיבור חד-פעמי.` },
        ].map(f => (
          <li key={f.title} className="flex gap-3 rounded-xl border border-line bg-surface2 p-3">
            <span className="text-xl leading-none shrink-0">{f.icon}</span>
            <div>
              <p className="text-sm font-semibold text-txt">{f.title}</p>
              <p className="text-xs text-muted-txt leading-relaxed mt-0.5">{f.body}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="rounded-2xl border border-line bg-surface2 p-5">
        {phase === 'ready' ? (
          <>
            <p className="text-txt text-sm font-semibold text-center mb-2">קוד החיבור שלך</p>
            <div
              dir="ltr"
              className="mx-auto mb-1 w-fit rounded-xl border border-gold/40 bg-surface px-6 py-3 text-3xl font-bold tracking-[0.3em] text-gold select-all"
            >
              {code}
            </div>
            <p className="text-muted-txt text-xs text-center mb-5">בתוקף ל-15 דקות</p>

            {/* Deliberately NOT target="_blank": inside the native Android shell
                this page runs in a WebView, and a WebView opens no new window
                unless the host app implements onCreateWindow — so _blank made
                the button do nothing at all. A same-frame navigation instead
                reaches shouldOverrideUrlLoading, which is what hands the link
                to WhatsApp. Browsers behave the same either way. */}
            <a
              href={waHref}
              rel="noreferrer"
              className="block w-full bg-gold text-surface font-bold rounded-xl px-6 py-3 text-center hover:bg-gold-light transition-colors"
            >
              פתח וואטסאפ ושלח את הקוד
            </a>
            <p className="text-muted-txt text-xs text-center mt-3 leading-relaxed">
              נפתח צ'אט עם הבוט והקוד כבר מוכן, רק לשלוח. אחרי זה אפשר לכתוב לו
              "קניתי ב-50 בסופר" או "כמה נשאר לי לאוכל?".
            </p>

            {/* Never a dead end: if the handoff fails on some device, the code
                and the number are both on screen, so the link is a shortcut and
                not the only way through. */}
            <p className="text-muted-txt text-xs text-center mt-4 leading-relaxed border-t border-line pt-4">
              הכפתור לא עבד? פתחו וואטסאפ ידנית, התחילו צ'אט עם{' '}
              <span dir="ltr" className="text-gold font-semibold select-all">{DISPLAY_NUMBER}</span>
              {' '}ושלחו את ההודעה: <span className="text-gold font-semibold select-all">קוד {code}</span>
            </p>

            <button
              onClick={generate}
              className="mt-4 w-full text-xs text-muted-txt underline hover:text-gold transition-colors"
            >
              צור קוד חדש
            </button>
          </>
        ) : (
          <>
            <p className="text-txt text-sm text-center leading-relaxed mb-5">
              ליצירת חיבור, הפיקו קוד חד-פעמי ושלחו אותו לבוט בוואטסאפ. פעם אחת בלבד.
            </p>
            <button
              onClick={generate}
              disabled={phase === 'loading'}
              className="w-full bg-gold text-surface font-bold rounded-xl px-6 py-3 hover:bg-gold-light transition-colors disabled:opacity-50"
            >
              {phase === 'loading' ? 'יוצר קוד…' : 'צור קוד חיבור'}
            </button>
            {phase === 'error' && <p className="text-expense text-sm text-center mt-4">{error}</p>}
          </>
        )}
      </div>
    </main>
  )
}
