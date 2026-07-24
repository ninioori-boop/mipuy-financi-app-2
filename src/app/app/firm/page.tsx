'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { callable } from '@/lib/firebase'
import { useAuthStore } from '@/stores/authStore'

// FIRM MANAGER — the middle tier. The practice OWNER sees every advisor in their
// firm and the clients each brought in. Data comes from the getFirmOverview
// callable (which authorizes the caller as the practice owner), so there is no
// client-side rule change. Shows status + dates only — never a client's data.

type LinkStatus = 'pending' | 'active' | 'declined' | 'revoked' | 'consumed'

interface ClientRow { email: string; status: LinkStatus; dateMs: number }
interface AdvisorRow { uid: string; email: string; role: string; clients: ClientRow[]; activeCount: number }
interface FirmOverview { practiceName: string; advisorCount: number; advisors: AdvisorRow[] }

const STATUS_LABEL: Record<LinkStatus, string> = {
  pending: 'ממתין', active: 'משתף', declined: 'סירב לשתף', revoked: 'ביטל שיתוף', consumed: '',
}

const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleDateString('he-IL') : '—')

function Loading() {
  return <div className="max-w-4xl mx-auto p-8 text-center text-muted-txt">טוען…</div>
}

export default function FirmPage() {
  const router = useRouter()
  const { user } = useAuthStore()
  const [data, setData]   = useState<FirmOverview | null>(null)
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    if (!user) return
    let alive = true
    callable<Record<string, never>, FirmOverview>('getFirmOverview')({})
      .then(res => { if (alive) { setData(res.data); setBooted(true) } })
      .catch(() => { if (alive) router.replace('/app/home') })   // not a firm owner → out
    return () => { alive = false }
  }, [user, router])

  if (!user || !booted || !data) return <Loading />

  const totalActive = data.advisors.reduce((s, a) => s + a.activeCount, 0)
  const totalClients = data.advisors.reduce((s, a) => s + a.clients.length, 0)

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16">
      <header className="space-y-1.5 pt-1">
        <div className="text-[11px] uppercase tracking-[0.2em] text-gold/80">ניהול משרד</div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-txt">{data.practiceName}</h1>
        <p className="text-sm text-muted-txt">
          {data.advisorCount} יועצים · <span className="text-income font-semibold">{totalActive}</span> לקוחות משתפים · {totalClients} סה״כ
        </p>
      </header>

      {data.advisors.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface2 p-6 text-center text-muted-txt">
          עוד אין יועצים במשרד.
        </div>
      )}

      {data.advisors.map(a => (
        <section key={a.uid} className="rounded-2xl border border-line bg-surface2 overflow-hidden">
          <div className="bg-surface px-4 sm:px-5 py-3.5 border-b border-line flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-txt font-semibold truncate" dir="ltr">{a.email}</span>
              {a.role === 'owner' && (
                <span className="text-[10px] rounded-full bg-gold/15 text-gold px-2 py-0.5 shrink-0">מנהל</span>
              )}
            </div>
            <div className="text-sm text-muted-txt tabular-nums whitespace-nowrap">
              <span className="text-income font-semibold">{a.activeCount}</span> משתפים · {a.clients.length} סה״כ
            </div>
          </div>
          {a.clients.length === 0 ? (
            <div className="px-4 sm:px-5 py-4 text-sm text-muted-txt">עוד לא הזמין לקוחות.</div>
          ) : (
            <ul className="divide-y divide-line/50">
              {a.clients.map((c, i) => (
                <li key={c.email + i} className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-txt truncate" dir="ltr">{c.email}</span>
                  <span className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-muted-txt">{STATUS_LABEL[c.status]}</span>
                    <span className="text-xs text-muted-txt tabular-nums">{fmtDate(c.dateMs)}</span>
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
