'use client'

import { useState } from 'react'
import { signOut, type User } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { Button } from '@/components/ui/button'

// Shown when a signed-in account is not on the allowlist.
//
// It exists because of what used to happen instead: the account was created,
// firestore.rules silently refused every read and write, and the person sat in
// an app that loaded but never filled in — or, for a password sign-up, on the
// verify-email screen waiting for mail sent to an address that cannot exist.
// A real client spent 90 minutes there on 2026-08-11 after typing `gmail.con`.
//
// This screen is a COURTESY, not a security control: the rules refuse the data
// either way, and the paid AI routes check the allowlist server-side. Its whole
// job is to replace a silent dead end with the actionable sentence.
export function NotInvitedScreen({ user, onRecheck }: {
  user: User
  /** Re-ask the server. A client often lands here minutes before the advisor
   *  runs /approve, and "sign out and back in" is a poor answer to "try now". */
  onRecheck: () => Promise<boolean | null>
}) {
  const [busy, setBusy] = useState(false)
  const [stillNot, setStillNot] = useState(false)

  async function recheck() {
    setBusy(true); setStillNot(false)
    try {
      const answer = await onRecheck()
      // true unmounts this screen; null means we could not tell, and saying
      // "still not invited" then would be a claim we cannot support.
      if (answer === false) setStillNot(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-surface px-4">
      <div className="max-w-md w-full rounded-xl border border-line bg-surface2 p-6 space-y-4 text-center">
        <div className="text-3xl">🔒</div>
        <h2 className="text-lg font-bold text-txt">הכתובת הזאת לא מופיעה ברשימת המוזמנים</h2>
        <p className="text-sm text-muted-txt leading-relaxed">
          נכנסת עם <span dir="ltr" className="text-txt">{user.email || 'חשבון ללא כתובת מייל'}</span>.
          הכניסה למערכת היא בהזמנה בלבד.
        </p>
        {/* Neutral on purpose: this screen also meets a client whose access was
            deliberately ended (/revoke removes the allowlist entry and leaves
            the account alive). Leading with "you probably made a typo" would be
            wrong, and unkind, for exactly that person. */}
        <p className="text-xs text-muted-txt leading-relaxed">
          ייתכן שיש טעות קטנה בכתובת, למשל סיומת שגויה, וייתכן שהגישה הסתיימה. כדאי לוודא שזו בדיוק
          הכתובת שאליה נשלחה ההזמנה, ואם היא נכונה, לפנות ליועץ שלכם.
        </p>

        {stillNot && <p className="text-expense text-xs">עדיין לא מופיע ברשימה</p>}

        <div className="space-y-2">
          <Button
            onClick={recheck}
            disabled={busy}
            className="w-full bg-gold hover:bg-gold-light text-surface font-semibold h-10"
          >
            בדוק שוב
          </Button>
          <Button
            onClick={() => signOut(auth)}
            disabled={busy}
            variant="outline"
            className="w-full border-line text-txt h-10"
          >
            כניסה עם חשבון אחר
          </Button>
        </div>
      </div>
    </div>
  )
}
