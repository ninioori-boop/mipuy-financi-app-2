'use client'

import { useState } from 'react'
import { sendEmailVerification, signOut, type User } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { Button } from '@/components/ui/button'

// Full-screen gate for a PASSWORD account whose email is not verified yet.
//
// Why blocking: the email claim is what connects an account to its advisor
// invite (clientLinks pending_{email} + setClientSharing), and since the
// invite-squatting fix both trust the claim only when Firebase verified it.
// Every existing password account was migrated to verified=true
// (scripts/verify-legacy-emails.ts), so this screen only ever meets NEW
// password sign-ups — for whom "verify, then continue" is the whole point.
// Google / custom-token sessions never see it (no 'password' provider).
export function VerifyEmailScreen({ user }: { user: User }) {
  const [sent, setSent]       = useState(false)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [stillNot, setStillNot] = useState(false)

  async function resend() {
    setBusy(true); setError(null)
    try {
      await sendEmailVerification(user, { url: `${window.location.origin}/auth` })
      setSent(true)
    } catch {
      setError('שליחת המייל נכשלה — נסה שוב בעוד רגע.')
    } finally {
      setBusy(false)
    }
  }

  async function recheck() {
    setBusy(true); setError(null); setStillNot(false)
    try {
      await user.reload()
      if (user.emailVerified) {
        // The ID token must be re-minted to carry email_verified=true (the
        // security rules read the TOKEN, not the account), then a full reload
        // brings the app up with the fresh claims everywhere.
        await user.getIdToken(true)
        window.location.reload()
        return
      }
      setStillNot(true)
    } catch {
      setError('הבדיקה נכשלה — נסה שוב.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-surface px-4">
      <div className="max-w-md w-full rounded-xl border border-line bg-surface2 p-6 space-y-4 text-center">
        <div className="text-3xl">📬</div>
        <h2 className="text-lg font-bold text-txt">נשאר צעד אחד — אימות המייל</h2>
        <p className="text-sm text-muted-txt">
          שלחנו קישור אימות אל <span dir="ltr" className="text-txt">{user.email}</span>.
          לחץ על הקישור במייל, וחזור לכאן.
        </p>
        <p className="text-xs text-muted-txt">
          האימות מגן על החשבון שלך: הוא מוודא שהזמנות מהיועץ מגיעות רק לבעל הכתובת האמיתי.
        </p>

        {sent     && <p className="text-income text-xs">✅ מייל אימות נשלח שוב — בדוק גם בספאם</p>}
        {stillNot && <p className="text-expense text-xs">עדיין לא מאומת — ודא שלחצת על הקישור במייל</p>}
        {error    && <p className="text-expense text-xs">{error}</p>}

        <div className="space-y-2">
          <Button onClick={recheck} disabled={busy}
            className="w-full bg-gold hover:bg-gold-light text-surface font-semibold h-10">
            אימתתי — המשך
          </Button>
          <Button onClick={resend} disabled={busy} variant="outline"
            className="w-full border-line text-txt h-10">
            שלח שוב את מייל האימות
          </Button>
        </div>

        {/* The way OUT, not a footnote. A client who registered with a typo'd
            address (`...@gmail.con`) can never receive this mail, so "send
            again" is an infinite loop for her — and the only escape used to be
            a text-xs link she never noticed. Whoever is stuck here is far more
            likely to be looking at the wrong address than at a slow inbox. */}
        <div className="border-t border-line pt-3 space-y-2">
          <p className="text-xs text-muted-txt leading-relaxed">
            לא מקבל את המייל? בדוק שהכתובת למעלה מדויקת. אם יש בה טעות, המייל לא יגיע לעולם,
            וצריך להתחבר מחדש עם הכתובת הנכונה.
          </p>
          <Button onClick={() => signOut(auth)} variant="outline"
            className="w-full border-gold/50 text-gold hover:bg-gold/10 h-10">
            הכתובת שגויה — כניסה עם חשבון אחר
          </Button>
        </div>
      </div>
    </div>
  )
}
