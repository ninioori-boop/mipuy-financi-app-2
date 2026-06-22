'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  onAuthStateChanged,
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
 * Standalone, additive route — the client signs in with Google (once) and the
 * page hands their personal device token back to the native app via a custom
 * URL scheme. No copy-paste. Reuses the existing auth + /api/device-token.
 */
export default function ConnectPage() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')

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

  async function signIn() {
    setError('')
    try {
      await signInWithPopup(auth, new GoogleAuthProvider())
      // onAuthStateChanged fires → fetchToken
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code !== 'auth/cancelled-popup-request' && code !== 'auth/popup-closed-by-user') {
        setError('ההתחברות נכשלה, נסה שוב')
        setPhase('signin')
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
        <>
          <p className="text-txt mb-6 max-w-xs">
            התחבר עם חשבון Google שלך כדי לחבר את האפליקציה — פעם אחת בלבד.
          </p>
          <button
            onClick={signIn}
            className="bg-gold text-surface font-bold rounded-xl px-8 py-3 hover:bg-gold-light transition-colors"
          >
            התחבר עם Google
          </button>
        </>
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
