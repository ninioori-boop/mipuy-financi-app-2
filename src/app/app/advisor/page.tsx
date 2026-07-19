'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/authStore'
import { hasLabAccess } from '@/lib/labAccess'
import { AdvisorDashboard } from '@/components/advisor/AdvisorDashboard'
import { ClientDetailView } from '@/components/advisor/ClientDetailView'
import { WeeklyEmailPreview } from '@/components/advisor/WeeklyEmailPreview'
import { MOCK_CLIENTS, nameFromEmail, type MockClient } from '@/lib/advisorMock'

// ADVISOR MANAGEMENT — Stage 1 design prototype.
//
// Pure side page: reachable only by URL (/app/advisor), gated to advisors, fed
// entirely by MOCK data. No Firebase, no persistence, no writes — added clients
// live in React state and vanish on reload. Nothing in the running app imports
// this, so it cannot affect anything live. The real backend arrives in Stage 2.

const emptyFin = (): MockClient['fin'] => ({
  income: [], fixed: [], sub: [], ins: [], variable: [], annual: [],
  debts: [], installments: [], savings: [], creditCards: [], bankAccounts: [],
  varMonths: 1, goals: [],
})

export default function AdvisorPage() {
  const router = useRouter()
  const { user } = useAuthStore()
  const isAdvisor = hasLabAccess(user?.email)

  // Full page guard — advisors only, even via direct URL.
  useEffect(() => {
    if (user && !hasLabAccess(user.email)) router.replace('/app/home')
  }, [user, router])

  const [view, setView]                 = useState<'dashboard' | 'email'>('dashboard')
  const [openClientId, setOpenClientId] = useState<string | null>(null)
  const [addedClients, setAddedClients] = useState<MockClient[]>([])

  const clients = useMemo(() => [...MOCK_CLIENTS, ...addedClients], [addedClients])
  const openClient = openClientId ? clients.find(c => c.id === openClientId) ?? null : null
  const advisorName = user?.displayName || (user?.email ? nameFromEmail(user.email) : 'יועץ')

  function addClient(email: string) {
    const c: MockClient = {
      id: 'new-' + Math.random().toString(36).slice(2, 8),
      name: nameFromEmail(email),
      email,
      lifecycle: 'pending',
      stage: 0,
      lastActivity: new Date().toISOString().slice(0, 10),
      flags: [],
      fin: emptyFin(),
    }
    setAddedClients(prev => [...prev, c])
  }

  if (!isAdvisor) return null

  if (openClient) {
    return <ClientDetailView client={openClient} onExit={() => setOpenClientId(null)} />
  }
  if (view === 'email') {
    return <WeeklyEmailPreview clients={clients} advisorName={advisorName} onClose={() => setView('dashboard')} />
  }
  return (
    <AdvisorDashboard
      clients={clients}
      onOpenClient={setOpenClientId}
      onAddClient={addClient}
      onOpenEmail={() => setView('email')}
    />
  )
}
