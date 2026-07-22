'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { callable } from '@/lib/firebase'

export interface PendingInvite {
  consentVersion: string
}

interface Props {
  invite: PendingInvite
  /** 'view' = initial view-only consent (v1). 'edit' = advisor requested edit
   *  access on an already-shared account (v2). */
  variant?: 'view' | 'edit'
  onResolved: () => void
}

const EDIT_CONSENT_VERSION = 'v2'

// Shown once to an invited client at first sign-in (view variant) or when the
// advisor requests edit access (edit variant). Not blocking the product: the
// secondary action declines and drops them into the app. Both decisions are
// reversible later from the sharing control.
export function ConsentScreen({ invite, variant = 'view', onResolved }: Props) {
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy]     = useState(false)
  const isEdit = variant === 'edit'

  // accept: view → active (v1); edit → active + access:write (v2).
  // decline: view → declined (not sharing); edit → active + access:read (stays
  //          shared, just no editing — never downgrades an existing view share).
  async function resolve(accept: boolean) {
    setBusy(true)
    try {
      const payload: Record<string, string> = isEdit
        ? accept
          ? { status: 'active', consentVersion: EDIT_CONSENT_VERSION, access: 'write' }
          : { status: 'active', consentVersion: invite.consentVersion, access: 'read' }
        : { status: accept ? 'active' : 'declined', consentVersion: invite.consentVersion }
      await callable<Record<string, string>, { ok: boolean }>('setClientSharing')(payload)
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
          <h1 className="text-xl font-bold text-txt">
            {isEdit ? 'אישור עריכה של היועץ' : 'שיתוף הנתונים שלך עם היועץ'}
          </h1>
        </div>

        <p className="text-sm text-txt leading-relaxed">
          {isEdit
            ? 'היועץ שלך מבקש הרשאה לערוך את הנתונים שלך יחד איתך: עדכון מיפוי, תקציב, יעדים וסיכומי פגישות.'
            : 'היועץ שהזמין אותך למערכת מבקש גישה לצפייה בתמונת המצב הפיננסית שלך: הכנסות, הוצאות, חובות, חסכונות ויעדים.'}
        </p>

        <ul className="text-sm text-muted-txt space-y-2">
          {isEdit ? (
            <>
              <li>כל עריכה שהיועץ עושה נשמרת בהיסטוריית הגרסאות שלך, ואפשר לשחזר בכל עת.</li>
              <li>אתה/את הבעלים של החשבון. אפשר להפסיק את הרשאת העריכה בכל רגע.</li>
              <li>גם ללא אישור, היועץ ממשיך לראות את הנתונים שלך (צפייה בלבד).</li>
            </>
          ) : (
            <>
              <li>הגישה היא לצפייה בלבד. היועץ לא יכול לערוך את הנתונים שלך בשלב זה.</li>
              <li>אתה/את הבעלים של החשבון. אפשר לבטל את השיתוף בכל עת.</li>
              <li>הנתונים לא ייחשפו לאף גורם אחר מלבד היועץ שלך.</li>
            </>
          )}
        </ul>

        <label className="flex items-start gap-2.5 text-sm text-txt cursor-pointer select-none">
          <input
            type="checkbox"
            checked={agreed}
            onChange={e => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-gold shrink-0"
          />
          <span>
            {isEdit
              ? 'קראתי ואני מאשר/ת ליועץ שלי לערוך את הנתונים הפיננסיים שלי.'
              : 'קראתי ואני מאשר/ת ליועץ שלי לצפות בנתונים הפיננסיים שלי.'}
          </span>
        </label>

        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <button
            onClick={() => resolve(true)}
            disabled={!agreed || busy}
            className="min-h-[44px] flex-1 rounded-full bg-gold text-surface px-5 text-sm font-bold hover:bg-gold-light transition-colors disabled:opacity-50"
          >
            {busy ? 'רגע…' : isEdit ? 'אישור עריכה' : 'אישור ושיתוף'}
          </button>
          <button
            onClick={() => resolve(false)}
            disabled={busy}
            className="min-h-[44px] flex-1 rounded-full border border-line bg-surface px-5 text-sm text-muted-txt hover:text-txt hover:border-gold/40 transition-colors disabled:opacity-50"
          >
            {isEdit ? 'לא עכשיו, השאר צפייה בלבד' : 'לא עכשיו, השתמש בלי שיתוף'}
          </button>
        </div>
      </div>
    </div>
  )
}
