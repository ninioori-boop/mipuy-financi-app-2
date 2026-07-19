'use client'

import { type FormEvent, useCallback, useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  getIdToken,
  sendPasswordResetEmail,
  type User,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'

// Custom scheme the Android tracker app listens for. The token rides in the path.
const SCHEME = 'mipuytracker://token/'

// One-tap import of the shared iOS Shortcut ("THE HOME ECONOMIST 1"). Authored
// on Ori's iPhone (2026-07-14, v2: single notify.text dictionary get — zero
// manual variable wiring). Holds ALL the logic: POST {token, merchant} →
// notify.text → lock-screen notification. The client pastes their token into
// the Text box; their Wallet automation builds "[Amount] [Merchant]" text and
// runs this shortcut (the server's extractFromRaw splits amount/merchant).
const SHORTCUT_ICLOUD_URL = 'https://www.icloud.com/shortcuts/69275622abc0441491f7cb88bca7cc9b'

type Phase = 'loading' | 'signin' | 'fetching' | 'ready' | 'error'

/**
 * Device-connect page for the Android expense-tracker app.
 * Standalone, additive route — the client signs in (email+password, like most
 * do, or Google) once, and the page hands their personal device token back to
 * the native app via a custom URL scheme. No copy-paste. Reuses existing auth +
 * /api/device-token.
 */
export default function ConnectPage() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [copied, setCopied] = useState(false)
  const [resetMsg, setResetMsg] = useState('')

  const fetchToken = useCallback(async (user: User) => {
    setPhase('fetching')
    setError('')
    try {
      const idToken = await getIdToken(user, /* forceRefresh */ true)
      const res = await fetch('/api/device-token', {
        headers: { Authorization: `Bearer ${idToken}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'שגיאה בקבלת הטוקן')
      setToken(data.token as string)
      setPhase('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה לא צפויה')
      setPhase('error')
    }
  }, [])

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        if (user) fetchToken(user)
        else setPhase('signin')
      }),
    [fetchToken],
  )

  // iPhone has no native app to receive the token → show a copy-token flow (for the Shortcut).
  useEffect(() => {
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent))
  }, [])

  async function signInEmail(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
      // onAuthStateChanged fires → fetchToken
    } catch (err) {
      const code = (err as { code?: string }).code || ''
      setError(
        code.includes('invalid') || code.includes('wrong') || code.includes('user-not-found')
          ? 'מייל או סיסמה שגויים'
          : 'ההתחברות נכשלה, נסה שוב',
      )
      setBusy(false)
    }
  }

  async function signInGoogle() {
    setError('')
    try {
      await signInWithPopup(auth, new GoogleAuthProvider())
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code !== 'auth/cancelled-popup-request' && code !== 'auth/popup-closed-by-user') {
        setError('ההתחברות עם Google נכשלה, נסה שוב')
      }
    }
  }

  // Sets/resets a password by email. Crucial on iPhone: Google sign-in is
  // unreliable in iOS Safari (bounces back to the home screen), so iPhone
  // clients need the email+password path — including clients who signed up
  // with Google and never had a password (the reset link SETS one on the same
  // account).
  async function resetPassword() {
    setError('')
    setResetMsg('')
    const addr = email.trim()
    if (!addr) {
      setError('כתוב את המייל שלך למעלה ואז הקש שוב על "שכחתי סיסמה"')
      return
    }
    try {
      await sendPasswordResetEmail(auth, addr)
      setResetMsg('שלחנו לך למייל קישור לקביעת סיסמה. אחרי שתקבע — חזור לכאן והתחבר איתה.')
    } catch {
      // Don't reveal whether the address exists — same message either way.
      setResetMsg('אם המייל רשום במערכת — נשלח אליו קישור לקביעת סיסמה.')
    }
  }

  function retry() {
    const u = auth.currentUser
    if (u) fetchToken(u)
    else setPhase('signin')
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked — the token box is select-all so it can be copied by hand */
    }
  }

  return (
    <main className="min-h-screen bg-surface text-txt flex flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-bold text-gold mb-1">הכלכלן של הבית</h1>
      <p className="text-muted-txt text-sm mb-10">חיבור אפליקציית מעקב ההוצאות</p>

      {phase === 'loading' && (
        <span className="size-8 animate-spin rounded-full border-2 border-gold border-t-transparent" />
      )}

      {phase === 'signin' && (
        <div className="w-full max-w-xs">
          <p className="text-txt mb-6">התחבר לחשבון שלך כדי לחבר את האפליקציה — פעם אחת בלבד.</p>

          <form onSubmit={signInEmail} className="space-y-3">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="אימייל"
              style={{ direction: 'ltr' }}
              className="w-full rounded-lg border border-line bg-surface2 px-3 py-2.5 text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left"
            />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="סיסמה"
              style={{ direction: 'ltr' }}
              className="w-full rounded-lg border border-line bg-surface2 px-3 py-2.5 text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-gold text-surface font-bold rounded-xl px-8 py-3 hover:bg-gold-light transition-colors disabled:opacity-50"
            >
              {busy ? 'מתחבר…' : 'התחבר'}
            </button>
          </form>

          {error && <p className="text-expense text-sm mt-4">{error}</p>}
          {resetMsg && <p className="text-income text-sm mt-4">{resetMsg}</p>}

          <button
            onClick={resetPassword}
            className="mt-3 text-xs text-muted-txt underline hover:text-gold transition-colors"
          >
            שכחתי סיסמה / אין לי סיסמה
          </button>

          <div className="flex items-center gap-3 my-5">
            <div className="h-px bg-line flex-1" />
            <span className="text-muted-txt text-xs">או</span>
            <div className="h-px bg-line flex-1" />
          </div>

          <button
            onClick={signInGoogle}
            className="w-full bg-surface2 text-txt border border-line rounded-xl px-8 py-3 hover:bg-surface3 transition-colors"
          >
            התחבר עם Google
          </button>
          {isIOS && (
            <p className="mt-2 text-xs text-muted-txt leading-relaxed">
              נרשמת עם Google? באייפון הכניסה עם Google עובדת רק בדפדפן ספארי
              רגיל, וגם שם לפעמים נתקעת. אם זה קורה: הקש על «שכחתי סיסמה», קבע
              סיסמה דרך הקישור שיגיע למייל, והתחבר איתה כאן.
            </p>
          )}
        </div>
      )}

      {phase === 'fetching' && (
        <>
          <span className="size-8 animate-spin rounded-full border-2 border-gold border-t-transparent mb-4" />
          <p className="text-muted-txt text-sm">מחבר את האפליקציה…</p>
        </>
      )}

      {phase === 'ready' && (
        <div className="w-full max-w-xs">
          <div className="text-5xl mb-4">✅</div>
          <p className="text-income font-semibold mb-4">התחברת בהצלחה!</p>

          {isIOS ? (
            <>
              <p className="text-txt text-sm font-semibold mb-2 text-end">שלב 1 · העתק את הטוקן</p>
              <div
                dir="ltr"
                className="rounded-lg border border-line bg-surface2 p-3 text-[11px] text-txt break-all select-all mb-3 text-left"
              >
                {token}
              </div>
              <button
                onClick={copyToken}
                className="w-full bg-surface2 text-txt border border-line rounded-xl px-8 py-2.5 hover:bg-surface3 transition-colors mb-6"
              >
                {copied ? '✓ הועתק' : '📋 העתק טוקן'}
              </button>

              <p className="text-txt text-sm font-semibold mb-2 text-end">שלב 2 · הוסף את הקיצור והדבק את הטוקן</p>
              <a
                href={SHORTCUT_ICLOUD_URL}
                className="block w-full bg-gold text-surface font-bold rounded-xl px-8 py-3 hover:bg-gold-light transition-colors mb-3"
              >
                📲 הוסף את הקיצור
              </a>
              <div className="rounded-lg border border-line bg-surface2 p-3 text-xs text-muted-txt text-end leading-relaxed mb-6">
                אחרי ההוספה: פתח את אפליקציית <span className="text-txt font-semibold">קיצורי דרך</span> →
                לחיצה <span className="text-txt font-semibold">ארוכה</span> על{' '}
                <bdi className="text-txt font-semibold">THE HOME ECONOMIST 1</bdi> →
                «עריכה» → מחק את «הדבק כאן טוקן» מתיבת המלל →
                <span className="text-txt font-semibold"> הדבק את הטוקן</span> שהעתקת בשלב 1 → סיום.
              </div>

              <p className="text-txt text-sm font-semibold mb-2 text-end">שלב 3 · צור את האוטומציה (חד־פעמי, ~2 דקות)</p>
              <div className="rounded-lg border border-line bg-surface2 p-3 text-xs text-muted-txt text-end leading-relaxed mb-6">
                בקיצורי דרך: לשונית <span className="text-txt font-semibold">«פעולות אוטומטיות»</span> (האמצעית)
                → ＋ → גלול ובחר <span className="text-txt font-semibold">«ארנק»</span> →
                «כאשר אני מקיש» → בחר את הכרטיסים שלך →
                <span className="text-txt font-semibold"> «הפעל מיד»</span> → הבא.
                <br />
                עכשיו מוסיפים שתי פעולות (דרך «חיפוש פעולות» למטה):
                <br />
                <span className="text-txt font-semibold">① «מלל»</span> — הקש בתיבה →
                «בחירת משתנה» → <span className="text-txt font-semibold">«קלט של קיצור»</span> →
                הקש על המילה הכחולה שנוספה → בחר <span className="text-txt font-semibold">«כמות»</span> →
                הקש רווח → שוב «בחירת משתנה» → «קלט של קיצור» → הקש עליה →
                בחר <span className="text-txt font-semibold">«בית עסק»</span>.
                <br />
                <span className="text-txt font-semibold">② «הפעל קיצור דרך»</span> —
                הקש על «קיצור דרך» → בחר{' '}
                <bdi className="text-txt font-semibold">THE HOME ECONOMIST 1</bdi> → סיום.
                <br />
                מעכשיו כל תשלום Apple Pay נרשם לבד — עם התראה וסטטוס תקציב ✨
              </div>

              <p className="text-txt text-sm font-semibold mb-2 text-end">שלב 4 · הוסף את האפליקציה למסך הבית</p>
              <div className="rounded-lg border border-line bg-surface2 p-3 text-xs text-muted-txt text-end leading-relaxed">
                בספארי: הקש על כפתור <span className="text-txt font-semibold">השיתוף</span> (הריבוע עם החץ למעלה)
                → <span className="text-txt font-semibold">«הוספה למסך הבית»</span> → <span className="text-txt font-semibold">«הוסף»</span>.
                <br />
                מעכשיו «מעקב הוצאות» נפתחת מהמסך הראשי — כמו כל אפליקציה. 🎉
              </div>
            </>
          ) : (
            <>
              <p className="text-muted-txt text-sm mb-6">לחץ למטה כדי לחזור לאפליקציה — הטוקן יישמר אוטומטית.</p>
              <a
                href={SCHEME + encodeURIComponent(token)}
                className="block bg-gold text-surface font-bold rounded-xl px-8 py-3 hover:bg-gold-light transition-colors"
              >
                פתח את האפליקציה ←
              </a>
              <button
                onClick={copyToken}
                className="mt-4 text-xs text-muted-txt hover:text-gold transition-colors"
              >
                {copied ? '✓ הועתק' : 'או העתק את הטוקן ידנית'}
              </button>
            </>
          )}
        </div>
      )}

      {phase === 'error' && (
        <>
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-expense mb-6 max-w-xs">{error}</p>
          <button
            onClick={retry}
            className="bg-surface2 text-gold border border-gold/40 rounded-xl px-6 py-2.5 hover:bg-surface3 transition-colors"
          >
            נסה שוב
          </button>
        </>
      )}
    </main>
  )
}
