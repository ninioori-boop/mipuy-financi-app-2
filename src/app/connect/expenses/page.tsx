'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { signInWithCustomToken } from 'firebase/auth'
import { auth } from '@/lib/firebase'

// In-app launcher for the Android WebView. The app opens this page at
// `/connect/expenses#token=<deviceToken>`; we exchange the device token for a
// Firebase custom token, sign in silently, flag embed mode (so the app chrome
// hides), and land on the real "תיעוד הוצאות" tab — identical to the web, 1:1.
//
// The token travels in the URL *hash* (never sent to the server / not logged).
export default function ConnectExpensesPage() {
  const router = useRouter()
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function run() {
      const hash = typeof window !== 'undefined' ? window.location.hash : ''
      const token = new URLSearchParams(hash.replace(/^#/, '')).get('token')?.trim()

      // Mark embed mode so /app chrome (header/nav) hides — clean "expenses only".
      try { sessionStorage.setItem('embedMode', '1') } catch {}

      // Already signed in (re-open without a token) → just go to expenses.
      if (!token) {
        if (auth.currentUser) { router.replace('/app/expenses'); return }
        setError('פתחו את המסך הזה מתוך האפליקציה (חסר טוקן).')
        return
      }

      try {
        const res = await fetch('/api/app-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'ההתחברות נכשלה')

        await signInWithCustomToken(auth, data.customToken)
        if (cancelled) return
        // Clear the token from the URL so it isn't left in history.
        try { history.replaceState(null, '', '/connect/expenses') } catch {}
        router.replace('/app/expenses')
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'ההתחברות נכשלה')
      }
    }

    run()
    return () => { cancelled = true }
  }, [router])

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-4 p-6 text-center">
      {error ? (
        <>
          <div className="text-3xl">⚠️</div>
          <p className="text-expense text-sm max-w-xs">{error}</p>
          <p className="text-muted-txt text-xs max-w-xs">
            נסו לסגור ולפתוח מחדש את האפליקציה, או לחבר מחדש את הטוקן.
          </p>
        </>
      ) : (
        <>
          <span className="size-9 animate-spin rounded-full border-2 border-gold border-t-transparent" />
          <p className="text-muted-txt text-sm">מתחבר לתיעוד ההוצאות…</p>
        </>
      )}
    </div>
  )
}
