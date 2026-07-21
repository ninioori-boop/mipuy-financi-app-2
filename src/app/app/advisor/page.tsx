'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { doc, getDoc } from 'firebase/firestore'
import { toast } from 'sonner'
import { db, callable } from '@/lib/firebase'
import { applySnapshot } from '@/lib/dataSync'
import { useAuthStore } from '@/stores/authStore'
import { useImpersonationStore } from '@/stores/impersonationStore'
import { AdvisorDashboard } from '@/components/advisor/AdvisorDashboard'
import { ClientDetailView } from '@/components/advisor/ClientDetailView'
import { WeeklyEmailPreview } from '@/components/advisor/WeeklyEmailPreview'
import { listAdvisorClients } from '@/lib/advisorClients'
import { nameFromEmail, type MockClient } from '@/lib/advisorMock'

// ADVISOR MANAGEMENT — Stage 2 (add-client slice, read-only).
//
// Real data now: the page is gated by the advisors/{uid} ROLE (not the lab email
// list), and the roster is loaded from clientLinks + each active client's real
// snapshot. Inviting a client calls the inviteClient callable. No writes to any
// client's data — advisor access here is read-only.

function Loading() {
  return <div className="max-w-6xl mx-auto p-8 text-center text-muted-txt">טוען…</div>
}

export default function AdvisorPage() {
  const router = useRouter()
  const { user } = useAuthStore()

  const [isAdvisor, setIsAdvisor] = useState<boolean | null>(null)
  const [clients, setClients]     = useState<MockClient[]>([])
  const [booted, setBooted]       = useState(false)
  const [view, setView]           = useState<'dashboard' | 'email'>('dashboard')
  const [openClientId, setOpenClientId] = useState<string | null>(null)

  // Role gate — advisors only, via the real advisors/{uid} record.
  useEffect(() => {
    if (!user) return
    let alive = true
    getDoc(doc(db, 'advisors', user.uid))
      .then(snap => {
        if (!alive) return
        const ok = snap.exists()
        setIsAdvisor(ok)
        if (!ok) router.replace('/app/home')
      })
      .catch(() => { if (alive) { setIsAdvisor(false); router.replace('/app/home') } })
    return () => { alive = false }
  }, [user, router])

  const refetch = useCallback(async () => {
    if (!user) return
    try { setClients(await listAdvisorClients(user.uid)) }
    finally { setBooted(true) }
  }, [user])

  useEffect(() => { if (isAdvisor) refetch() }, [isAdvisor, refetch])

  const openClient = openClientId ? clients.find(c => c.id === openClientId) ?? null : null
  const advisorName = user?.displayName || (user?.email ? nameFromEmail(user.email) : 'יועץ')

  /** Enter read-only "view as client" mode: hydrate the stores with the
   *  client's snapshot and jump into the regular tabs. DataSync's guards make
   *  sure NOTHING gets saved while this mode is on. Exit = full reload. */
  async function viewFullAccount(c: MockClient) {
    try {
      const snap = await getDoc(doc(db, 'users', c.id))
      const data = snap.exists() ? snap.data().data : null
      if (!data) { toast.error('אין נתונים לצפייה עבור הלקוח הזה.'); return }
      // Order matters: raise the guard BEFORE touching the stores, so the
      // store-change subscriptions can never schedule a save of client data.
      useImpersonationStore.getState().start({ uid: c.id, name: c.name, email: c.email })
      applySnapshot(data)
      router.push('/app/home')
    } catch {
      toast.error('טעינת חשבון הלקוח נכשלה.')
    }
  }

  async function addClient(email: string): Promise<{ emailSent: boolean }> {
    const res = await callable<{ email: string }, { ok: boolean; emailSent?: boolean }>('inviteClient')({ email })
    await refetch()
    return { emailSent: !!res.data.emailSent }
  }

  if (!user || isAdvisor === null) return <Loading />
  if (!isAdvisor) return null
  if (!booted) return <Loading />

  if (openClient) {
    return (
      <ClientDetailView
        client={openClient}
        onExit={() => setOpenClientId(null)}
        onViewFull={() => viewFullAccount(openClient)}
      />
    )
  }
  if (view === 'email') {
    return <WeeklyEmailPreview clients={clients} advisorName={advisorName} onClose={() => setView('dashboard')} />
  }
  return (
    <AdvisorDashboard
      clients={clients}
      advisorName={advisorName}
      onOpenClient={setOpenClientId}
      onAddClient={addClient}
      onOpenEmail={() => setView('email')}
    />
  )
}
