'use client'

import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'

// Calm transparency note: when the advisor has edited this client's data, show
// when it last happened. Reads the top-level lastAdvisorEditAt marker on the
// user doc (written by saveClientDataAsAdvisor, outside `data`). Renders nothing
// if there's no advisor edit on record — safe to embed anywhere.
export function AdvisorEditMarker() {
  const user = useAuthStore(s => s.user)
  const [when, setWhen] = useState<number | null>(null)

  useEffect(() => {
    if (!user) { setWhen(null); return }
    let alive = true
    getDoc(doc(db, 'users', user.uid))
      .then(snap => {
        if (!alive) return
        const raw = snap.exists() ? snap.data() : null
        const ms = typeof raw?.lastAdvisorEditAt?.toMillis === 'function' ? raw.lastAdvisorEditAt.toMillis() : 0
        setWhen(ms > 0 ? ms : null)
      })
      .catch(() => { if (alive) setWhen(null) })
    return () => { alive = false }
  }, [user])

  if (!when) return null
  const label = new Date(when).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return (
    <div className="rounded-2xl border border-line bg-surface2 px-4 py-3 text-sm text-muted-txt flex items-center gap-2">
      <span aria-hidden>✏️</span>
      <span>היועץ שלך עדכן נתונים בחשבון בתאריך {label}. אפשר לראות ולשחזר כל שינוי בהיסטוריית הגרסאות.</span>
    </div>
  )
}
