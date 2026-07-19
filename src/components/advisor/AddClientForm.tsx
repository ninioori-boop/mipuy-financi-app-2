'use client'

import { useState } from 'react'
import { toast } from 'sonner'

// Inline add-client form (not a modal — matches the app's inline-create habit).
// Prototype only: onAdd pushes a mock "pending" client into page state. No email
// is sent, nothing persists.

interface Props {
  onAdd:    (email: string) => void
  onCancel: () => void
}

export function AddClientForm({ onAdd, onCancel }: Props) {
  const [email, setEmail] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      toast.error('כתובת מייל לא תקינה')
      return
    }
    onAdd(value)
    setEmail('')
    toast.success('ההזמנה נשלחה — הלקוח יופיע כ״ממתין״')
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-gold/40 bg-gold/5 p-4 sm:p-5 space-y-3">
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
          className="flex-1 min-w-[200px] min-h-[44px] rounded-lg border border-line bg-surface px-3 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left"
        />
        <button
          type="submit"
          className="min-h-[44px] rounded-lg bg-gold text-surface px-5 text-sm font-bold hover:bg-gold-light transition-colors"
        >
          שלח הזמנה
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] rounded-lg border border-line bg-surface px-4 text-sm text-muted-txt hover:text-txt hover:border-gold/40 transition-colors"
        >
          ביטול
        </button>
      </div>
      <p className="text-xs text-muted-txt">בפועל יישלח מייל הזמנה ללקוח. בשלב זה הדגמה בלבד, הלקוח יתווסף כ״ממתין״.</p>
    </form>
  )
}
