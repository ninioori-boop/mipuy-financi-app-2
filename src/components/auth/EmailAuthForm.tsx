'use client'

import { useState } from 'react'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { Button } from '@/components/ui/button'

type Mode = 'signin' | 'signup' | 'reset'

export function EmailAuthForm() {
  const [mode, setMode]       = useState<Mode>('signin')
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    // מחזיר את המשתמש לאפליקציה הזו (ולא למערכת הישנה) אחרי איפוס/אימות
    const actionCodeSettings = { url: `${window.location.origin}/auth` }

    try {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(auth, email.trim(), password)
      } else if (mode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password)
        await sendEmailVerification(cred.user, actionCodeSettings)
        setSuccess('חשבון נוצר! שלחנו מייל אימות — בדוק את תיבת הדואר שלך לפני הכניסה')
        setLoading(false)
        return
      } else {
        await sendPasswordResetEmail(auth, email.trim(), actionCodeSettings)
        setSuccess('קישור לאיפוס סיסמה נשלח למייל שלך')
        setLoading(false)
        return
      }
    } catch (err: unknown) {
      setError(hebrewError((err as { code?: string }).code))
    } finally {
      setLoading(false)
    }
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setSuccess(null)
    setPassword('')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="email"
        placeholder="כתובת מייל"
        value={email}
        onChange={e => setEmail(e.target.value)}
        required
        dir="ltr"
        className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
      />

      {mode !== 'reset' && (
        <input
          type="password"
          placeholder={mode === 'signup' ? 'בחר סיסמה (לפחות 6 תווים)' : 'סיסמה'}
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          minLength={6}
          dir="ltr"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
        />
      )}

      {error   && <p className="text-expense text-xs text-center">{error}</p>}
      {success && <p className="text-income  text-xs text-center">{success}</p>}

      <Button
        type="submit"
        disabled={loading}
        className="w-full bg-gold hover:bg-gold-light text-surface font-semibold h-10"
      >
        {loading ? (
          <span className="size-4 animate-spin rounded-full border-2 border-surface border-t-transparent" />
        ) : mode === 'signin' ? 'כניסה' : mode === 'signup' ? 'הרשמה' : 'שלח קישור לאיפוס'}
      </Button>

      <div className="flex items-center justify-between text-xs text-muted-txt pt-1">
        {mode === 'signin' ? (
          <>
            <button type="button" onClick={() => switchMode('signup')} className="hover:text-txt transition-colors">
              אין לך חשבון? הרשמה
            </button>
            <button type="button" onClick={() => switchMode('reset')} className="hover:text-txt transition-colors">
              שכחתי סיסמה
            </button>
          </>
        ) : (
          <button type="button" onClick={() => switchMode('signin')} className="hover:text-txt transition-colors">
            ← חזרה לכניסה
          </button>
        )}
      </div>
    </form>
  )
}

function hebrewError(code?: string): string {
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':  return 'מייל או סיסמה שגויים'
    case 'auth/email-already-in-use': return 'כתובת המייל כבר רשומה במערכת'
    case 'auth/weak-password':        return 'הסיסמה קצרה מדי — לפחות 6 תווים'
    case 'auth/invalid-email':        return 'כתובת מייל לא תקינה'
    case 'auth/too-many-requests':    return 'יותר מדי ניסיונות — נסו שוב מאוחר יותר'
    case 'auth/network-request-failed': return 'שגיאת רשת — בדקו חיבור לאינטרנט'
    default:                          return 'שגיאה — נסו שוב'
  }
}
