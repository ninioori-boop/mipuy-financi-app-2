'use client'

import { type FormEvent, useCallback, useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  getIdToken,
  type User,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'

// Custom scheme the Android tracker app listens for. The token rides in the path.
const SCHEME = 'mipuytracker://token/'

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

  function retry() {
    const u = auth.currentUser
    if (u) fetchToken(u)
    else setPhase('signin')
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
        </div>
      )}

      {phase === 'fetching' && (
        <>
          <span className="size-8 animate-spin rounded-full border-2 border-gold border-t-transparent mb-4" />
          <p className="text-muted-txt text-sm">מחבר את האפליקציה…</p>
        </>
      )}

      {phase === 'ready' && (
        <>
          <div className="text-5xl mb-4">✅</div>
          <p className="text-income font-semibold mb-2">התחברת בהצלחה!</p>
          <p className="text-muted-txt text-sm mb-8 max-w-xs">
            לחץ למטה כדי לחזור לאפליקציה — הטוקן יישמר אוטומטית.
          </p>
          <a
            href={SCHEME + encodeURIComponent(token)}
            className="bg-gold text-surface font-bold rounded-xl px-8 py-3 hover:bg-gold-light transition-colors"
          >
            פתח את האפליקציה ←
          </a>
        </>
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
