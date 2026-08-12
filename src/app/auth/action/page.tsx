'use client'

import { useEffect, useState } from 'react'
import {
  applyActionCode, checkActionCode, verifyPasswordResetCode, confirmPasswordReset, signOut,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { raceWithTimeout, TIMED_OUT } from '@/lib/promiseTimeout'

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

// This page renders ABOVE everything and AuthProvider deliberately no longer
// rescues a signed-in visitor from it, so a request that never settles would
// strand them on "רגע…" with nowhere to go. Same scar as ConsentGate's
// CONSENT_CHECK_TIMEOUT_MS, same tool.
const ACTION_TIMEOUT_MS = 15_000

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

/**
 * An oobCode is single-use, and this component mounts TWICE.
 *
 * AuthProvider renders children, swaps them for a spinner once `mounted` flips
 * while auth is still resolving, then renders them again — so the effect below
 * fires twice on one page load. The first call consumed the code and the second
 * came back `auth/invalid-action-code`, which overwrote the success message:
 * the account really was verified and the screen said "הקישור לא עבד". Caught
 * end-to-end against production, 2026-08-12.
 *
 * Keyed at module scope so the second mount awaits the SAME promise and sees the
 * same outcome, whatever causes the remount.
 */
const inFlight = new Map<string, Promise<unknown>>()
function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  let p = inFlight.get(key) as Promise<T> | undefined
  if (!p) { p = run(); inFlight.set(key, p) }
  return p
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
  // The account says verified but this session's TOKEN does not yet. Tracked
  // separately because the two failure modes are invisible from each other.
  const [staleToken, setStaleToken] = useState(false)

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

    let alive = true
    const fail = (msg: string) => {
      if (!alive) return
      setView('error'); setTitle('הקישור לא עבד'); setDetail(msg)
    }

    ;(async () => {
      try {
        if (mode === 'resetPassword') {
          const r = await raceWithTimeout(
            once(`reset:${oobCode}`, () => verifyPasswordResetCode(auth, oobCode)), ACTION_TIMEOUT_MS)
          if (!alive) return
          if (r === TIMED_OUT) return fail('החיבור איטי ולא קיבלנו תשובה. כדאי לנסות שוב, ואם זה חוזר, לבקש קישור חדש.')
          setTitle('בחירת סיסמה חדשה'); setDetail(r); setView('password-form')
          return
        }

        if (mode === 'recoverEmail') {
          const info = await raceWithTimeout(
            once(`check:${oobCode}`, () => checkActionCode(auth, oobCode)), ACTION_TIMEOUT_MS)
          if (!alive) return
          if (info === TIMED_OUT) return fail('החיבור איטי ולא קיבלנו תשובה. כדאי לנסות שוב.')
          await once(`apply:${oobCode}`, () => applyActionCode(auth, oobCode))
          if (!alive) return
          setTitle('כתובת המייל שוחזרה'); setDetail(info.data.email ?? ''); setView('done')
          return
        }

        // verifyEmail / verifyAndChangeEmail
        const r = await raceWithTimeout(
          once(`apply:${oobCode}`, () => applyActionCode(auth, oobCode)), ACTION_TIMEOUT_MS)
        if (!alive) return
        if (r === TIMED_OUT) return fail('החיבור איטי ולא קיבלנו תשובה. כדאי לנסות שוב, ואם זה חוזר, לבקש קישור חדש מהמערכת.')

        // Two DIFFERENT things, deliberately not collapsed into one try:
        // reload() updates user.emailVerified (what the app's gate reads), and
        // getIdToken(true) re-mints the token (what the security rules read).
        // If only the second fails, the user is let into the app while every
        // rule still sees an unverified token — the consent screen then never
        // appears and the advisor's link silently stays pending.
        let stale = false
        if (auth.currentUser) {
          try { await auth.currentUser.reload() } catch { stale = true }
          try { await auth.currentUser.getIdToken(true) } catch { stale = true }
        }
        if (!alive) return
        setStaleToken(stale)
        setTitle('הכתובת אומתה ✓')
        setDetail(stale
          ? 'נשאר לרענן את ההרשאות בחשבון. לחצו על "המשך למערכת" ונשלים את זה.'
          : 'אפשר להמשיך למערכת.')
        setView('done')
      } catch (e) {
        fail(hebrewError((e as { code?: string }).code))
      }
    })()

    return () => { alive = false }
  }, [])

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    setFormErr('')
    if (pw1.length < 6)  { setFormErr('הסיסמה חייבת להיות לפחות 6 תווים.'); return }
    if (pw1 !== pw2)     { setFormErr('הסיסמאות אינן תואמות.'); return }
    setBusy(true)
    try {
      await confirmPasswordReset(auth, oob, pw1)
      // Changing the password revokes the refresh token. This page now runs on
      // the SAME origin as the app, so a signed-in tab would keep going on its
      // cached token and then die mid-session with a save error. Ending the
      // session here is both honest and what the user is about to do anyway.
      try { await signOut(auth) } catch { /* nothing left to protect */ }
      setTitle('הסיסמה עודכנה ✓')
      setDetail('אפשר להיכנס עכשיו עם הסיסמה החדשה.')
      setView('done')
    } catch (err) {
      setFormErr(hebrewError((err as { code?: string }).code))
    } finally {
      setBusy(false)
    }
  }

  async function continueNow() {
    // One more attempt at the thing that failed, before we send them into an
    // app whose rules would refuse them.
    if (staleToken && auth.currentUser) {
      setBusy(true)
      try { await auth.currentUser.getIdToken(true) } catch { /* app will retry on its own clock */ }
      setBusy(false)
    }
    // A FULL navigation, not a router push: the refreshed token has to be picked
    // up by a clean app boot, and `cont` may be another origin.
    window.location.assign(cont)
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
              type="password" dir="ltr" required minLength={6} value={pw1} autoFocus
              autoComplete="new-password"
              onChange={e => setPw1(e.target.value)} placeholder="סיסמה חדשה (לפחות 6 תווים)"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
            />
            <input
              type="password" dir="ltr" required minLength={6} value={pw2}
              autoComplete="new-password"
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
          <Button onClick={continueNow} disabled={busy}
            className="w-full bg-gold hover:bg-gold-light text-surface font-semibold h-10">
            {busy ? 'רגע…' : 'המשך למערכת'}
          </Button>
        )}

        {/* Visible in EVERY state, including "working". The old handler kept a
            back link up at all times, and a page with no exit is how a slow
            request turns into "the link is broken" all over again. */}
        <a href={DEFAULT_CONTINUE} className="block text-xs text-muted-txt hover:text-txt transition-colors">
          ← חזרה לעמוד הכניסה
        </a>
      </div>
    </div>
  )
}
