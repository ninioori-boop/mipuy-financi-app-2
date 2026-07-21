'use client'

import { useImpersonationStore } from '@/stores/impersonationStore'

// Fixed "you are viewing a client's account" banner, visible on EVERY page
// while advisor view-as-client mode is active. Exiting does a full page
// navigation (not SPA) so the advisor's own data rehydrates from a clean slate.
export function ImpersonationBanner() {
  const client = useImpersonationStore(s => s.client)
  if (!client) return null

  function exit() {
    // CRITICAL: do NOT call stop() here. The guard must stay up through the
    // unload — dropping it first lets the pagehide/visibility flush "rescue"
    // the client's data straight into the advisor's own account (real bug,
    // caught in production verification 2026-07-21). The full page load wipes
    // the in-memory store anyway, so navigating is all an exit needs.
    window.location.assign('/app/advisor')
  }

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 border-t border-gold/40 bg-[#241d10]/95 backdrop-blur px-3 sm:px-5 py-2.5">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 text-sm">
          <span aria-hidden>👁️</span>
          <span className="text-gold font-semibold truncate">
            אתה צופה בחשבון של {client.name}
          </span>
          <span className="text-muted-txt hidden sm:inline">· קריאה בלבד, שום שינוי לא נשמר</span>
        </div>
        <button
          onClick={exit}
          className="min-h-[38px] shrink-0 rounded-full bg-gold text-surface px-4 text-sm font-bold hover:bg-gold-light transition-colors"
        >
          ⟵ חזרה לחשבון שלי
        </button>
      </div>
    </div>
  )
}
