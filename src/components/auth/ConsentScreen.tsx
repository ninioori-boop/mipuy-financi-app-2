'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { callable } from '@/lib/firebase'

export interface PendingInvite {
  consentVersion: string
}

/** 'view'      = initial view-only consent (v1, legacy invites).
 *  'edit'      = advisor requested edit access on an already-shared account (v2).
 *  'view-edit' = combined consent: approve viewing AND editing in ONE screen at
 *                first sign-in (the default for new invites). */
type Variant = 'view' | 'edit' | 'view-edit'

interface Props {
  invite: PendingInvite
  variant?: Variant
  onResolved: () => void
}

const EDIT_CONSENT_VERSION = 'v2'

interface Copy {
  title: string
  intro: string
  bullets: string[]
  checkbox: string
  accept: string
  decline: string
}

const COPY: Record<Variant, Copy> = {
  view: {
    title: 'שיתוף הנתונים שלך עם היועץ',
    intro: 'היועץ שהזמין אותך למערכת מבקש גישה לצפייה בתמונת המצב הפיננסית שלך: הכנסות, הוצאות, חובות, חסכונות ויעדים.',
    bullets: [
      'הגישה היא לצפייה בלבד. היועץ לא יכול לערוך את הנתונים שלך בשלב זה.',
      'אתה/את הבעלים של החשבון. אפשר לבטל את השיתוף בכל עת.',
      'הנתונים לא ייחשפו לאף גורם אחר מלבד היועץ שלך.',
    ],
    checkbox: 'קראתי ואני מאשר/ת ליועץ שלי לצפות בנתונים הפיננסיים שלי.',
    accept: 'אישור ושיתוף',
    decline: 'לא עכשיו, השתמש בלי שיתוף',
  },
  edit: {
    title: 'אישור עריכה של היועץ',
    intro: 'היועץ שלך מבקש הרשאה לערוך את הנתונים שלך יחד איתך: עדכון מיפוי, תקציב, יעדים וסיכומי פגישות.',
    bullets: [
      'כל עריכה שהיועץ עושה נשמרת בהיסטוריית הגרסאות שלך, ואפשר לשחזר בכל עת.',
      'אתה/את הבעלים של החשבון. אפשר להפסיק את הרשאת העריכה בכל רגע.',
      'גם ללא אישור, היועץ ממשיך לראות את הנתונים שלך (צפייה בלבד).',
    ],
    checkbox: 'קראתי ואני מאשר/ת ליועץ שלי לערוך את הנתונים הפיננסיים שלי.',
    accept: 'אישור עריכה',
    decline: 'לא עכשיו, השאר צפייה בלבד',
  },
  'view-edit': {
    title: 'שיתוף הנתונים שלך עם היועץ',
    intro: 'היועץ שהזמין אותך למערכת מבקש גישה לצפות בתמונת המצב הפיננסית שלך ולערוך אותה יחד איתך: מיפוי, תקציב, יעדים וסיכומי פגישות.',
    bullets: [
      'הגישה כוללת צפייה ועריכה משותפת. אתה/את הבעלים של החשבון.',
      'כל עריכה שהיועץ עושה נשמרת בהיסטוריית הגרסאות שלך, ואפשר לשחזר בכל עת.',
      'אפשר להפסיק את השיתוף או את העריכה בכל רגע.',
      'הנתונים לא ייחשפו לאף גורם אחר מלבד היועץ שלך.',
    ],
    checkbox: 'קראתי ואני מאשר/ת ליועץ שלי לצפות בנתונים הפיננסיים שלי ולערוך אותם.',
    accept: 'אישור צפייה ועריכה',
    decline: 'לא עכשיו, בלי שיתוף',
  },
}

// Shown once to an invited client at first sign-in. The default 'view-edit'
// variant captures BOTH viewing and editing consent in a single screen (accept →
// active + access:write, v2). Legacy variants remain: 'view' (view-only invite)
// and 'edit' (a later edit request on an already-shared account). Not blocking
// the product: the secondary action declines and drops them into the app. Every
// decision is reversible later from the sharing control.
export function ConsentScreen({ invite, variant = 'view', onResolved }: Props) {
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy]     = useState(false)
  const copy = COPY[variant]

  // accept: view → active (v1); edit / view-edit → active + access:write (v2).
  // decline: view / view-edit → declined (not sharing); edit → active +
  //          access:read (stays shared, just no editing — never downgrades an
  //          existing view share).
  async function resolve(accept: boolean) {
    setBusy(true)
    try {
      let payload: Record<string, string>
      if (variant === 'view-edit') {
        payload = accept
          ? { status: 'active', consentVersion: EDIT_CONSENT_VERSION, access: 'write' }
          : { status: 'declined', consentVersion: invite.consentVersion }
      } else if (variant === 'edit') {
        payload = accept
          ? { status: 'active', consentVersion: EDIT_CONSENT_VERSION, access: 'write' }
          : { status: 'active', consentVersion: invite.consentVersion, access: 'read' }
      } else {
        payload = { status: accept ? 'active' : 'declined', consentVersion: invite.consentVersion }
      }
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
          <h1 className="text-xl font-bold text-txt">{copy.title}</h1>
        </div>

        <p className="text-sm text-txt leading-relaxed">{copy.intro}</p>

        <ul className="text-sm text-muted-txt space-y-2">
          {copy.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>

        <label className="flex items-start gap-2.5 text-sm text-txt cursor-pointer select-none">
          <input
            type="checkbox"
            checked={agreed}
            onChange={e => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-gold shrink-0"
          />
          <span>{copy.checkbox}</span>
        </label>

        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <button
            onClick={() => resolve(true)}
            disabled={!agreed || busy}
            className="min-h-[44px] flex-1 rounded-full bg-gold text-surface px-5 text-sm font-bold hover:bg-gold-light transition-colors disabled:opacity-50"
          >
            {busy ? 'רגע…' : copy.accept}
          </button>
          <button
            onClick={() => resolve(false)}
            disabled={busy}
            className="min-h-[44px] flex-1 rounded-full border border-line bg-surface px-5 text-sm text-muted-txt hover:text-txt hover:border-gold/40 transition-colors disabled:opacity-50"
          >
            {copy.decline}
          </button>
        </div>
      </div>
    </div>
  )
}
