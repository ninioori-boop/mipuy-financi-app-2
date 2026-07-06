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
import { toast } from 'sonner'
import { useAuthStore }    from '@/stores/authStore'
import { useSyncStore }    from '@/stores/syncStore'
import { useMonthlyStore } from '@/stores/monthlyStore'
import { useAnnualStore }  from '@/stores/annualStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useGoalsStore }   from '@/stores/goalsStore'
import { useCreditStore }  from '@/stores/creditStore'
import { useMeetingsStore } from '@/stores/meetingsStore'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { useCategoryBudgetStore } from '@/stores/categoryBudgetStore'
import { useClientProfileStore } from '@/stores/clientProfileStore'
import { useBusinessStore } from '@/stores/businessStore'
import { useBusinessAnnualStore } from '@/stores/businessAnnualStore'
import { useRecurringStore } from '@/stores/recurringStore'
import { saveUserData, loadUserData, loadSharedLearnedDB, createVersion } from '@/lib/firestoreService'
import { collectSnapshot, applySnapshot, resetAllStores, snapshotSize } from '@/lib/dataSync'
import { useTransactionInbox } from '@/hooks/useTransactionInbox'
import { useRecurringExpenses } from '@/hooks/useRecurringExpenses'

const DEBOUNCE_MS       = 2000
const BACKUP_DEBOUNCE_MS = 500     // localStorage mirror — faster than the network save
const MAX_BYTES         = 900_000  // ≈900KB; Firestore doc hard cap is ~1MB
// Server clock skew tolerance: only offer restore when localStorage is
// meaningfully newer than the Firestore doc (5s buffer avoids false positives).
const RESTORE_SKEW_MS   = 5_000
// Snapshot version cadence — a fresh entry in /users/{uid}/versions gets
// written at most this often. Keeps history granular enough to rewind
// a bad edit without inflating storage costs.
const VERSION_INTERVAL_MS = 5 * 60 * 1000

// localStorage key for the per-user snapshot backup. Kept per-uid so
// switching accounts on the same device doesn't cross the streams.
const backupKey = (uid: string) => `snapshot-backup:${uid}`

interface LocalBackup {
  ts:       number
  snapshot: unknown
}

function readLocalBackup(uid: string): LocalBackup | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(backupKey(uid))
    if (!raw) return null
    const parsed = JSON.parse(raw) as LocalBackup
    if (typeof parsed?.ts !== 'number' || !parsed.snapshot) return null
    return parsed
  } catch {
    return null
  }
}

function writeLocalBackup(uid: string, snapshot: unknown) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(backupKey(uid), JSON.stringify({ ts: Date.now(), snapshot }))
  } catch { /* quota exceeded — non-fatal, network save is still primary */ }
}

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
  const backupTimer     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedJson   = useRef<string>('')
  const lastBackupJson  = useRef<string>('')
  const lastVersionAt   = useRef<number>(0)
  // Cached Firebase ID token — needed by the beacon-save handler at tab close
  // (sendBeacon runs synchronously; we can't await getIdToken() there).
  const cachedIdToken   = useRef<string>('')
  const [retryCount, setRetryCount] = useState(0)

  // Drain server-pushed transactions (Apple Pay / Google Pay) into the expense
  // log. No-op until the transactionInbox rule + backend are enabled.
  useTransactionInbox()

  // Post recurring fixed expenses (rent, subscriptions…) into the expense log
  // once per month when each rule's day arrives. Gated on hydration inside.
  useRecurringExpenses()

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
      .then(result => {
        if (cancelled) return
        if (result?.data) applySnapshot(result.data)
        // baseline snapshot prevents an immediate auto-save right after load
        lastSavedJson.current = JSON.stringify(collectSnapshot())
        // Seed the localStorage-backup baseline too so a fresh load doesn't
        // immediately trigger a redundant mirror write.
        lastBackupJson.current = lastSavedJson.current
        setHydrated(true)
        setStatus('idle')

        // Safety-net restore: if there's a localStorage backup that's newer
        // than what Firestore returned, offer to reapply it. Covers the case
        // where the previous session ended before Firestore was updated
        // (tab crash, closed within the 2s debounce, beacon rejected, etc.).
        const uid = user.uid
        const backup = readLocalBackup(uid)
        const remoteTs = result?.updatedAt ?? 0
        if (backup && backup.ts > remoteTs + RESTORE_SKEW_MS) {
          const label = new Date(backup.ts).toLocaleString('he-IL', {
            hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
          })
          toast.info(
            `💾 נמצא גיבוי מקומי חדש יותר מהענן (${label}) — לשחזר?`,
            {
              duration: Infinity,
              closeButton: true,
              action: {
                label: 'שחזר',
                onClick: () => {
                  applySnapshot(backup.snapshot)
                  // Force the next debounced save to push this restored state
                  // upstream so the local + cloud converge.
                  lastSavedJson.current = ''
                  toast.success('✅ הנתונים שוחזרו מהגיבוי המקומי')
                },
              },
            },
          )
        }
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

  // ── 2. Subscribe to data stores → debounced save + local backup ──
  useEffect(() => {
    if (!user || !hydrated) return

    const triggerSave = () => {
      // Flip isDirty (only if not already dirty — avoids re-renders on every keystroke).
      if (!useSyncStore.getState().isDirty) useSyncStore.getState().setDirty(true)

      // ── Local safety-net backup (500ms debounce, sync write, no network).
      // This is the "always latest" copy. Even if Firestore fails, the tab
      // crashes, or the beacon is blocked, next login can restore from here.
      if (backupTimer.current) clearTimeout(backupTimer.current)
      backupTimer.current = setTimeout(() => {
        const snap = collectSnapshot()
        const json = JSON.stringify(snap)
        if (json === lastBackupJson.current) return
        writeLocalBackup(user.uid, snap)
        lastBackupJson.current = json
      }, BACKUP_DEBOUNCE_MS)

      // ── Firestore debounced save (unchanged from before) ──
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
        if (json === lastSavedJson.current) {
          // Nothing to write — we're already clean.
          if (useSyncStore.getState().isDirty) useSyncStore.getState().setDirty(false)
          return
        }

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
          // Only clear the dirty flag if nothing else changed WHILE the save
          // was in flight. If it did, isDirty stays true — the next debounce
          // will catch it up.
          const nowJson = JSON.stringify(collectSnapshot())
          if (nowJson === json) useSyncStore.getState().setDirty(false)

          // Rolling version history (throttled). Runs after the main save
          // succeeded so a version is only created when we know the state
          // was persistable. Failures here are silent — they don't affect
          // the primary save flow.
          const now = Date.now()
          if (now - lastVersionAt.current > VERSION_INTERVAL_MS) {
            lastVersionAt.current = now
            createVersion(user.uid, snap, size).catch(err => {
              console.warn('[DataSync] version creation failed:', err)
            })
          }
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
      useCategoryBudgetStore.subscribe(triggerSave),
      useClientProfileStore.subscribe(triggerSave),
      useRecurringStore.subscribe(triggerSave),
      useBusinessStore.subscribe(triggerSave),
      useBusinessAnnualStore.subscribe(triggerSave),
    ]

    return () => {
      unsubs.forEach(unsub => unsub())
      if (saveTimer.current)   clearTimeout(saveTimer.current)
      if (backupTimer.current) clearTimeout(backupTimer.current)
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

  // ── 5. Keep the Firebase ID token cached (for the beacon flush) ──
  // getIdToken() is async and does a fetch — can't run inside the pagehide
  // handler because sendBeacon must fire synchronously. Refresh proactively
  // every 30 min; Firebase tokens are valid for 60 min so we always have a
  // fresh one when the tab closes.
  useEffect(() => {
    if (!user) { cachedIdToken.current = ''; return }
    let cancelled = false
    async function refresh() {
      if (!user) return
      try {
        const t = await user.getIdToken()
        if (!cancelled) cachedIdToken.current = t
      } catch { /* ignore — beacon flush will simply skip until we get one */ }
    }
    refresh()
    const id = setInterval(refresh, 30 * 60 * 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [user])

  // ── 6. Tab-close flush via sendBeacon ──
  // The 2s debounce is great for reducing writes during normal work, but
  // it's catastrophic if the user closes the tab within that window — the
  // pending timer dies with the tab and the write never happens. This
  // handler catches that: on pagehide OR when the tab becomes hidden, if
  // there are unsaved changes we push the snapshot via navigator.sendBeacon,
  // which the browser guarantees to deliver even mid-close.
  useEffect(() => {
    if (!user || !hydrated) return
    const uid = user.uid

    function flushIfDirty() {
      const snap = collectSnapshot()
      const json = JSON.stringify(snap)
      if (json === lastSavedJson.current) return   // nothing to save

      // FIRST: mirror to localStorage synchronously. This is our ironclad
      // guarantee — even if the network beacon is blocked/refused/offline,
      // the next login on this device can restore from here. Runs even if
      // we don't have a token to send the beacon.
      writeLocalBackup(uid, snap)
      lastBackupJson.current = json

      const token = cachedIdToken.current
      if (!token) return                             // can't authenticate; local backup will save us

      const size = snapshotSize(snap)
      if (size > MAX_BYTES) return                   // same guard as the debounced save

      try {
        const payload = JSON.stringify({ token, snapshot: snap })
        const blob = new Blob([payload], { type: 'application/json' })
        // sendBeacon returns false if the browser refused to queue it (rare —
        // usually only if the payload is above browser's beacon size limit).
        // Fall back to fetch({keepalive:true}) which has similar guarantees.
        const ok = navigator.sendBeacon('/api/save-snapshot', blob)
        if (!ok) {
          fetch('/api/save-snapshot', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    payload,
            keepalive: true,
          }).catch(() => {})
        }
        // Optimistic update — assume it went through, so a subsequent hide
        // event in the same session doesn't re-send an identical payload.
        lastSavedJson.current = json
      } catch { /* worst case, the debounced save on next re-open still fires */ }
    }

    function onPageHide() { flushIfDirty() }
    function onVisibility() {
      if (document.visibilityState === 'hidden') flushIfDirty()
    }

    window.addEventListener('pagehide',            onPageHide)
    document.addEventListener('visibilitychange',  onVisibility)
    return () => {
      window.removeEventListener('pagehide',           onPageHide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [user, hydrated])

  // ── 6b. beforeunload confirmation when there are unsaved changes ──
  // Belt-and-suspenders on top of the pagehide beacon: if the browser somehow
  // doesn't fire pagehide reliably (Chrome mobile foreground/background is
  // flaky), the native dialog prompts the user before the tab actually closes.
  // Only fires when isDirty is true — a clean save state closes silently.
  useEffect(() => {
    if (!user || !hydrated) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!useSyncStore.getState().isDirty) return
      // Modern browsers ignore returnValue but require preventDefault + a
      // truthy returnValue to actually show the confirmation.
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [user, hydrated])

  // ── 7. Prominent error notifications ──
  // The SaveStatusBar pill is easy to miss when the advisor is heads-down
  // with a client. On any transition INTO 'error' or 'offline', pop a
  // persistent toast — it stays until the user acknowledges it or the
  // status transitions away.
  useEffect(() => {
    let currentToastId: string | number | null = null
    let lastStatus = useSyncStore.getState().status
    const unsub = useSyncStore.subscribe(state => {
      if (state.status === lastStatus) return
      // Transitioning OUT of a bad state → clear any lingering toast.
      if ((lastStatus === 'error' || lastStatus === 'offline') && currentToastId != null) {
        toast.dismiss(currentToastId)
        currentToastId = null
      }
      // Transitioning INTO a bad state → show one.
      if (state.status === 'error') {
        currentToastId = toast.error(
          `⚠️ שגיאת שמירה: ${state.errorMessage ?? 'שינויים אחרונים ייתכן שלא נשמרו'}. אל תסגור את הטאב — נסה שוב.`,
          { duration: Infinity, closeButton: true },
        )
      } else if (state.status === 'offline') {
        currentToastId = toast.warning(
          '📡 אין חיבור לאינטרנט — שינויים חדשים לא יישמרו עד שהחיבור יחזור.',
          { duration: Infinity, closeButton: true },
        )
      }
      lastStatus = state.status
    })
    return () => {
      unsub()
      if (currentToastId != null) toast.dismiss(currentToastId)
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
