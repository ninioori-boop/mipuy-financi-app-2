'use client'

import { useState } from 'react'
import { toast } from 'sonner'

// Inline add-client form (not a modal — matches the app's inline-create habit).
// onAdd invites the client for real (inviteClient callable) and may reject
// (already-registered, invited elsewhere, not an advisor). No email is sent —
// the advisor shares the signup link with the client manually.

interface Props {
  onAdd:    (email: string) => void | Promise<void>
  onCancel: () => void
}

export function AddClientForm({ onAdd, onCancel }: Props) {
  const [email, setEmail] = useState('')
  const [busy, setBusy]   = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      toast.error('כתובת מייל לא תקינה')
      return
    }
    setBusy(true)
    try {
      await onAdd(value)
      setEmail('')
      toast.success('הלקוח נוסף כ״ממתין״. שים לב: לא נשלח מייל — שלח לו בעצמך קישור להרשמה.')
    } catch (err) {
      toast.error((err as { message?: string })?.message || 'שליחת ההזמנה נכשלה, נסה/י שוב.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-gold/30 bg-gold/5 p-4 sm:p-5 space-y-3">
      <div className="text-sm font-semibold text-txt">הוספת לקוח חדש</div>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="email"
          inputMode="email"
          autoFocus
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="המייל של הלקוח"
          dir="ltr"
          className="flex-1 min-w-[200px] min-h-[44px] rounded-full border border-line bg-surface px-4 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left"
        />
        <button
          type="submit"
          disabled={busy}
          className="min-h-[44px] rounded-full bg-gold text-surface px-5 text-sm font-bold hover:bg-gold-light transition-colors disabled:opacity-50"
        >
          {busy ? 'מוסיף…' : 'הוסף לקוח'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="min-h-[44px] rounded-full border border-line bg-surface px-4 text-sm text-muted-txt hover:text-txt hover:border-gold/40 transition-colors disabled:opacity-50"
        >
          ביטול
        </button>
      </div>
      <p className="text-xs text-muted-txt">⚠️ לא נשלח מייל אוטומטי. המייל יתווסף לרשימת המורשים, ועליך לשלוח ללקוח בעצמך קישור להרשמה (app.orimipuy.com). חשוב: הוא חייב להירשם עם אותו מייל בדיוק.</p>
    </form>
  )
}
