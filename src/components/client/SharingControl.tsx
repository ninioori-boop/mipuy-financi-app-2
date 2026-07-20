'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { doc, getDoc } from 'firebase/firestore'
import { db, callable } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'

// The client's own control over sharing with their advisor. Reads their own
// clientLinks/{uid} link and lets them grant or revoke at any time — this is the
// reversible half of consent. Renders `emptyFallback` (default: nothing) when the
// user has no advisor link, so it's safe to embed anywhere.

type Status = 'active' | 'declined' | 'revoked'
interface LinkState { status: Status; consentVersion: string }

export function SharingControl({ emptyFallback = null }: { emptyFallback?: ReactNode }) {
  const { user } = useAuthStore()
  const [link, setLink] = useState<LinkState | null | 'none'>(null) // null = loading
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    try {
      const snap = await getDoc(doc(db, 'clientLinks', user.uid))
      setLink(snap.exists()
        ? { status: snap.data().status, consentVersion: snap.data().consentVersion || 'v1' }
        : 'none')
    } catch {
      setLink('none')
    }
  }, [user])

  useEffect(() => { load() }, [load])

  async function change(status: Status) {
    setBusy(true)
    try {
      const cv = link && link !== 'none' ? link.consentVersion : 'v1'
      await callable<{ status: string; consentVersion: string }, { ok: boolean }>('setClientSharing')(
        { status, consentVersion: cv },
      )
      await load()
      toast.success(status === 'active' ? 'השיתוף עם היועץ הופעל.' : 'השיתוף עם היועץ בוטל.')
    } catch (err) {
      toast.error((err as { message?: string })?.message || 'משהו השתבש, נסה/י שוב.')
    } finally {
      setBusy(false)
    }
  }

  if (link === null) return null            // loading
  if (link === 'none') return <>{emptyFallback}</>

  const sharing = link.status === 'active'
  return (
    <div className="rounded-2xl border border-line bg-surface2 p-4 sm:p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span aria-hidden>{sharing ? '👁️' : '🔒'}</span>
        <h2 className="font-semibold text-txt">שיתוף עם היועץ</h2>
      </div>
      <p className="text-sm text-muted-txt">
        {sharing
          ? 'היועץ שלך יכול לצפות בתמונת המצב הפיננסית שלך (צפייה בלבד). אפשר להפסיק בכל עת.'
          : 'היועץ שלך לא רואה את הנתונים שלך כרגע. אפשר לשתף כדי שילווה אותך.'}
      </p>
      <button
        onClick={() => change(sharing ? 'revoked' : 'active')}
        disabled={busy}
        className={`min-h-[44px] rounded-full px-5 text-sm font-semibold transition-colors disabled:opacity-50 ${
          sharing
            ? 'border border-line bg-surface text-muted-txt hover:text-expense hover:border-expense/40'
            : 'bg-gold text-surface hover:bg-gold-light'
        }`}
      >
        {busy ? 'רגע…' : sharing ? 'הפסק שיתוף' : 'שתף עם היועץ'}
      </button>
    </div>
  )
}
