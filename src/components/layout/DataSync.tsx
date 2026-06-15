'use client'

/**
 * DataSync — wires Firestore persistence to all data stores.
 *
 * Lifecycle:
 *   - User logs in   → load from Firestore, applySnapshot, mark hydrated
 *   - User logs out  → resetAllStores, clear hydrated flag
 *   - Any data store changes (post-hydration) → debounced save (2s) to Firestore
 *   - Network goes offline/online → status reflects this
 *
 * Defensive guards:
 *   - Never saves before initial load completes (hydrated flag)
 *   - Skips save when serialized snapshot is identical to last-saved
 *   - Refuses to save snapshots over a size cap (Firestore doc limit ≈ 1MB)
 */

import { useEffect, useRef, useState } from 'react'
import { useAuthStore }    from '@/stores/authStore'
import { useSyncStore }    from '@/stores/syncStore'
import { useMonthlyStore } from '@/stores/monthlyStore'
import { useAnnualStore }  from '@/stores/annualStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useGoalsStore }   from '@/stores/goalsStore'
import { useCreditStore }  from '@/stores/creditStore'
import { useMeetingsStore } from '@/stores/meetingsStore'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { useBusinessStore } from '@/stores/businessStore'
import { useBusinessAnnualStore } from '@/stores/businessAnnualStore'
import { saveUserData, loadUserData, loadSharedLearnedDB } from '@/lib/firestoreService'
import { collectSnapshot, applySnapshot, resetAllStores, snapshotSize } from '@/lib/dataSync'
import { useTransactionInbox } from '@/hooks/useTransactionInbox'

const DEBOUNCE_MS = 2000
const MAX_BYTES   = 900_000  // ≈900KB; Firestore doc hard cap is ~1MB

export function DataSync({ children }: { children: React.ReactNode }) {
  const user            = useAuthStore(s => s.user)
  const authLoading     = useAuthStore(s => s.loading)
  const hydrated        = useSyncStore(s => s.hydrated)
  const status          = useSyncStore(s => s.status)
  const errorMessage    = useSyncStore(s => s.errorMessage)
  const setStatus       = useSyncStore(s => s.setStatus)
  const setHydrated     = useSyncStore(s => s.setHydrated)
  const markSaved       = useSyncStore(s => s.markSaved)

  const saveTimer       = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedJson   = useRef<string>('')
  const [retryCount, setRetryCount] = useState(0)

  // Drain server-pushed transactions (Apple Pay / Google Pay) into the expense
  // log. No-op until the transactionInbox rule + backend are enabled.
  useTransactionInbox()

  // ── 1. Load on auth ready / user change ──
  useEffect(() => {
    if (authLoading) return

    if (!user) {
      // Logged out: cancel any pending save FIRST, then clear in-memory data.
      // Without this clear, a debounced save scheduled before logout could
      // still fire in the gap between this branch running and React running
      // the save-effect cleanup, writing to the previous user's UID.
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      resetAllStores()
      setHydrated(false)
      setStatus('idle')
      lastSavedJson.current = ''
      return
    }

    let cancelled = false
    setStatus('loading')

    // Shared cross-account category-learning pool — loaded silently, never blocks
    // the main load. Lives outside the per-user snapshot, so it never triggers a save.
    loadSharedLearnedDB()
      .then(db => { if (!cancelled) useCreditStore.getState().setSharedLearnedDB(db) })
      .catch(() => {})

    loadUserData(user.uid)
      .then(data => {
        if (cancelled) return
        if (data) applySnapshot(data)
        // baseline snapshot prevents an immediate auto-save right after load
        lastSavedJson.current = JSON.stringify(collectSnapshot())
        setHydrated(true)
        setStatus('idle')
      })
      .catch(err => {
        if (cancelled) return
        setStatus('error', (err as Error)?.message ?? 'שגיאה בטעינת נתונים')
        // Intentionally do NOT setHydrated(true) on load failure.
        // The save effect below is gated on `hydrated`, so leaving it false
        // prevents an empty-defaults snapshot from overwriting real Firestore
        // data on the user's next interaction. UI is blocked by the overlay
        // at the bottom of this component until a retry succeeds.
      })

    return () => { cancelled = true }
  }, [user, authLoading, setStatus, setHydrated, retryCount])

  // ── 2. Subscribe to data stores → debounced save ──
  useEffect(() => {
    if (!user || !hydrated) return

    const triggerSave = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        // Belt-and-suspenders: even if the cleanup race somehow leaves a stale
        // timer armed, re-verify the current authed UID matches the one this
        // closure captured. If the user logged out (or switched accounts)
        // during the debounce window, abort — never write to a stale UID.
        const currentUid = useAuthStore.getState().user?.uid
        if (currentUid !== user.uid) return

        const snap = collectSnapshot()
        const json = JSON.stringify(snap)
        if (json === lastSavedJson.current) return  // no real change

        const size = snapshotSize(snap)
        if (size > MAX_BYTES) {
          setStatus('error', `נתונים גדולים מדי לשמירה (${Math.round(size / 1024)}KB)`)
          return
        }

        if (!navigator.onLine) {
          setStatus('offline')
          return
        }

        setStatus('saving')
        try {
          await saveUserData(user.uid, snap)
          lastSavedJson.current = json
          markSaved()
        } catch (err) {
          setStatus('error', (err as Error)?.message ?? 'שגיאת שמירה')
        }
      }, DEBOUNCE_MS)
    }

    const unsubs = [
      useMonthlyStore.subscribe(triggerSave),
      useAnnualStore.subscribe(triggerSave),
      useMappingStore.subscribe(triggerSave),
      useGoalsStore.subscribe(triggerSave),
      useCreditStore.subscribe(triggerSave),
      useMeetingsStore.subscribe(triggerSave),
      useExpenseLogStore.subscribe(triggerSave),
      useBusinessStore.subscribe(triggerSave),
      useBusinessAnnualStore.subscribe(triggerSave),
    ]

    return () => {
      unsubs.forEach(unsub => unsub())
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [user, hydrated, setStatus, markSaved])

  // ── 3. Mirror mapping installments/debts/savings into all monthly tabs ──
  // Subscribe to any mapping change; on user pause (500ms debounce) call
  // syncFromMapping with no monthId → updates EVERY existing month.
  // User-edited rows (fromMapping:false) stay untouched.
  useEffect(() => {
    if (!user || !hydrated) return

    let mappingTimer: ReturnType<typeof setTimeout> | null = null
    const triggerSync = () => {
      if (mappingTimer) clearTimeout(mappingTimer)
      mappingTimer = setTimeout(() => {
        const mp = useMappingStore.getState()
        useMonthlyStore.getState().syncFromMapping(
          mp.fixed, mp.variable, mp.sub, mp.ins,
          mp.installments, mp.debts, mp.savings,
          mp.varMonths,
        )
      }, 500)
    }
    // Run once on mount to backfill from current mapping snapshot
    triggerSync()
    const unsub = useMappingStore.subscribe(triggerSync)
    return () => {
      unsub()
      if (mappingTimer) clearTimeout(mappingTimer)
    }
  }, [user, hydrated])

  // ── 4. Online/offline awareness ──
  useEffect(() => {
    const onOffline = () => useSyncStore.getState().setStatus('offline')
    const onOnline  = () => useSyncStore.getState().setStatus('idle')
    window.addEventListener('offline', onOffline)
    window.addEventListener('online',  onOnline)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online',  onOnline)
    }
  }, [])

  if (user && !hydrated && status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface px-4">
        <div className="max-w-md w-full rounded-xl border border-line bg-surface2 p-6 space-y-4 text-center">
          <div className="text-3xl">⚠️</div>
          <h2 className="text-lg font-bold text-txt">שגיאה בטעינת הנתונים</h2>
          <p className="text-sm text-muted-txt">
            {errorMessage ?? 'הטעינה מ-Firestore נכשלה.'}
          </p>
          <p className="text-xs text-muted-txt">
            הנתונים שלך בענן בטוחים. אל תבצע שינויים עד שהטעינה תצליח — נסה שוב כדי להמשיך.
          </p>
          <button
            onClick={() => setRetryCount(c => c + 1)}
            className="w-full py-2.5 rounded-lg bg-gold/20 border border-gold/40 text-gold font-bold text-sm hover:bg-gold/30 transition-colors"
          >
            נסה שוב
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
