'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'
import { ConsentScreen, type PendingInvite } from '@/components/auth/ConsentScreen'

// Sits between AuthProvider and DataSync. For a signed-in user it does ONE read
// of clientLinks/pending_{email}: if a pending invite exists, it shows the
// consent screen before the app (and before DataSync mounts). For everyone else
// — including all existing users, who have no pending doc — it renders children
// after a single null read. Fail-open: any error → render the app.

const PUBLIC = ['/auth', '/privacy', '/connect', '/delete-account']

export function ConsentGate({ children }: { children: ReactNode }) {
  const { user } = useAuthStore()
  const pathname = usePathname()
  const isPublic = !!pathname && PUBLIC.some(p => pathname.startsWith(p))

  const [status, setStatus] = useState<'checking' | 'clear' | 'pending'>('clear')
  const [invite, setInvite] = useState<PendingInvite | null>(null)

  useEffect(() => {
    const email = user?.email?.toLowerCase()
    if (!email) { setStatus('clear'); return }
    let alive = true
    setStatus('checking')
    getDoc(doc(db, 'clientLinks', `pending_${email}`))
      .then(snap => {
        if (!alive) return
        if (snap.exists() && snap.data().status === 'pending') {
          setInvite({ consentVersion: snap.data().consentVersion || 'v1' })
          setStatus('pending')
        } else {
          setStatus('clear')
        }
      })
      .catch(() => { if (alive) setStatus('clear') }) // fail-open — never block the app
    return () => { alive = false }
  }, [user?.email])

  // No user or a public route → app renders normally (AuthProvider owns /auth redirects).
  if (!user || isPublic) return <>{children}</>

  if (status === 'checking') {
    return <div className="min-h-[100dvh] grid place-items-center text-muted-txt">טוען…</div>
  }
  if (status === 'pending' && invite) {
    return <ConsentScreen invite={invite} onResolved={() => setStatus('clear')} />
  }
  return <>{children}</>
}
