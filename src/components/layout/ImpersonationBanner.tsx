'use client'

import { useEffect, useState } from 'react'
import { useImpersonationStore } from '@/stores/impersonationStore'
import { useSyncStore } from '@/stores/syncStore'
import { resetSessionStores } from '@/lib/dataSync'
import { requestLiveRefresh, liveRefreshReady } from '@/lib/liveRefresh'
import { timeAgoCoarse } from '@/lib/timeAgo'
import { PRESENCE_SHOW_MS } from './SaveStatusBar'

// Fixed "you are viewing a client's account" banner, visible on EVERY page
// while advisor view-as-client mode is active. Exiting does a full page
// navigation (not SPA) so the advisor's own data rehydrates from a clean slate.
export function ImpersonationBanner() {
  // EVERY hook must run before the early return below — this component renders
  // on every page with client === null, so a hook placed after it would change
  // the hook count on entry and crash React.
  const client = useImpersonationStore(s => s.client)
  const mode   = useImpersonationStore(s => s.mode)
  const remoteActivity = useSyncStore(s => s.remoteActivity)
  const [refreshing, setRefreshing] = useState(false)

  // Refresh the relative label while a chip is on screen, and stop when it
  // expires — no timer outlives the thing it is updating.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!client || !remoteActivity) return
    const age = Date.now() - remoteActivity.seenAt
    if (age >= PRESENCE_SHOW_MS) return
    const tick = setInterval(() => setTick(t => t + 1), 30_000)
    const stop = setTimeout(() => clearInterval(tick), PRESENCE_SHOW_MS - age)
    return () => { clearInterval(tick); clearTimeout(stop) }
  }, [client, remoteActivity])

  // Keep the toast viewport clear of the banner (sonner reads this var).
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--imp-banner-h', client ? '76px' : '0px')
    return () => root.style.setProperty('--imp-banner-h', '0px')
  }, [client])

  if (!client) return null
  const editing = mode === 'edit'
  const showChip = !!remoteActivity && Date.now() - remoteActivity.seenAt < PRESENCE_SHOW_MS

  function exit() {
    // CRITICAL: do NOT call stop() here. The guard must stay up through the
    // unload — dropping it first lets the pagehide/visibility flush "rescue"
    // the client's data straight into the advisor's own account (real bug,
    // caught in production verification 2026-07-21). The full page load wipes
    // the in-memory store anyway, so navigating is all an exit needs.
    // In edit mode the same full-reload exit applies — the last debounced save
    // has its own client-targeted path; no special teardown here.
    //
    // The one thing the reload does NOT clear is the persisted auto-map lab: it
    // rehydrates from localStorage on the way back, so the client's pasted
    // financial context and generated mapping would reappear under the advisor's
    // OWN identity, where "העתק למיפוי" saves them into the advisor's document.
    // Safe to call here: neither store is in the snapshot or DataSync's
    // subscription list, so this cannot feed the pagehide flush the comment above
    // warns about, and it leaves the impersonation guard untouched.
    resetSessionStores()
    window.location.assign('/app/advisor')
  }

  function loadLatest() {
    // DataSync owns the refresh; if it is not mounted (still hydrating, or the
    // listener died) a reload is the honest fallback rather than a dead click.
    if (!liveRefreshReady()) { window.location.reload(); return }
    setRefreshing(true)
    requestLiveRefresh()
    setTimeout(() => setRefreshing(false), 3000)
  }

  return (
    <>
      {/* In-flow spacer: the bar is fixed, so without this the last row of
          every page sits underneath it. Only rendered while impersonating. */}
      <div aria-hidden className="h-20 sm:h-14" />
      <div className="fixed bottom-0 inset-x-0 z-50 border-t border-gold/40 bg-[color-mix(in_srgb,var(--gold)_10%,#14110b)]/95 backdrop-blur px-3 sm:px-5 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))]">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 min-w-0 text-sm">
            <span aria-hidden>{editing ? '✏️' : '👁️'}</span>
            <span className="text-gold font-semibold truncate">
              {editing ? `אתה עורך את החשבון של ${client.name}` : `אתה צופה בחשבון של ${client.name}`}
            </span>
            <span className="text-muted-txt hidden sm:inline">
              {editing ? '· השינויים נשמרים אצל הלקוח' : '· קריאה בלבד, שום שינוי לא נשמר'}
            </span>
          </div>

          <button
            onClick={exit}
            className="order-2 min-h-[38px] shrink-0 rounded-full bg-gold text-surface px-4 text-sm font-bold hover:bg-gold-light transition-colors"
          >
            ⟵ חזרה לחשבון שלי
          </button>

          {showChip && (
            // Own row on mobile: squeezed next to the exit button the message
            // truncates to nothing, and the message is the whole point.
            <span className="order-3 sm:order-none basis-full sm:basis-auto inline-flex items-center justify-between sm:justify-start gap-2 min-w-0 text-xs rounded-full border border-gold/40 bg-surface2/70 text-txt px-2.5 py-1">
              <span role="status" className="truncate">
                {remoteActivity!.byAdvisor ? 'יועץ אחר עדכן נתונים' : 'הלקוח שמר שינויים'}
                <span aria-hidden> {timeAgoCoarse(remoteActivity!.seenAt)}</span>
              </span>
              {!editing && (
                <button
                  onClick={loadLatest}
                  disabled={refreshing}
                  aria-busy={refreshing}
                  aria-label="טען גרסה עדכנית של נתוני הלקוח"
                  title="המסך ייטען מחדש עם הנתונים העדכניים של הלקוח"
                  className="shrink-0 min-h-[36px] px-2 -my-1 rounded text-gold underline font-semibold whitespace-nowrap disabled:opacity-60 disabled:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
                >
                  {refreshing ? 'טוען…' : 'טען גרסה עדכנית'}
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    </>
  )
}
