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
import { BRAND } from '@/lib/brand'

// Custom scheme the Android tracker app listens for. The token rides in the path.
const SCHEME = 'mipuytracker://token/'

// One-tap import of the shared iOS Shortcut. Holds ALL the logic: POST
// {token, merchant} → notify.text → lock-screen notification. The client's
// Wallet automation builds "[Amount] [Merchant]" text and runs this shortcut
// (the server's extractFromRaw splits amount/merchant).
//
// v3 (2026-08-02) carries an IMPORT QUESTION: adding the shortcut now prompts
// for the connection code instead of leaving the client to find the Text box
// themselves. That replaced the worst five taps of the whole setup — open
// Shortcuts, long-press, Edit, clear the placeholder, paste — and with them the
// step most likely to be done wrong, since pasting into the wrong action fails
// silently and only shows up as a dead automation days later.
//
// Verified from the shared copy itself, not just on the authoring device: the
// published file carries the import question and contains NO token (an earlier
// draft was duplicated from a WORKING shortcut, so shipping it unchecked would
// have handed every new client someone else's live token and quietly routed
// their expenses into that account).
const SHORTCUT_ICLOUD_URL = 'https://www.icloud.com/shortcuts/84fe4d77cc164b1ab0a68675c4fa7b5c'

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
  const [iosMajor, setIosMajor] = useState<number | null>(null)
  const [isNativeApp, setIsNativeApp] = useState(false)
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
  // Also read the major iOS version: Apple's Wallet TRANSACTION TRIGGER only exists
  // from iOS 17, so on anything older this setup cannot be completed at all — the
  // trigger the whole flow depends on is simply absent from the Shortcuts app.
  // Clients hit this as "my phone doesn't have «קלט של קיצור»" and read it as their
  // mistake, after twenty minutes of trying. Better to say so on the first screen.
  useEffect(() => {
    const ua = navigator.userAgent
    setIsIOS(/iPad|iPhone|iPod/.test(ua))
    const m = ua.match(/(?:iPhone|CPU) OS (\d+)/)
    if (m) setIosMajor(Number(m[1]))
  }, [])

  // The native iOS app opens this page in Safari with ?native=1 — it CAN
  // receive the mipuytracker:// deep link (like Android), so skip the iOS
  // Shortcut wizard. Persisted in sessionStorage so it survives the Google
  // sign-in round trip on this page.
  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get('native') === '1'
    if (fromQuery) sessionStorage.setItem('connectNative', '1')
    if (fromQuery || sessionStorage.getItem('connectNative') === '1') setIsNativeApp(true)
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
      <h1 className="text-2xl font-bold text-gold mb-1">{BRAND.nameHe}</h1>
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

          {isIOS && !isNativeApp ? (
            <IosWizard token={token} copied={copied} onCopy={copyToken} iosMajor={iosMajor} />
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

// ─── iOS setup wizard ────────────────────────────────────────────────────────
// Same five steps as before, one screen at a time instead of all at once. The
// content is unchanged — what changed is that a client no longer meets a wall
// of five open steps, which is most of what made this feel impossible.
//
// The step is kept in sessionStorage because this flow REQUIRES leaving Safari
// (steps 2-4 happen in the Shortcuts app), and iOS may discard the tab while
// it is in the background. Without this, coming back would land the client at
// the top again with no idea which parts they had already done.

const IOS_STEP_KEY = 'connectIosStep'

// The English name of an iOS label, shown next to the Hebrew one.
//
// Not decoration: a client whose iPhone is set to English sees "Shortcut Input"
// and no «קלט של קיצור» anywhere, and reports the option as MISSING rather than
// renamed — which reads as a broken phone and ends the onboarding. One client
// ran a month of zero capture on exactly that misunderstanding.
// bdi keeps the Latin text from reordering inside the RTL sentence.
function Bi({ en }: { en: string }) {
  return <bdi className="text-muted-txt/70">({en})</bdi>
}

const IOS_STEPS = [
  'העתק את הטוקן',
  'הוסף את הקיצור',
  'צור את האוטומציה',
  'אישור הרשאות',
  'הוספה למסך הבית',
]

// Apple added the Wallet transaction trigger in iOS 17. Below that the trigger
// does not exist, so no amount of instruction can complete this setup.
const MIN_IOS_FOR_WALLET_TRIGGER = 17

function IosWizard({
  token,
  copied,
  onCopy,
  iosMajor,
}: {
  token: string
  copied: boolean
  onCopy: () => void
  iosMajor: number | null
}) {
  const [step, setStep] = useState(1)
  const [restored, setRestored] = useState(false)
  const [done, setDone] = useState(false)

  // sessionStorage can throw outright in a locked-down Safari, and losing the
  // saved step is a far smaller problem than a wizard that fails to render at
  // all — so both sides are guarded and simply fall back to starting at 1.
  useEffect(() => {
    try {
      const saved = Number(sessionStorage.getItem(IOS_STEP_KEY))
      if (saved >= 1 && saved <= IOS_STEPS.length) setStep(saved)
    } catch {
      /* no persistence available — the wizard still works, it just restarts */
    }
    setRestored(true)
  }, [])

  // Guarded on `restored` so the initial render does not overwrite a saved
  // step with 1 before the restore effect has run.
  useEffect(() => {
    if (!restored) return
    try {
      sessionStorage.setItem(IOS_STEP_KEY, String(step))
    } catch {
      /* see above */
    }
  }, [step, restored])

  const card =
    'rounded-lg border border-line bg-surface2 p-3 text-xs text-muted-txt text-end leading-relaxed'

  if (done) {
    return (
      <div>
        <div className="text-5xl mb-4">🎉</div>
        <p className="text-income font-semibold mb-2">הכל מוכן!</p>
        <p className="text-muted-txt text-sm leading-relaxed">
          מעכשיו כל תשלום בארנק נרשם אוטומטית במעקב ההוצאות.
        </p>
        <button
          onClick={() => {
            setDone(false)
            setStep(1)
          }}
          className="mt-6 text-xs text-muted-txt underline hover:text-gold transition-colors"
        >
          הצג שוב את שלבי ההתקנה
        </button>
      </div>
    )
  }

  const tooOld = iosMajor !== null && iosMajor < MIN_IOS_FOR_WALLET_TRIGGER

  return (
    <div>
      {/* Shown BEFORE step 1, not discovered at step 3. Without the trigger the
          setup is impossible, and the way that surfaces to a client is the
          «קלט של קיצור» option being absent — which reads as their mistake. */}
      {tooOld && (
        <div className="rounded-lg border border-expense/50 bg-expense/10 p-3 text-xs text-txt text-end leading-relaxed mb-5">
          <span className="font-semibold">המכשיר הזה מריץ iOS {iosMajor}, והקליטה האוטומטית דורשת iOS 17 ומעלה.</span>
          <br />
          אפל הוסיפה את הטריגר של תשלומי הארנק רק ב-iOS 17, ובגרסאות ישנות יותר הוא פשוט לא
          קיים באפליקציית «קיצורי דרך» — אז אי אפשר להשלים את ההגדרה כאן, וזה לא תלוי בך.
          <br />
          <span className="font-semibold">מה כן אפשר:</span> לעדכן את iOS (הגדרות ← כללי ← עדכון תוכנה),
          ואז לחזור לעמוד הזה. עד אז אפשר לרשום הוצאות ידנית באפליקציה — זה עובד מצוין.
        </div>
      )}

      {/* Numbers stay LTR so 1..5 reads left-to-right like any progress bar. */}
      <div dir="ltr" className="flex items-center justify-center gap-1.5 mb-3">
        {IOS_STEPS.map((_, i) => {
          const n = i + 1
          return (
            <span
              key={n}
              className={
                'size-6 rounded-full grid place-items-center text-[11px] border transition-colors ' +
                (n < step
                  ? 'bg-gold text-surface border-gold'
                  : n === step
                    ? 'border-gold text-gold'
                    : 'border-line text-muted-txt')
              }
            >
              {n < step ? '✓' : n}
            </span>
          )
        })}
      </div>

      <p className="text-[11px] text-muted-txt mb-1">
        שלב {step} מתוך {IOS_STEPS.length}
      </p>
      <h2 className="text-txt font-semibold mb-4">{IOS_STEPS[step - 1]}</h2>

      {step === 1 && (
        <>
          <div
            dir="ltr"
            className="rounded-lg border border-line bg-surface2 p-3 text-[11px] text-txt break-all select-all mb-3 text-left"
          >
            {token}
          </div>
          <button
            onClick={onCopy}
            className="w-full bg-surface2 text-txt border border-line rounded-xl px-8 py-2.5 hover:bg-surface3 transition-colors"
          >
            {copied ? '✓ הועתק' : '📋 העתק טוקן'}
          </button>
          <div className={card + ' mt-3'}>
            הטוקן הוא המפתח האישי שלך למערכת. אין צורך לזכור אותו, רק להדביק אותו
            בשלב הבא. אל תשתף אותו עם אף אחד.
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <a
            href={SHORTCUT_ICLOUD_URL}
            className="block w-full bg-gold text-surface font-bold rounded-xl px-8 py-3 hover:bg-gold-light transition-colors mb-3"
          >
            📲 הוסף את הקיצור
          </a>
          <div className={card}>
            הקש על <span className="text-txt font-semibold">«הגדרת קיצור»</span>, וייפתח מסך
            שמבקש <span className="text-txt font-semibold">«הדבק כאן את קוד החיבור מהאתר»</span> —
            הדבק שם את הקוד שהעתקת בשלב 1 ואשר.
            <br />
            זהו. אין צורך לפתוח את «קיצורי דרך» ואין מה לערוך.
          </div>
          {/* The clipboard is easily lost on the way to the Shortcuts app and
              back, so the token stays one tap away instead of a step back. */}
          <button
            onClick={onCopy}
            className="mt-3 text-xs text-muted-txt underline hover:text-gold transition-colors"
          >
            {copied ? '✓ הטוקן הועתק שוב' : 'העתק שוב את הטוקן'}
          </button>
        </>
      )}

      {step === 3 && (
        <div className={card}>
          {/* Every label carries its English name too: an iPhone set to English
              shows "Shortcut Input", never «קלט של קיצור», and a client hunting
              for the Hebrew wording reports the option as MISSING rather than
              renamed. That misread cost one client a month of zero capture. */}
          <p className="mb-2 text-[11px] text-muted-txt/80">
            הטלפון שלך באנגלית? כל שם מופיע כאן גם באנגלית, בסוגריים.
          </p>
          בקיצורי דרך <Bi en="Shortcuts" />: לשונית{' '}
          <span className="text-txt font-semibold">«פעולות אוטומטיות»</span> <Bi en="Automation" /> (האמצעית)
          → ＋ → גלול ובחר <span className="text-txt font-semibold">«ארנק»</span> <Bi en="Wallet" /> →
          «כאשר אני מקיש» <Bi en="When I Tap" /> → בחר את הכרטיסים שלך →
          <span className="text-txt font-semibold"> «הפעל מיד»</span> <Bi en="Run Immediately" /> → הבא.
          <br />
          עכשיו מוסיפים שתי פעולות (דרך «חיפוש פעולות» <Bi en="Search for actions" /> למטה):
          <br />
          <span className="text-txt font-semibold">① «מלל»</span> <Bi en="Text" /> — ובתוך התיבה שלה,
          לפי הסדר: הקש בתיבה כדי לפתוח את המקלדת → מעל המקלדת «בחירת משתנה»{' '}
          <Bi en="Select Variable" /> → <span className="text-txt font-semibold">«קלט של קיצור»</span>{' '}
          <Bi en="Shortcut Input" /> → ייכנס <span className="text-txt font-semibold">שבב כחול</span>,
          הקש עליו ובחר <span className="text-txt font-semibold">«כמות»</span> <Bi en="Amount" /> →{' '}
          <span className="text-txt font-semibold">לחץ פעם אחת על מקש הרווח</span> (בלי הרווח הסכום
          ושם החנות נדבקים ואי אפשר להפריד ביניהם) → שוב «בחירת משתנה» → «קלט של קיצור» → הקש על
          השבב החדש → בחר <span className="text-txt font-semibold">«בית עסק»</span> <Bi en="Merchant" />.
          <br />
          בסוף התיבה מכילה <span className="text-txt font-semibold">שני שבבים ורווח ביניהם</span>.
          <br />
          <span className="text-txt font-semibold">② «הפעל קיצור דרך»</span> <Bi en="Run Shortcut" /> —
          הקש על «קיצור דרך» → בחר{' '}
          <bdi className="text-txt font-semibold">THE HOME ECONOMIST 2</bdi> → סיום.
          <br />
          <span className="text-txt font-semibold">שתי הפעולות חובה.</span> אוטומציה שרק מפעילה את
          הקיצור, בלי «מלל», מגיעה לשרת בלי סכום — ואז שום קנייה לא נרשמת, בשקט.
          <br />
          <br />
          <span className="text-txt font-semibold">לא מוצא את «קלט של קיצור» ברשימת המשתנים?</span>{' '}
          זה כמעט תמיד אחד משלושה, ולפי הסדר: הטלפון באנגלית והשם שם הוא{' '}
          <Bi en="Shortcut Input" /> · אתה בתוך קיצור חדש ולא בתוך האוטומציה (באוטומציה כתוב
          למעלה מתי היא רצה, עם הכרטיסים) · או שבראש הפעולה לא מופיע{' '}
          <Bi en="Receive transaction as input" />, ואז אין עסקה להציע ממנה מאפיינים.
          <br />
          <br />
          זה השלב הארוך ביותר, וזה האחרון הארוך. אחריו נשארו שתי דקות.
        </div>
      )}

      {step === 4 && (
        <div className="rounded-lg border border-gold/40 bg-surface2 p-3 text-xs text-muted-txt text-end leading-relaxed">
          <span className="text-txt font-semibold">כשהמכשיר פתוח</span>, בקיצורי דרך: הקש הקשה רגילה על{' '}
          <bdi className="text-txt font-semibold">THE HOME ECONOMIST 2</bdi> →
          אשר את כל חלוניות ההרשאה שקופצות, בעיקר החיבור אל app.orimipuy.com
          (אם מוצע <span className="text-txt font-semibold">«אפשר תמיד»</span> <Bi en="Always Allow" /> —
          בחר בו, <span className="text-txt font-semibold">לא</span> «אפשר פעם אחת» <Bi en="Allow Once" />).
          <br />
          בסוף תופיע שגיאה קטנה על notify — <span className="text-txt font-semibold">זה תקין</span>,
          זה רק בגלל שאין תשלום אמיתי מאחורי ההרצה.
          <br />
          למה זה חובה: את ההרשאות האלה iOS מבקש פעם אחת, והוא לא מסוגל להציג את השאלה
          כשהמכשיר נעול — ותשלום Apple Pay תמיד קורה כשהמכשיר נעול.
          <br />
          כבר קרה ונבחר «אפשר פעם אחת»? אז הקיצור לא ישאל שוב והרצה חוזרת לא תתקן. צריך
          לאפס: ⋯ ← «פרטים» <Bi en="Details" /> ← «פרטיות» <Bi en="Privacy" /> ←{' '}
          <span className="text-txt font-semibold">«איפוס פרטיות»</span> <Bi en="Reset Privacy" /> —
          ואז להריץ שוב ולבחור «אפשר תמיד».
        </div>
      )}

      {step === 5 && (
        <div className={card}>
          בספארי: הקש על כפתור <span className="text-txt font-semibold">השיתוף</span> (הריבוע עם החץ למעלה)
          → <span className="text-txt font-semibold">«הוספה למסך הבית»</span> →{' '}
          <span className="text-txt font-semibold">«הוסף»</span>.
          <br />
          מעכשיו «מעקב הוצאות» נפתחת מהמסך הראשי — כמו כל אפליקציה.
        </div>
      )}

      <div className="flex items-center gap-2 mt-6">
        {step > 1 && (
          <button
            onClick={() => setStep(step - 1)}
            className="rounded-xl border border-line bg-surface2 px-4 py-2.5 text-sm text-muted-txt hover:text-txt transition-colors"
          >
            חזרה
          </button>
        )}
        <button
          onClick={() => (step < IOS_STEPS.length ? setStep(step + 1) : setDone(true))}
          className="flex-1 bg-gold text-surface font-bold rounded-xl px-6 py-2.5 hover:bg-gold-light transition-colors"
        >
          {step < IOS_STEPS.length ? 'הבא ←' : 'סיימתי 🎉'}
        </button>
      </div>
    </div>
  )
}
