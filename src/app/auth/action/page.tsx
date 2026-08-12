'use client'

import { useEffect, useState } from 'react'
import {
  applyActionCode, checkActionCode, verifyPasswordResetCode, confirmPasswordReset,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { Button } from '@/components/ui/button'

// Firebase's email ACTION HANDLER — the page every link in a Firebase-sent mail
// lands on (verify your address, reset your password, undo an email change).
//
// Why this page exists: the project's action handler was pointed at
// `https://orimipuy.com/reset.html`, a page in the OLD app that opens with
//   if (mode !== 'resetPassword' || !oobCode) { showError('קישור לא תקין…') }
// so EVERY verification link ever sent was answered with "קישור לא תקין. חזור
// לעמוד ההתחברות ובקש איפוס חדש" — a message about password resets, shown to
// someone trying to verify their email. Password sign-ups could therefore never
// verify at all; two clients hit it before anyone worked out why, and the only
// workaround was signing in with Google (which needs no link). Discovered
// 2026-08-11.
//
// Handles every mode Firebase can send, so a new one never lands on a page that
// only knows about one of them.

type Mode = 'verifyEmail' | 'resetPassword' | 'recoverEmail' | 'verifyAndChangeEmail'
type View = 'working' | 'password-form' | 'done' | 'error'

// An open redirect on an auth page hands an attacker a credible phishing hop,
// so a continueUrl is honoured only for hosts we actually own.
const ALLOWED_HOSTS = [
  'app.orimipuy.com', 'orimipuy.com', 'www.orimipuy.com',
  'mipuy-financi-app-2-3nay.vercel.app', 'localhost',
]
const DEFAULT_CONTINUE = '/auth'

function safeContinue(raw: string | null): string {
  if (!raw) return DEFAULT_CONTINUE
  try {
    const u = new URL(raw, window.location.origin)
    const ok = (u.protocol === 'https:' || u.hostname === 'localhost')
      && ALLOWED_HOSTS.includes(u.hostname)
    return ok ? u.href : DEFAULT_CONTINUE
  } catch {
    return DEFAULT_CONTINUE
  }
}

function hebrewError(code?: string): string {
  switch (code) {
    case 'auth/expired-action-code':  return 'הקישור פג תוקף. אפשר לבקש קישור חדש מעמוד הכניסה.'
    case 'auth/invalid-action-code':  return 'הקישור אינו תקף או שכבר נוצל. אפשר לבקש קישור חדש מעמוד הכניסה.'
    case 'auth/user-disabled':        return 'החשבון הושבת. פנו ליועץ שלכם.'
    case 'auth/user-not-found':       return 'החשבון לא נמצא.'
    case 'auth/weak-password':        return 'הסיסמה קצרה מדי, לפחות 6 תווים.'
    default:                          return 'משהו השתבש. אפשר לבקש קישור חדש מעמוד הכניסה.'
  }
}

export default function AuthActionPage() {
  const [view, setView]   = useState<View>('working')
  const [title, setTitle] = useState('רגע…')
  const [detail, setDetail] = useState('')
  const [cont, setCont]   = useState(DEFAULT_CONTINUE)
  const [oob, setOob]     = useState('')
  const [pw1, setPw1]     = useState('')
  const [pw2, setPw2]     = useState('')
  const [busy, setBusy]   = useState(false)
  const [formErr, setFormErr] = useState('')

  // Read the query with the DOM rather than useSearchParams: this page must
  // render without a Suspense boundary, and it only ever runs in the browser.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const mode = q.get('mode') as Mode | null
    const oobCode = q.get('oobCode') ?? ''
    setCont(safeContinue(q.get('continueUrl')))
    setOob(oobCode)

    if (!mode || !oobCode) {
      setView('error')
      setTitle('הקישור לא שלם')
      setDetail('כדאי לפתוח את הקישור מהמייל עצמו, בלי להעתיק חלקים ממנו.')
      return
    }

    ;(async () => {
      try {
        if (mode === 'resetPassword') {
          const email = await verifyPasswordResetCode(auth, oobCode)
          setTitle('בחירת סיסמה חדשה')
          setDetail(email)
          setView('password-form')
          return
        }

        if (mode === 'recoverEmail') {
          const info = await checkActionCode(auth, oobCode)
          await applyActionCode(auth, oobCode)
          setTitle('כתובת המייל שוחזרה')
          setDetail(info.data.email ?? '')
          setView('done')
          return
        }

        // verifyEmail / verifyAndChangeEmail
        await applyActionCode(auth, oobCode)
        // The signed-in session still carries email_verified=false until the
        // token is re-minted — the security rules read the TOKEN, not the
        // account — so refresh it here. Without this the client verifies
        // successfully and the app still shows them the verification screen.
        try {
          if (auth.currentUser) {
            await auth.currentUser.reload()
            await auth.currentUser.getIdToken(true)
          }
        } catch { /* verification itself already succeeded */ }
        setTitle('הכתובת אומתה ✓')
        setDetail('אפשר להמשיך למערכת.')
        setView('done')
      } catch (e) {
        setView('error')
        setTitle('הקישור לא עבד')
        setDetail(hebrewError((e as { code?: string }).code))
      }
    })()
  }, [])

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    setFormErr('')
    if (pw1.length < 6)  { setFormErr('הסיסמה חייבת להיות לפחות 6 תווים.'); return }
    if (pw1 !== pw2)     { setFormErr('הסיסמאות אינן תואמות.'); return }
    setBusy(true)
    try {
      await confirmPasswordReset(auth, oob, pw1)
      setTitle('הסיסמה עודכנה ✓')
      setDetail('אפשר להיכנס עכשיו עם הסיסמה החדשה.')
      setView('done')
    } catch (err) {
      setFormErr(hebrewError((err as { code?: string }).code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-surface px-4">
      <div className="max-w-md w-full rounded-xl border border-line bg-surface2 p-6 space-y-4 text-center">
        <div className="text-3xl">
          {view === 'error' ? '⚠️' : view === 'done' ? '✅' : view === 'password-form' ? '🔑' : '⏳'}
        </div>
        <h1 className="text-lg font-bold text-txt">{title}</h1>
        {detail && (
          <p className="text-sm text-muted-txt leading-relaxed" dir={view === 'password-form' ? 'ltr' : undefined}>
            {detail}
          </p>
        )}

        {view === 'password-form' && (
          <form onSubmit={submitPassword} className="space-y-3">
            <input
              type="password" dir="ltr" required minLength={6} value={pw1}
              onChange={e => setPw1(e.target.value)} placeholder="סיסמה חדשה (לפחות 6 תווים)"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
            />
            <input
              type="password" dir="ltr" required minLength={6} value={pw2}
              onChange={e => setPw2(e.target.value)} placeholder="שוב, לאימות"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
            />
            {formErr && <p className="text-expense text-xs">{formErr}</p>}
            <Button type="submit" disabled={busy}
              className="w-full bg-gold hover:bg-gold-light text-surface font-semibold h-10">
              {busy ? 'מעדכן…' : 'שמירת הסיסמה'}
            </Button>
          </form>
        )}

        {(view === 'done' || view === 'error') && (
          // A FULL navigation, not a router push: the refreshed ID token has to
          // be picked up by a clean app boot, and `cont` may be another origin.
          <Button
            onClick={() => window.location.assign(cont)}
            className="w-full bg-gold hover:bg-gold-light text-surface font-semibold h-10"
          >
            המשך למערכת
          </Button>
        )}
      </div>
    </div>
  )
}
