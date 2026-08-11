'use client'

import { useEffect, useState, useCallback, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'
import { ConsentScreen, type PendingInvite } from '@/components/auth/ConsentScreen'
import { VerifyEmailScreen } from '@/components/auth/VerifyEmailScreen'
import { NotInvitedScreen } from '@/components/auth/NotInvitedScreen'
import { refreshBrand } from '@/components/layout/BrandProvider'
import { raceWithTimeout, TIMED_OUT } from '@/lib/promiseTimeout'

// Sits between AuthProvider and DataSync. For a signed-in user it does ONE read
// of clientLinks/pending_{email}: if a pending invite exists, it shows the
// consent screen before the app (and before DataSync mounts). For everyone else
// — including all existing users, who have no pending doc — it renders children
// after a single null read. Fail-open: any error → render the app.

const PUBLIC = ['/auth', '/privacy', '/connect', '/delete-account']

// A Firestore read that never settles used to strand this gate on "טוען…"
// forever: the reads had a success path and an error path but no path for
// "no answer at all", and this component renders ABOVE the whole app, so the
// user's only escape was to guess that a manual reload might help.
// Timing out extends the fail-open rule already stated above from "any error"
// to "any error or silence" — the invite is simply re-checked on the next load.
// Generous on purpose: the two reads normally land in a few hundred ms.
const CONSENT_CHECK_TIMEOUT_MS = 8_000

/**
 * Is this account on the invite allowlist? `true` / `false` / `null` when the
 * question could not be answered. Only an explicit `false` blocks — the browser
 * cannot read `allowlist` itself (the rules deny it), so this asks the server,
 * and anything short of a clear "no" leaves the app open.
 */
async function fetchInviteStatus(): Promise<boolean | null> {
  try {
    const user = auth.currentUser
    if (!user) return null
    const res = await fetch('/api/invite-status', {
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    })
    if (!res.ok) return null
    const body = await res.json()
    return typeof body?.invited === 'boolean' ? body.invited : null
  } catch {
    return null
  }
}

export function ConsentGate({ children }: { children: ReactNode }) {
  const { user } = useAuthStore()
  const pathname = usePathname()
  const isPublic = !!pathname && PUBLIC.some(p => pathname.startsWith(p))

  const [status, setStatus] = useState<'checking' | 'clear' | 'pending'>('clear')
  const [invite, setInvite] = useState<PendingInvite | null>(null)
  const [variant, setVariant] = useState<'view' | 'edit' | 'view-edit'>('view')
  const [notInvited, setNotInvited] = useState(false)

  // DELIBERATELY its own effect, not part of the race below. Joining them would
  // couple the consent screen to a cold serverless lambda: Promise.all settles
  // at the slowest, so a slow invite check past the 8s timeout would discard
  // two Firestore reads that landed in 300ms and silently skip a client's
  // consent screen — and it would put that lambda on first paint for everyone.
  // This screen replaces a 90-minute dead end; arriving a second late is fine.
  const recheckInvite = useCallback(async () => {
    const answer = await fetchInviteStatus()
    setNotInvited(answer === false)
    return answer
  }, [])

  useEffect(() => {
    if (!user?.uid) { setNotInvited(false); return }
    let alive = true
    fetchInviteStatus().then(answer => { if (alive) setNotInvited(answer === false) })
    return () => { alive = false }
  }, [user?.uid])

  useEffect(() => {
    const email = user?.email?.toLowerCase()
    const uid   = user?.uid
    if (!email || !uid) { setStatus('clear'); return }
    let alive = true
    setStatus('checking')
    // Two independent reads: the pre-registration invite (pending_{email}) and
    // the active link keyed by uid (which carries an edit REQUEST). A brand-new
    // view invite takes priority; otherwise an outstanding edit request shows.
    raceWithTimeout(Promise.all([
      getDoc(doc(db, 'clientLinks', `pending_${email}`)).catch(() => null),
      getDoc(doc(db, 'clientLinks', uid)).catch(() => null),
    ]), CONSENT_CHECK_TIMEOUT_MS)
      .then(result => {
        if (!alive) return
        // Silence is treated exactly like the error path below. Because this is
        // a race there is only ever one settle, so a read landing late can no
        // longer dismiss a consent screen that is already on the user's screen.
        if (result === TIMED_OUT) { setStatus('clear'); return }
        const [pendingSnap, linkSnap] = result
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

  // Before the verification gate below: an address that was never invited will
  // never become usable by verifying it, so "check your email" is advice that
  // cannot work — precisely the dead end this replaces.
  if (notInvited) return <NotInvitedScreen user={user} onRecheck={recheckInvite} />

  // An unverified PASSWORD account stops here, before the app. Without this the
  // invite-squatting fix (clientLinks/setClientSharing trust only a VERIFIED
  // email claim) would break silently for them: the pending-invite read below
  // is denied, the .catch turns that into "no invite", and the consent screen
  // simply never appears. All pre-gate password accounts were migrated to
  // verified, so only new password sign-ups ever see this screen. Google and
  // custom-token sessions carry no 'password' provider and pass straight through.
  if (user.providerData.some(p => p.providerId === 'password') && !user.emailVerified) {
    return <VerifyEmailScreen user={user} />
  }

  if (status === 'checking') {
    return <div className="min-h-[100dvh] grid place-items-center text-muted-txt">טוען…</div>
  }
  if (status === 'pending' && invite) {
    return <ConsentScreen invite={invite} variant={variant} onResolved={() => { setStatus('clear'); refreshBrand() }} />
  }
  return <>{children}</>
}
