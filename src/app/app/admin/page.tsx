'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'

// OWNER OVERSIGHT — super-admin only. The platform owner's read-only ledger of
// every advisor and the clients they've brought in (the billing basis). Gated by
// the platformOwners/{uid} record; a non-owner is redirected out. Shows status
// and dates only — never a client's financial data.

type LinkStatus = 'pending' | 'active' | 'declined' | 'revoked' | 'consumed'

interface Link {
  invitedByUid: string
  invitedEmail: string
  status: LinkStatus
  createdAt?: unknown
  statusChangedAt?: unknown
}

interface AdvisorRow {
  uid: string
  email: string
  practiceName: string
  clients: { email: string; status: LinkStatus; date: string }[]
  activeCount: number
}

const STATUS_LABEL: Record<LinkStatus, string> = {
  pending: 'ממתין', active: 'משתף', declined: 'סירב לשתף', revoked: 'ביטל שיתוף', consumed: '',
}

function tsToDate(v: unknown): string {
  const ms = typeof v === 'number' ? v
    : v && typeof (v as { toMillis?: () => number }).toMillis === 'function'
      ? (v as { toMillis: () => number }).toMillis() : undefined
  return ms ? new Date(ms).toLocaleDateString('he-IL') : '—'
}

function Loading() {
  return <div className="max-w-4xl mx-auto p-8 text-center text-muted-txt">טוען…</div>
}

export default function AdminPage() {
  const router = useRouter()
  const { user } = useAuthStore()
  const [isOwner, setIsOwner] = useState<boolean | null>(null)
  const [rows, setRows]       = useState<AdvisorRow[]>([])
  const [booted, setBooted]   = useState(false)

  useEffect(() => {
    if (!user) return
    let alive = true
    getDoc(doc(db, 'platformOwners', user.uid))
      .then(snap => {
        if (!alive) return
        const ok = snap.exists()
        setIsOwner(ok)
        if (!ok) router.replace('/app/home')
      })
      .catch(() => { if (alive) { setIsOwner(false); router.replace('/app/home') } })
    return () => { alive = false }
  }, [user, router])

  const load = useCallback(async () => {
    try {
      const [linksSnap, advisorsSnap, practicesSnap] = await Promise.all([
        getDocs(collection(db, 'clientLinks')),
        getDocs(collection(db, 'advisors')),
        getDocs(collection(db, 'practices')),
      ])
      const practiceName = new Map<string, string>()
      practicesSnap.forEach(p => practiceName.set(p.id, (p.data().name as string) || p.id))

      const byAdvisor = new Map<string, AdvisorRow>()
      advisorsSnap.forEach(a => {
        const d = a.data()
        byAdvisor.set(a.id, {
          uid: a.id,
          email: (d.email as string) || a.id,
          practiceName: practiceName.get(d.practiceId as string) || '—',
          clients: [],
          activeCount: 0,
        })
      })

      linksSnap.forEach(l => {
        const d = l.data() as Link
        if (d.status === 'consumed') return
        const row = byAdvisor.get(d.invitedByUid)
        if (!row) return
        row.clients.push({ email: d.invitedEmail, status: d.status, date: tsToDate(d.statusChangedAt ?? d.createdAt) })
        if (d.status === 'active') row.activeCount++
      })

      setRows([...byAdvisor.values()].sort((a, b) => b.clients.length - a.clients.length))
    } finally {
      setBooted(true)
    }
  }, [])

  useEffect(() => { if (isOwner) load() }, [isOwner, load])

  if (!user || isOwner === null) return <Loading />
  if (!isOwner) return null
  if (!booted) return <Loading />

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16">
      <header className="space-y-1.5 pt-1">
        <div className="text-[11px] uppercase tracking-[0.2em] text-gold/80">פיקוח בעלים</div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-txt">יועצים ולקוחות</h1>
        <p className="text-sm text-muted-txt">כל יועץ והלקוחות שהכניס. בסיס החיוב.</p>
      </header>

      {rows.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface2 p-6 text-center text-muted-txt">
          עוד אין יועצים מוקצים.
        </div>
      )}

      {rows.map(r => (
        <section key={r.uid} className="rounded-2xl border border-line bg-surface2 overflow-hidden">
          <div className="bg-surface px-4 sm:px-5 py-3.5 border-b border-line flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="font-semibold text-txt truncate">{r.practiceName}</div>
              <div className="text-xs text-muted-txt truncate" dir="ltr">{r.email}</div>
            </div>
            <div className="text-sm text-muted-txt tabular-nums whitespace-nowrap">
              <span className="text-income font-semibold">{r.activeCount}</span> משתפים · {r.clients.length} סה״כ
            </div>
          </div>
          {r.clients.length === 0 ? (
            <div className="px-4 sm:px-5 py-4 text-sm text-muted-txt">עוד לא הזמין לקוחות.</div>
          ) : (
            <ul className="divide-y divide-line/50">
              {r.clients.map((c, i) => (
                <li key={c.email + i} className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-txt truncate" dir="ltr">{c.email}</span>
                  <span className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-muted-txt">{STATUS_LABEL[c.status]}</span>
                    <span className="text-xs text-muted-txt tabular-nums">{c.date}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
