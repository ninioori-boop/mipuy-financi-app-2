'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { callable } from '@/lib/firebase'

export interface PendingInvite {
  consentVersion: string
}

interface Props {
  invite: PendingInvite
  onResolved: () => void
}

// Shown once to an invited client at first sign-in. Not blocking the product:
// "לא עכשיו" declines and drops them into the app solo. The decision is
// reversible later from the sharing control. v1 = VIEW ONLY (no editing promise).
export function ConsentScreen({ invite, onResolved }: Props) {
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy]     = useState(false)

  async function set(status: 'active' | 'declined') {
    setBusy(true)
    try {
      await callable<{ status: string; consentVersion: string }, { ok: boolean }>('setClientSharing')(
        { status, consentVersion: invite.consentVersion },
      )
      onResolved()
    } catch (err) {
      toast.error((err as { message?: string })?.message || 'משהו השתבש, נסה/י שוב.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[100dvh] grid place-items-center p-4 bg-surface">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface2 p-5 sm:p-6 space-y-4">
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-[0.2em] text-gold/80">שיתוף עם היועץ</div>
          <h1 className="text-xl font-bold text-txt">שיתוף הנתונים שלך עם היועץ</h1>
        </div>

        <p className="text-sm text-txt leading-relaxed">
          היועץ שהזמין אותך למערכת מבקש גישה לצפייה בתמונת המצב הפיננסית שלך: הכנסות, הוצאות, חובות, חסכונות ויעדים.
        </p>

        <ul className="text-sm text-muted-txt space-y-2">
          <li>הגישה היא לצפייה בלבד. היועץ לא יכול לערוך את הנתונים שלך בשלב זה.</li>
          <li>אתה/את הבעלים של החשבון. אפשר לבטל את השיתוף בכל עת.</li>
          <li>הנתונים לא ייחשפו לאף גורם אחר מלבד היועץ שלך.</li>
        </ul>

        <label className="flex items-start gap-2.5 text-sm text-txt cursor-pointer select-none">
          <input
            type="checkbox"
            checked={agreed}
            onChange={e => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-gold shrink-0"
          />
          <span>קראתי ואני מאשר/ת ליועץ שלי לצפות בנתונים הפיננסיים שלי.</span>
        </label>

        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <button
            onClick={() => set('active')}
            disabled={!agreed || busy}
            className="min-h-[44px] flex-1 rounded-full bg-gold text-surface px-5 text-sm font-bold hover:bg-gold-light transition-colors disabled:opacity-50"
          >
            {busy ? 'רגע…' : 'אישור ושיתוף'}
          </button>
          <button
            onClick={() => set('declined')}
            disabled={busy}
            className="min-h-[44px] flex-1 rounded-full border border-line bg-surface px-5 text-sm text-muted-txt hover:text-txt hover:border-gold/40 transition-colors disabled:opacity-50"
          >
            לא עכשיו, השתמש בלי שיתוף
          </button>
        </div>
      </div>
    </div>
  )
}
