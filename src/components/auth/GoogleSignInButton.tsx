'use client'

import { useState } from 'react'
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { Button } from '@/components/ui/button'

export function GoogleSignInButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSignIn() {
    setLoading(true)
    setError(null)
    try {
      const provider = new GoogleAuthProvider()
      await signInWithPopup(auth, provider)
    } catch (err: unknown) {
      const code = (err as { code?: string }).code
      if (code !== 'auth/cancelled-popup-request' && code !== 'auth/popup-closed-by-user') {
        setError(hebrewAuthError(code))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <Button
        onClick={handleSignIn}
        disabled={loading}
        variant="outline"
        className="w-full gap-3 bg-surface2 border-line text-txt hover:bg-surface3 hover:text-txt h-11"
      >
        {loading ? (
          <span className="size-4 animate-spin rounded-full border-2 border-gold border-t-transparent" />
        ) : (
          <GoogleIcon />
        )}
        {loading ? 'מתחבר...' : 'כניסה עם Google'}
      </Button>
      {error && <p className="text-expense text-sm text-center">{error}</p>}
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  )
}

function hebrewAuthError(code?: string): string {
  switch (code) {
    case 'auth/network-request-failed': return 'שגיאת רשת — בדקו חיבור לאינטרנט'
    case 'auth/too-many-requests':      return 'יותר מדי ניסיונות — נסו שוב בעוד כמה דקות'
    case 'auth/user-disabled':          return 'החשבון הושבת'
    default:                            return 'שגיאה בכניסה — נסו שוב'
  }
}
