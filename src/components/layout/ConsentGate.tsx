'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'
import { ConsentScreen, type PendingInvite } from '@/components/auth/ConsentScreen'
import { refreshBrand } from '@/components/layout/BrandProvider'

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
  const [variant, setVariant] = useState<'view' | 'edit' | 'view-edit'>('view')

  useEffect(() => {
    const email = user?.email?.toLowerCase()
    const uid   = user?.uid
    if (!email || !uid) { setStatus('clear'); return }
    let alive = true
    setStatus('checking')
    // Two independent reads: the pre-registration invite (pending_{email}) and
    // the active link keyed by uid (which carries an edit REQUEST). A brand-new
    // view invite takes priority; otherwise an outstanding edit request shows.
    Promise.all([
      getDoc(doc(db, 'clientLinks', `pending_${email}`)).catch(() => null),
      getDoc(doc(db, 'clientLinks', uid)).catch(() => null),
    ])
      .then(([pendingSnap, linkSnap]) => {
        if (!alive) return
        if (pendingSnap?.exists() && pendingSnap.data().status === 'pending') {
          const pd = pendingSnap.data()
          // Combined view+edit invites (the default now) carry requestedAccess:
          // 'write' + consentVersion v2 → one screen grants both. Legacy view-only
          // invites (no requestedAccess) still show the view-only screen.
          const combined = pd.requestedAccess === 'write'
          setInvite({ consentVersion: pd.consentVersion || (combined ? 'v2' : 'v1') })
          setVariant(combined ? 'view-edit' : 'view')
          setStatus('pending')
          return
        }
        const l = linkSnap?.exists() ? linkSnap.data() : null
        if (l && l.status === 'active' && l.requestedAccess === 'write' && l.access !== 'write') {
          setInvite({ consentVersion: l.consentVersion || 'v2' })
          setVariant('edit')
          setStatus('pending')
          return
        }
        setStatus('clear')
      })
      .catch(() => { if (alive) setStatus('clear') }) // fail-open — never block the app
    return () => { alive = false }
  }, [user?.email, user?.uid])

  // No user or a public route → app renders normally (AuthProvider owns /auth redirects).
  if (!user || isPublic) return <>{children}</>

  if (status === 'checking') {
    return <div className="min-h-[100dvh] grid place-items-center text-muted-txt">טוען…</div>
  }
  if (status === 'pending' && invite) {
    return <ConsentScreen invite={invite} variant={variant} onResolved={() => { setStatus('clear'); refreshBrand() }} />
  }
  return <>{children}</>
}
