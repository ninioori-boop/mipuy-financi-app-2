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
import { useBusinessRosterStore } from '@/stores/businessRosterStore'
import { useRecurringStore } from '@/stores/recurringStore'
import { useSubscriptionPrefsStore } from '@/stores/subscriptionPrefsStore'
import { useBudgetReminderStore } from '@/stores/budgetReminderStore'
import { useImpersonationStore } from '@/stores/impersonationStore'
import { saveUserData, saveClientDataAsAdvisor, loadUserData, loadSharedLearnedDB, createVersion } from '@/lib/firestoreService'
import { collectSnapshot, applySnapshot, resetAllStores, resetSessionStores, snapshotSize } from '@/lib/dataSync'
import { heldEventBlocksSave } from '@/lib/heldEventConflict'
import { needsIdentityTeardown } from '@/lib/identitySwitch'
import { registerSaveBaselineBump } from '@/lib/saveBaseline'
import { saveCreditSection } from '@/lib/creditSection'
import { registerLiveRefresh } from '@/lib/liveRefresh'
import { stableStringify, deriveByAdvisor, tsToMillis } from '@/lib/liveSync'
import { onSnapshot, doc as fsDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
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
// Anti-clobber probe floors: at most one freshness read per save burst, and one
// refetch per tab-focus window. Stamped ONLY on clean probes/successful saves —
// a dismissed conflict must not ride the throttle into a silent overwrite.
const PROBE_MIN_INTERVAL_MS = 10_000
const FOCUS_PROBE_MIN_MS    = 30_000
// Conflict-detection skew tolerance. Wider than RESTORE_SKEW_MS on purpose:
// baselines mix client clocks with server timestamps, and a false conflict is
// a hard block here (not just a prompt) — favor missing a sub-15s foreign
// write over nagging users whose clock drifts.
const CONFLICT_SKEW_MS = 15_000
// ── Live sync (effect 2c) ──
// Coalesce remote bursts before touching the stores. Sized against the peer's
// own 2s save debounce so a continuous co-editing session collapses into one
// apply per pause rather than one per keystroke burst.
const LIVE_APPLY_DEBOUNCE_MS = 2000
// A held event (tab hidden, an input focused, a save in flight) is retried,
// but abandoned after this — the focus refetch and the pre-write probe still
// guarantee correctness, and a forever-timer would be worse.
const LIVE_HOLD_MAX_MS = 60_000
// A held evaluation waits for an in-flight save, but never forever: an
// interrupted setDoc's promise can stay pending indefinitely (no offline
// persistence), so `finally` may never run. After this the hold expires.
const SYNC_BUSY_MAX_MS = 10_000
const LIVE_HOLD_RETRY_MS = 300
// The other side may save every couple of seconds. Announce the first few
// applies of a session so the user understands their screen is being updated,
// then fall back to one per minute (the status pill carries the rest).
const LIVE_TOAST_MIN_GAP_MS = 60_000
const LIVE_TOAST_BURST = 3
// ── Live-connection economics ──
// A streamed listener bills one read per remote change PER OPEN CLIENT — an
// idle tab watching a co-editing session costs ~30 reads/min for nothing. So
// the connection follows the USER, not the tab:
//   active (input in the last 2 min, tab visible)  → full live stream
//   idle                                           → 1 light poll per minute
//   away (15 min without any input, or tab hidden) → nothing at all;
//     the first interaction forces a refresh and re-attaches the stream.
const LIVE_ACTIVE_WINDOW_MS  = 2 * 60_000
const LIVE_IDLE_POLL_MS      = 60_000
const LIVE_AWAY_AFTER_MS     = 15 * 60_000
const LIVE_MODE_TICK_MS      = 30_000

const SELF_CONFLICT_MSG = {
  title: 'נמצאה גרסה חדשה יותר בענן',
  description: 'כנראה ממכשיר אחר. טעינת הגרסה החדשה תמחק שינויים שלא נשמרו כאן.',
}
const ADVISOR_CONFLICT_MSG = {
  title: 'הלקוח עדכן נתונים במקביל',
  description: 'טעינת הגרסה של הלקוח תמחק שינויים שלא נשמרו כאן.',
}

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
  // Whose data is currently in the stores. Set when a load completes, cleared on
  // sign-out. Lets the signed-in branch below tell a genuine person-to-person
  // switch (which must tear everything down) from Firebase merely re-emitting
  // the same user, which happens on every navigation.
  const hydratedUid     = useRef<string>('')
  const lastVersionAt   = useRef<number>(0)
  // Cached Firebase ID token — needed by the beacon-save handler at tab close
  // (sendBeacon runs synchronously; we can't await getIdToken() there).
  const cachedIdToken   = useRef<string>('')
  // One-time "edits in view mode are not saved" warning per session.
  const viewEditWarned  = useRef<boolean>(false)
  // Concurrent-edit detection baseline: the client doc's updatedAt (epoch ms)
  // as of the last time WE loaded/wrote it, during advisor edit mode.
  const clientDocBaseline = useRef<number>(0)
  // Anti-clobber state (see probeBeforeWrite / refetchOnFocus):
  const selfDocBaseline  = useRef<number>(0)   // users/{uid}.updatedAt (ms) at our last load/write — self path
  const lastProbeAt      = useRef<number>(0)   // last CLEAN probe or successful save (throttle)
  const lastFocusProbeAt = useRef<number>(0)
  const skipProbeOnce    = useRef<boolean>(false)          // set by "שמור בכל זאת"
  const conflictToastId  = useRef<string | number | null>(null)
  const requestSaveRef   = useRef<() => void>(() => {})    // effect 2 exposes triggerSave here
  // ── Live-sync state (effect 2c) ──
  const syncBusyAt       = useRef<number>(0)   // epoch ms a write/apply started; 0 = idle
  const pendingRemote    = useRef<null | {
    data: unknown; updatedAt: number; byAdvisor: boolean; heldSince: number
  }>(null)
  const liveEvalTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastRemoteApplied = useRef<number>(0)  // SERVER ts of the newest event we consumed
  const knownAdvisorEditAt = useRef<number>(0) // advisor-marker high-water mark
  const viewNotifyTs     = useRef<number>(0)   // advisor VIEW mode: last acknowledged server ts
  const liveToastAt      = useRef<number>(0)
  const liveToastCount   = useRef<number>(0)
  // Credit-split phase A (shadow write): the last credit payload mirrored to
  // users/{uid}/sections/credit, so unchanged credit costs no extra write.
  const lastCreditShadowJson = useRef<string>('')
  // Live-connection mode (see the economics comment above the constants).
  const lastActivityAt = useRef<number>(Date.now())
  const [liveMode, setLiveMode] = useState<'live' | 'idle' | 'away'>('live')
  const stableCacheSrc   = useRef<string>('')  // lazy canonical form of lastSavedJson
  const stableCacheOut   = useRef<string>('')
  // onSnapshot is terminal on error (a revoked link must not retry-loop), so a
  // transient network blip would otherwise leave live sync silently off for the
  // rest of the session. This drives a re-attach when the tab comes back.
  const liveDead         = useRef<boolean>(false)
  const [liveRetry, setLiveRetry] = useState(0)
  const [retryCount, setRetryCount] = useState(0)

  // A write (or an async apply) is in flight. Counted, not a boolean: a save
  // and a conflict-prompt load can overlap, and the first one to finish must
  // not declare the coast clear. Also expires on its own, so a stalled network
  // call can never freeze the live listener for the whole session.
  const syncDepth = useRef(0)
  const syncBusy = () =>
    syncDepth.current > 0 && Date.now() - syncBusyAt.current < SYNC_BUSY_MAX_MS
  const beginSync = () => { if (syncDepth.current === 0) syncBusyAt.current = Date.now(); syncDepth.current += 1 }
  const endSync   = () => { syncDepth.current = Math.max(0, syncDepth.current - 1) }

  // Advisor edit-mode helper: are we saving to a CLIENT's uid, and which uid.
  // In edit mode saves target the client; otherwise the signed-in (advisor) uid.
  function saveTarget() {
    const imp = useImpersonationStore.getState()
    const editMode = !!imp.client && imp.mode === 'edit'
    const uid = editMode ? imp.client!.uid : useAuthStore.getState().user?.uid ?? ''
    return { editMode, uid, imp }
  }

  // ── Anti-clobber: pre-write freshness probe ──
  // Before any full-snapshot write, check whether the target doc changed since
  // OUR last load/write. If it did, block the write and let the user choose:
  // load the newer version (dropping local unsaved edits) or overwrite anyway.
  // Fail-open on probe errors — a transient read failure must never block saving.
  const probeBeforeWrite = async (opts: {
    targetUid: string
    baseline: React.MutableRefObject<number>
    message: { title: string; description: string }
    revalidate: () => boolean
    skipOnce?: boolean
  }): Promise<'proceed' | 'blocked'> => {
    // "שמור בכל זאת" consent — consumed by the CALLER at fire time so an
    // aborted save (offline etc.) burns it instead of leaking it forward.
    if (opts.skipOnce) return 'proceed'
    // An unresolved conflict prompt gates all writes — no re-probe, no stacking.
    if (conflictToastId.current != null) return 'blocked'

    // Exact check before the clock-based one. When the listener is HOLDING a
    // foreign event (it holds rather than applying while an input has focus) we
    // already have the other side's document in memory, so we can compare
    // content instead of timestamps. This matters because the timestamp
    // comparison below tolerates CONFLICT_SKEW_MS (15s) of drift and therefore
    // waves through exactly the case that loses data: the other side's write
    // landing a few seconds after our baseline, while we type. Content has no
    // tolerance to hide behind, costs no Firestore read, and self-excludes our
    // own write echoing back.
    const held = pendingRemote.current
    if (held && heldEventBlocksSave({
      heldData: held.data,
      heldUpdatedAt: held.updatedAt,
      lastSavedJson: lastSavedJson.current,
      lastRemoteApplied: lastRemoteApplied.current,
    })) {
      openConflictChoice(opts)
      return 'blocked'
    }

    if (Date.now() - lastProbeAt.current < PROBE_MIN_INTERVAL_MS) return 'proceed'

    let remoteTs = 0
    try {
      const remote = await loadUserData(opts.targetUid)
      remoteTs = remote?.updatedAt ?? 0
    } catch {
      return 'proceed'
    }
    if (!opts.revalidate()) return 'blocked'
    // A prompt may have opened while we awaited — never stack a second one.
    if (conflictToastId.current != null) return 'blocked'
    if (remoteTs <= opts.baseline.current + CONFLICT_SKEW_MS) {
      // Creep-correct the baseline toward SERVER truth — heals clock skew in
      // both directions over time.
      opts.baseline.current = Math.max(opts.baseline.current, remoteTs)
      lastProbeAt.current = Date.now()
      return 'proceed'
    }

    openConflictChoice(opts)
    return 'blocked'
  }

  // The conflict prompt itself — shared by the pre-write probe above and the
  // live listener (effect 2c), so there is exactly one implementation and one
  // single-instance gate (conflictToastId).
  const openConflictChoice = (opts: {
    targetUid: string
    baseline: React.MutableRefObject<number>
    message: { title: string; description: string }
    revalidate: () => boolean
  }) => {
    if (conflictToastId.current != null) return
    const id = toast.warning(opts.message.title, {
      description: opts.message.description,
      // Two Hebrew action buttons squeeze the default toast — widen it so the
      // text stays readable (mobile-safe via the vw cap).
      style: { width: 'min(92vw, 480px)' },
      duration: Infinity,
      closeButton: true,
      onDismiss: () => {
        // Closed without choosing: re-arm the save so the conflict re-surfaces
        // instead of silently stalling the session's saves. Force the next save
        // to actually re-probe (the listener never stamps lastProbeAt, so the
        // 10s floor could otherwise wave the overwrite straight through), and
        // re-evaluate any live event that arrived while the prompt was open.
        conflictToastId.current = null
        lastProbeAt.current = 0
        requestSaveRef.current()
        scheduleLiveEval(LIVE_HOLD_RETRY_MS)
      },
      action: {
        label: 'טען את הגרסה החדשה',
        onClick: async () => {
          // The gate stays UP until the load settles: dropping it first lets an
          // armed save slip through and a second prompt stack on top.
          beginSync()
          try {
            // Fresh read — more writes may have landed while the prompt sat open.
            const fresh = await loadUserData(opts.targetUid)
            if (!opts.revalidate() || !fresh?.data) { toast.error('הטעינה נכשלה, נסה שוב.'); return }
            if (applyRemote(fresh.data, fresh.updatedAt, opts.baseline) !== null) {
              toast.success('הגרסה החדשה נטענה.')
            }
          } catch {
            toast.error('הטעינה נכשלה, נסה שוב.')
          } finally {
            conflictToastId.current = null
            endSync()
            scheduleLiveEval(LIVE_HOLD_RETRY_MS)
          }
        },
      },
      cancel: {
        label: 'שמור בכל זאת',
        onClick: () => {
          conflictToastId.current = null
          skipProbeOnce.current = true
          // Consent given: the imminent write resolves this conflict, so a live
          // event arriving in the 2s debounce must not re-open the prompt.
          pendingRemote.current = null
          requestSaveRef.current()   // re-arm the normal debounce; every guard re-runs
        },
      },
    })
    conflictToastId.current = id
  }

  // Apply a remote document to the stores and re-seed every marker in the SAME
  // tick. Skipping any of these makes the 14 store subscriptions echo the
  // remote state back as a save, and makes the next probe read it as a
  // conflict. Used by the conflict prompt, the focus refetch and the listener.
  const applyRemote = (
    data: unknown,
    remoteTs: number,
    baseline: React.MutableRefObject<number>,
  ): string | null => {
    // Never move backwards: a slow read (the conflict prompt's fetch) can
    // resolve AFTER a newer version was already applied, and overwriting the
    // newer state while the markers say it is saved would lose that write.
    if (remoteTs > 0 && remoteTs < lastRemoteApplied.current) return null

    // sharedLearnedDB (and the credit-import flags) are NOT part of the
    // snapshot, and resetAllStores clears them — it is loaded once per session,
    // so without this every apply would silently degrade auto-categorization.
    const shared = useCreditStore.getState().sharedLearnedDB
    const prevJson = lastSavedJson.current
    try {
      resetAllStores()
      applySnapshot(data)
    } catch (err) {
      // A malformed remote document must never leave the stores wiped: the
      // 500ms local-backup timer would then mirror an EMPTY portfolio over the
      // user's safety net, and the debounced save could push it to the cloud.
      console.error('[DataSync] remote apply failed, rolling back:', err)
      try {
        resetAllStores()
        if (prevJson) applySnapshot(JSON.parse(prevJson))
      } catch { /* nothing better to try */ }
      setStatus('error', 'טעינת עדכון מרוחק נכשלה')
      return null
    }
    if (shared && Object.keys(shared).length) useCreditStore.setState({ sharedLearnedDB: shared })
    const json = JSON.stringify(collectSnapshot())
    lastSavedJson.current  = json
    lastBackupJson.current = json
    baseline.current       = Math.max(baseline.current, remoteTs)
    lastRemoteApplied.current = Math.max(lastRemoteApplied.current, remoteTs)
    stableCacheSrc.current = ''      // force the canonical cache to rebuild
    useSyncStore.getState().setDirty(false)
    return json
  }

  const scheduleLiveEval = (delay: number) => {
    if (liveEvalTimer.current) clearTimeout(liveEvalTimer.current)
    liveEvalTimer.current = setTimeout(() => liveEvalRef.current(), delay)
  }

  // Credit-split phase A: mirror the heavy credit fields to their own document
  // after every successful main save. SHADOW ONLY — nothing reads it yet; it
  // builds a verified second copy so the read switch (phase B) starts from
  // weeks of proven parity. Fire-and-forget: a mirror failure must never
  // surface as a save error, the main document is still the source of truth.
  const shadowWriteCredit = (targetUid: string) => {
    try {
      const c = useCreditStore.getState()
      const payload = { transactions: c.transactions, uploadedFileNames: c.uploadedFileNames }
      const json = JSON.stringify(payload)
      if (json === lastCreditShadowJson.current) return
      saveCreditSection(targetUid, payload)
        .then(() => { lastCreditShadowJson.current = json })
        .catch(err => console.warn('[DataSync] credit shadow write failed:', err))
    } catch { /* never disturb the save path */ }
  }
  // Effect 2c installs the real evaluator here (it needs the effect's target).
  const liveEvalRef = useRef<() => void>(() => {})

  // ── Anti-clobber: refetch on tab focus ──
  // Coming back to a backgrounded tab: if we're clean, pull the newer version
  // (another device may have saved); if we're dirty AND the cloud moved, show
  // the same choice prompt instead of silently keeping divergent state.
  const refetchOnFocus = async () => {
    if (!useSyncStore.getState().hydrated) return
    if (Date.now() - lastFocusProbeAt.current < FOCUS_PROBE_MIN_MS) return
    lastFocusProbeAt.current = Date.now()

    const imp = useImpersonationStore.getState()
    if (imp.client && imp.mode !== 'edit') return   // view mode: never touch the shown client data
    const editMode  = !!imp.client && imp.mode === 'edit'
    const targetUid = editMode ? imp.client!.uid : useAuthStore.getState().user?.uid
    if (!targetUid) return
    const baseline = editMode ? clientDocBaseline : selfDocBaseline
    const message  = editMode ? ADVISOR_CONFLICT_MSG : SELF_CONFLICT_MSG
    const stillValid = () => {
      const now = useImpersonationStore.getState()
      const sameMode = (!!now.client && now.mode === 'edit') === editMode
      const sameUid = editMode
        ? now.client?.uid === targetUid
        : useAuthStore.getState().user?.uid === targetUid
      return sameMode && sameUid
    }

    // NOT the sticky isDirty flag — the beacon flush clears lastSavedJson but
    // leaves isDirty on, and that flow must still refetch.
    const dirtyNow = JSON.stringify(collectSnapshot()) !== lastSavedJson.current
    if (dirtyNow) {
      await probeBeforeWrite({ targetUid, baseline, message, revalidate: stillValid })
      return
    }

    try {
      const remote = await loadUserData(targetUid)
      if (!remote?.data) return
      // Re-check everything after the await — the user may have typed, logged
      // out or switched modes while the fetch was in flight.
      if (!stillValid()) return
      const preJson = JSON.stringify(collectSnapshot())
      if (preJson !== lastSavedJson.current) return
      if (remote.updatedAt <= baseline.current + CONFLICT_SKEW_MS) return
      const json = applyRemote(remote.data, remote.updatedAt, baseline)
      // This read superseded whatever the listener was holding.
      pendingRemote.current = null
      // A remote write can be OUR OWN beacon echo — only announce real change.
      // Shared toast id with the listener so the two paths can never stack.
      if (json !== null && json !== preJson) {
        toast.info('הנתונים עודכנו ממכשיר אחר.', { id: 'remote-applied', duration: 4000 })
      }
    } catch { /* offline — ignore */ }
  }

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
      // Ephemeral tabs too — sign-out is an identity boundary. Deliberately NOT
      // done in applyRemote(), which resets stores within ONE identity and would
      // otherwise wipe a bank statement mid-review.
      resetSessionStores()
      // Act-as-client must not survive the identity boundary either: a surviving
      // flag makes saveTarget() redirect the NEXT sign-in's own portfolio into
      // the OLD client's document. Safe ONLY here, after resetAllStores() — the
      // stores are empty, so no flush has anything left to leak — and the
      // previous session's save/pagehide effects were detached in React's
      // cleanup phase before this body ran. (The in-place-clear hazard this
      // ordering avoids is the 2026-07-21 pagehide leak.)
      if (useImpersonationStore.getState().client) {
        useImpersonationStore.getState().clearOnIdentityTeardown()
      }
      setHydrated(false)
      setStatus('idle')
      hydratedUid.current   = ''
      lastSavedJson.current = ''
      // Anti-clobber state must not leak into the next session/user:
      selfDocBaseline.current  = 0
      lastProbeAt.current      = 0
      lastFocusProbeAt.current = 0
      skipProbeOnce.current    = false
      // Live-sync state too — a held event or a stale high-water mark must
      // never carry into the next session/user.
      pendingRemote.current      = null
      lastRemoteApplied.current  = 0
      knownAdvisorEditAt.current = 0
      viewNotifyTs.current       = 0
      liveToastAt.current        = 0
      liveToastCount.current     = 0
      lastCreditShadowJson.current = ''
      stableCacheSrc.current     = ''
      syncBusyAt.current         = 0
      syncDepth.current          = 0
      useSyncStore.getState().setRemoteActivity(null)
      if (conflictToastId.current != null) {
        toast.dismiss(conflictToastId.current)
        conflictToastId.current = null
      }
      return
    }

    let cancelled = false
    setStatus('loading')

    // A DIFFERENT person just signed in without the previous one signing out —
    // reachable because /connect and /connect/expenses call signIn* directly, so
    // Firebase emits user B with no null in between and the sign-out teardown
    // above never runs. Everything below this block resets only the anti-clobber
    // and live-sync refs; without the full teardown the stores still hold person
    // A's portfolio while `hydrated` is still true, so the 500ms backup timer
    // mirrors A's data into B's backup key and the 2s save writes it into B's
    // document. A failed load would not even show the blocking overlay, because
    // that is gated on `!hydrated`.
    //
    // Safe to clear stores here: React runs every effect CLEANUP before any
    // effect body, so effect 2 has already unsubscribed the stores and cleared
    // its timers by the time this runs — the resets cannot trigger a save. The
    // timer cancellations below mirror the sign-out branch's own belt-and-braces.
    if (needsIdentityTeardown({ hydratedUid: hydratedUid.current, incomingUid: user.uid })) {
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      if (backupTimer.current) { clearTimeout(backupTimer.current); backupTimer.current = null }
      resetAllStores()
      resetSessionStores()
      // Same reasoning as the sign-out branch above: an act-as-client session
      // belongs to the OLD identity. Cleared after resetAllStores() (stores are
      // empty ⇒ nothing to leak) and after React's cleanup phase detached the
      // previous session's save/pagehide effects — the ordering that makes this
      // safe where an in-place clear was not (2026-07-21).
      if (useImpersonationStore.getState().client) {
        useImpersonationStore.getState().clearOnIdentityTeardown()
      }
      setHydrated(false)
      hydratedUid.current      = ''
      lastSavedJson.current    = ''
      lastBackupJson.current   = ''
      selfDocBaseline.current  = 0
      clientDocBaseline.current = 0
      viewNotifyTs.current     = 0
      syncBusyAt.current       = 0
      syncDepth.current        = 0
      useSyncStore.getState().setDirty(false)
      useSyncStore.getState().setRemoteActivity(null)
    }

    // Fresh identity ⇒ fresh anti-clobber state (covers direct userA→userB
    // switches that never pass through the null branch above).
    skipProbeOnce.current    = false
    lastProbeAt.current      = 0
    lastFocusProbeAt.current = 0
    pendingRemote.current      = null
    lastRemoteApplied.current  = 0
    knownAdvisorEditAt.current = 0
    liveToastAt.current        = 0
    liveToastCount.current     = 0
    lastCreditShadowJson.current = ''
    stableCacheSrc.current     = ''
    if (conflictToastId.current != null) {
      toast.dismiss(conflictToastId.current)
      conflictToastId.current = null
    }

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
        // Anti-clobber baseline: the server updatedAt we just loaded IS our
        // last-known truth for the self path.
        selfDocBaseline.current = result?.updatedAt ?? 0
        // The listener's attach event replays this same state — mark it as
        // already consumed so it can never be treated as a foreign change.
        lastRemoteApplied.current = result?.updatedAt ?? 0
        setHydrated(true)
        // Record WHOSE data is now in the stores, so a later sign-in by someone
        // else is recognised as a switch. Set only on success: after a failed
        // load nothing is hydrated, and claiming otherwise would suppress the
        // teardown for the next person.
        hydratedUid.current = user.uid
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
      // ADVISOR IMPERSONATION BRANCHING:
      //  • VIEW mode → HARD-BLOCK. The stores hold the CLIENT's data; persisting
      //    it to the advisor's own account would corrupt it. Warn once, return.
      //  • EDIT mode → PROCEED, but every sink below (backup, save, version) is
      //    redirected to the CLIENT's uid via saveTarget() — never the advisor's.
      //  • no impersonation → normal self-save (unchanged).
      const imp = useImpersonationStore.getState()
      if (imp.client && imp.mode !== 'edit') {
        // Warn once per session — but only for changes made AFTER entry
        // settled (the entry's own reset+applySnapshot fire this too).
        if (!viewEditWarned.current && Date.now() - imp.startedAt > 2000) {
          viewEditWarned.current = true
          toast.warning('👁️ אתה במצב צפייה בלבד. שינויים שתעשה כאן לא נשמרים.', { duration: 6000 })
        }
        // No write will follow in view mode, so a pending "save anyway" consent
        // would stay latched forever and silently mute the live listener.
        skipProbeOnce.current = false
        return
      }

      // Flip isDirty (only if not already dirty — avoids re-renders on every keystroke).
      if (!useSyncStore.getState().isDirty) useSyncStore.getState().setDirty(true)

      // ── Local safety-net backup (500ms debounce, sync write, no network).
      // This is the "always latest" copy. Even if Firestore fails, the tab
      // crashes, or the beacon is blocked, next login can restore from here.
      if (backupTimer.current) clearTimeout(backupTimer.current)
      backupTimer.current = setTimeout(() => {
        // Resolve the target at FIRE time. In edit mode the backup is keyed to
        // the CLIENT's uid; a view-mode timer that armed just before entry must
        // still never mirror the client's data (target.editMode === false).
        const target = saveTarget()
        if (target.imp.client && !target.editMode) return
        if (!target.uid) return
        const snap = collectSnapshot()
        const json = JSON.stringify(snap)
        if (json === lastBackupJson.current) return
        writeLocalBackup(target.uid, snap)
        lastBackupJson.current = json
      }, BACKUP_DEBOUNCE_MS)

      // ── Firestore debounced save (unchanged from before) ──
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        // Consume a one-time "שמור בכל זאת" consent at FIRE time — an aborted
        // save burns it rather than leaking it to a later, different conflict.
        const skipProbe = skipProbeOnce.current
        skipProbeOnce.current = false

        // ── ADVISOR EDIT-MODE WRITE PATH ──────────────────────────────────
        // Resolve the target at FIRE time. In edit mode we REDIRECT the write
        // to the CLIENT's doc (authorized by the Firestore write rule: active
        // link + access=='write'). The advisor's own account is never touched.
        const target = saveTarget()
        if (target.editMode) {
          if (!target.uid) return
          const clientUid  = target.uid
          const advisorUid = useAuthStore.getState().user?.uid
          if (!advisorUid) return   // advisor logged out mid-debounce → abort

          const snap = collectSnapshot()
          const json = JSON.stringify(snap)
          if (json === lastSavedJson.current) {
            if (useSyncStore.getState().isDirty) useSyncStore.getState().setDirty(false)
            return
          }
          const size = snapshotSize(snap)
          if (size > MAX_BYTES) {
            setStatus('error', `נתונים גדולים מדי לשמירה (${Math.round(size / 1024)}KB)`)
            return
          }
          if (!navigator.onLine) { setStatus('offline'); return }

          // Anti-clobber: BLOCK (not just warn) when the client saved since our
          // baseline — the user chooses between loading their version and
          // overwriting. Runs BEFORE setStatus('saving') so nothing gets stuck.
          const verdict = await probeBeforeWrite({
            targetUid: clientUid,
            baseline: clientDocBaseline,
            message: ADVISOR_CONFLICT_MSG,
            skipOnce: skipProbe,
            revalidate: () => {
              const t = saveTarget()
              return t.editMode && t.uid === clientUid && !!useAuthStore.getState().user
            },
          })
          if (verdict === 'blocked') return

          setStatus('saving')
          beginSync()
          try {
            await saveClientDataAsAdvisor(clientUid, snap, advisorUid)
            // Same reason as the self path below: these refs are shared session
            // state, and restamping them after an identity switch corrupts the
            // new person's baselines.
            const t = saveTarget()
            if (!t.editMode || t.uid !== clientUid) return
            lastSavedJson.current      = json
            clientDocBaseline.current  = Date.now()
            lastProbeAt.current        = Date.now()
            shadowWriteCredit(clientUid)
            // Our write supersedes anything the listener was holding: replaying
            // an older event now would revert what we just persisted, and the
            // next save would push that revert to the server.
            pendingRemote.current = null
            markSaved()
            const nowJson = JSON.stringify(collectSnapshot())
            if (nowJson === json) useSyncStore.getState().setDirty(false)

            // Version snapshot in the CLIENT's OWN history (client can rewind
            // an advisor edit). Throttled + silent-failure like the self-path.
            const now = Date.now()
            if (now - lastVersionAt.current > VERSION_INTERVAL_MS) {
              lastVersionAt.current = now
              createVersion(clientUid, snap, size).catch(err => {
                console.warn('[DataSync] client version creation failed:', err)
              })
            }
          } catch (err) {
            setStatus('error', (err as Error)?.message ?? 'שגיאת שמירה')
          } finally {
            endSync()
          }
          return
        }

        // ── NORMAL SELF-SAVE PATH ─────────────────────────────────────────
        // Belt-and-suspenders: even if the cleanup race somehow leaves a stale
        // timer armed, re-verify the current authed UID matches the one this
        // closure captured. If the user logged out (or switched accounts)
        // during the debounce window, abort — never write to a stale UID.
        const currentUid = useAuthStore.getState().user?.uid
        if (currentUid !== user.uid) return

        // Guard at FIRE time too (see backup timer above) — never write the
        // VIEW-mode impersonated client's data anywhere.
        if (useImpersonationStore.getState().client) return

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

        // Anti-clobber: block the write when a newer version exists in the
        // cloud (another device). Runs BEFORE setStatus('saving').
        const verdict = await probeBeforeWrite({
          targetUid: user.uid,
          baseline: selfDocBaseline,
          message: SELF_CONFLICT_MSG,
          skipOnce: skipProbe,
          revalidate: () =>
            useAuthStore.getState().user?.uid === user.uid
            && !useImpersonationStore.getState().client,
        })
        if (verdict === 'blocked') return

        setStatus('saving')
        beginSync()
        try {
          await saveUserData(user.uid, snap)
          // The write targeted the right document, but these refs are SHARED
          // session state. If someone else signed in while it was in flight,
          // the identity teardown has already zeroed them — restamping now
          // would hand the new person our JSON as their "last saved" baseline,
          // producing a spurious conflict prompt and a 10s probe blackout on
          // their first seconds.
          if (useAuthStore.getState().user?.uid !== user.uid) return
          lastSavedJson.current = json
          selfDocBaseline.current = Date.now()
          lastProbeAt.current     = Date.now()
          pendingRemote.current   = null   // see the advisor path above
          shadowWriteCredit(user.uid)
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
        } finally {
          endSync()
        }
      }, DEBOUNCE_MS)
    }

    // Expose the trigger so a "שמור בכל זאת" can re-arm the normal debounce.
    requestSaveRef.current = triggerSave
    // Out-of-band snapshot writers (transaction-inbox drain) report their save
    // here so the probe doesn't read it back as a foreign conflict.
    registerSaveBaselineBump((writtenJson: string) => {
      lastSavedJson.current   = writtenJson
      lastBackupJson.current  = writtenJson
      selfDocBaseline.current = Date.now()
      lastProbeAt.current     = Date.now()
      stableCacheSrc.current  = ''     // canonical cache must rebuild
      pendingRemote.current   = null   // this write supersedes any held event
      // The drain wrote the WHOLE snapshot (credit included) straight to the
      // main doc — mirror the shadow too, or the verify script reads permanent
      // false drift and the phase-B gate becomes meaningless.
      shadowWriteCredit(user.uid)
    })

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
      useBusinessRosterStore.subscribe(triggerSave),
      useSubscriptionPrefsStore.subscribe(triggerSave),
      useBudgetReminderStore.subscribe(triggerSave),
    ]

    return () => {
      unsubs.forEach(unsub => unsub())
      if (saveTimer.current)   clearTimeout(saveTimer.current)
      if (backupTimer.current) clearTimeout(backupTimer.current)
      requestSaveRef.current = () => {}
      registerSaveBaselineBump(null)
    }
  }, [user, hydrated, setStatus, markSaved])

  // ── 2b. Advisor edit-mode baseline seed ──
  // Entering edit mode, editFullAccount() runs resetAllStores()+applySnapshot(client)
  // then start(client,'edit',updatedAt) — all synchronously. Those store writes
  // fire triggerSave, which in edit mode arms a save timer targeting the CLIENT
  // doc. Left alone, that first (entry) save would push the client's own data
  // back and mint a spurious version. This subscribe fires on start() — AFTER
  // the snapshot is applied — and seeds lastSaved/lastBackup to the just-applied
  // state, so the pending entry save (2s debounce) sees no diff and no-ops. It
  // also seeds the concurrent-edit baseline from the client doc's entry updatedAt.
  useEffect(() => {
    const unsub = useImpersonationStore.subscribe((state, prev) => {
      const enteringEdit = !!state.client && state.mode === 'edit'
        && (state.startedAt !== prev.startedAt || prev.mode !== 'edit' || !prev.client)
      if (!enteringEdit) return
      const json = JSON.stringify(collectSnapshot())
      lastSavedJson.current     = json
      lastBackupJson.current    = json
      clientDocBaseline.current = state.clientUpdatedAt || 0
      lastVersionAt.current     = 0        // allow the first real edit to version
      viewEditWarned.current    = false
      // Live-sync state is per-document: switching to the client's doc must not
      // inherit the advisor's own high-water marks or a held event.
      pendingRemote.current      = null
      lastRemoteApplied.current  = state.clientUpdatedAt || 0
      knownAdvisorEditAt.current = 0
      liveToastAt.current        = 0
      liveToastCount.current     = 0
      lastCreditShadowJson.current = ''
      stableCacheSrc.current     = ''
      // A pending self-conflict prompt must never act on CLIENT data, and the
      // advisor's FIRST client save must not ride a recent self-probe's throttle:
      skipProbeOnce.current     = false
      lastProbeAt.current       = 0
      if (conflictToastId.current != null) {
        toast.dismiss(conflictToastId.current)
        conflictToastId.current = null
      }
    })
    return () => unsub()
  }, [])

  // ── 2c. Live listener on the active document ──
  // Streams the other side's saves (advisor↔client, or a second device) into
  // this session within a couple of seconds. Design notes:
  //  • Echo detection is by CONTENT, never by timestamp: in the scenario this
  //    exists for, both sides save every few seconds, so any time window would
  //    classify real changes as our own echo and silently clobber them.
  //  • Local unsaved edits are never replaced — the shared conflict prompt
  //    offers the choice (same one the pre-write probe uses).
  //  • Advisor VIEW mode is notify-only: it never touches the shown data.
  const impUid  = useImpersonationStore(s => s.client?.uid)
  const impMode = useImpersonationStore(s => s.mode)

  useEffect(() => {
    // The stream exists only while the user is actually here: an idle tab
    // falls back to a once-a-minute poll, an away tab holds no connection at
    // all (effect 2c½ forces a refresh on the way back in). Cleanup runs on
    // every mode change, so leaving 'live' detaches immediately.
    if (!user || !hydrated || liveMode !== 'live') return
    const targetUid = impUid ?? user.uid
    const listenerMode: 'self' | 'edit' | 'view' =
      impUid ? (impMode === 'edit' ? 'edit' : 'view') : 'self'
    if (listenerMode === 'view') {
      viewNotifyTs.current = useImpersonationStore.getState().clientUpdatedAt || 0
      // The high-water mark belongs to the previous document (the advisor's
      // own), and this one is only read for notifications.
      lastRemoteApplied.current  = 0
      knownAdvisorEditAt.current = 0
      pendingRemote.current      = null
    }

    // Canonical form of our last write, rebuilt only when it changes.
    const canonLastSaved = (): string | null => {
      // '' means "a restore is pending a forced push" — nothing to compare to.
      if (!lastSavedJson.current) return null
      if (stableCacheSrc.current !== lastSavedJson.current) {
        try { stableCacheOut.current = stableStringify(JSON.parse(lastSavedJson.current)) }
        catch { return null }
        stableCacheSrc.current = lastSavedJson.current
      }
      return stableCacheOut.current
    }

    // Re-checked at EVENT time: the user may have logged out or switched
    // modes while an event sat in the debounce.
    const stillValid = () => {
      const now = useImpersonationStore.getState()
      const nowMode: 'self' | 'edit' | 'view' =
        now.client ? (now.mode === 'edit' ? 'edit' : 'view') : 'self'
      return useAuthStore.getState().user?.uid === user.uid
        && nowMode === listenerMode
        && (now.client?.uid ?? user.uid) === targetUid
    }

    // Hold an event without dropping it, but never forever: a stalled network
    // call or an input that keeps focus must not spin a timer for the session.
    const holdOrDrop = (ev: NonNullable<typeof pendingRemote.current>, delay: number) => {
      if (Date.now() - ev.heldSince > LIVE_HOLD_MAX_MS) {
        // Give up on this specific event. Correctness still holds: the focus
        // refetch and the pre-write probe cover anything we skipped.
        pendingRemote.current = null
        return
      }
      pendingRemote.current = ev
      scheduleLiveEval(delay)
    }

    const evaluate = () => {
      const ev = pendingRemote.current
      if (!ev) return
      if (!useSyncStore.getState().hydrated || !stillValid()) { pendingRemote.current = null; return }

      // ── Cheap gates first: everything below this block costs full-document
      // serializations, and a held event re-runs them on every retry. ──

      // Don't yank the ground out from under an open editor, and don't mutate
      // a hidden tab (the focus refetch announces properly on return).
      const active = document.activeElement as HTMLElement | null
      const editing = !!active && (
        active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'
        || active.tagName === 'SELECT' || active.isContentEditable
      )
      if (listenerMode !== 'view' && (document.visibilityState !== 'visible' || editing)) {
        holdOrDrop(ev, 1500); return
      }
      // A write (or an async apply) is in flight — hold, never drop.
      if (syncBusy()) { holdOrDrop(ev, LIVE_HOLD_RETRY_MS); return }
      // A restore is waiting to be pushed: its own save resolves this.
      if (!lastSavedJson.current) { holdOrDrop(ev, LIVE_HOLD_RETRY_MS); return }
      // Consent to overwrite was just given; the imminent write settles it.
      if (skipProbeOnce.current) { pendingRemote.current = null; return }
      // Stale event (older than what we already consumed) must never be applied.
      if (ev.updatedAt > 0 && ev.updatedAt <= lastRemoteApplied.current) { pendingRemote.current = null; return }

      pendingRemote.current = null
      const byAdvisor = ev.byAdvisor

      // VIEW mode: chip only. Never applies, never writes, never re-seeds.
      if (listenerMode === 'view') {
        if (ev.updatedAt > viewNotifyTs.current) {
          viewNotifyTs.current = ev.updatedAt
          useSyncStore.getState().setRemoteActivity({ at: ev.updatedAt, seenAt: Date.now(), byAdvisor })
        }
        return
      }

      const baseline = listenerMode === 'edit' ? clientDocBaseline : selfDocBaseline

      // OUR OWN write coming back (online save, tab-close beacon, inbox drain,
      // or the attach event): absorb it and heal the baseline toward server truth.
      // Cheap exact compare first — Firestore usually preserves key order, so
      // this hits most echoes without the canonical (sort-everything) pass.
      const isEcho = JSON.stringify(ev.data) === lastSavedJson.current
        || (() => {
          const canon = canonLastSaved()
          return canon !== null && stableStringify(ev.data) === canon
        })()
      if (isEcho) {
        baseline.current = Math.max(baseline.current, ev.updatedAt)
        lastRemoteApplied.current = Math.max(lastRemoteApplied.current, ev.updatedAt)
        return
      }

      // A real change by someone else.
      useSyncStore.getState().setRemoteActivity({ at: ev.updatedAt, seenAt: Date.now(), byAdvisor })
      if (conflictToastId.current != null) return   // an unresolved prompt gates everything

      // Dirty test is content-based AND flag-based: after a tab-close beacon
      // lastSavedJson holds an optimistically-marked snapshot that may never
      // have reached the server, so content alone would call us "clean" and
      // throw those edits away.
      const dirtyNow = useSyncStore.getState().isDirty
        || JSON.stringify(collectSnapshot()) !== lastSavedJson.current
      if (dirtyNow) {
        openConflictChoice({
          targetUid,
          baseline,
          message: listenerMode === 'edit' ? ADVISOR_CONFLICT_MSG : SELF_CONFLICT_MSG,
          revalidate: stillValid,
        })
        return
      }

      // Clean by definition here (the dirty test above passed), so the
      // pre-apply state IS lastSavedJson — no extra serialization needed.
      const preJson = lastSavedJson.current
      const json = applyRemote(ev.data, ev.updatedAt, baseline)
      const announce = liveToastCount.current < LIVE_TOAST_BURST
        || Date.now() - liveToastAt.current > LIVE_TOAST_MIN_GAP_MS
      if (json !== null && json !== preJson && announce) {
        liveToastAt.current = Date.now()
        liveToastCount.current += 1
        toast.info(
          listenerMode === 'edit' ? 'הנתונים עודכנו מהחשבון של הלקוח.'
            : byAdvisor ? 'היועץ עדכן את הנתונים.' : 'הנתונים עודכנו ממכשיר אחר.',
          { id: 'remote-applied', duration: 4000 },
        )
      }
    }
    liveEvalRef.current = evaluate

    const unsub = onSnapshot(fsDoc(db, 'users', targetUid),
      snap => {
        if (snap.metadata.hasPendingWrites) return   // our own not-yet-acked write
        if (snap.metadata.fromCache) return          // cache replay; server truth follows
        const raw = snap.exists() ? (snap.data() as Record<string, unknown>) : null
        if (!raw?.data) return                       // fresh account, nothing saved yet
        const lastAdvisorEditAt = tsToMillis(raw.lastAdvisorEditAt)
        // Attribution is decided HERE, once per event, and the high-water mark
        // advances even for events we later drop: the advisor markers live on
        // the document forever, so a mark that is never seeded would make the
        // first foreign write of the session look like an advisor edit. Doing
        // it at ingestion also keeps a held event's attribution stable.
        const byAdvisor = deriveByAdvisor({
          lastAdvisorEditAt,
          lastAdvisorEditByUid: typeof raw.lastAdvisorEditByUid === 'string' ? raw.lastAdvisorEditByUid : '',
          knownAdvisorEditAt: knownAdvisorEditAt.current,
          myUid: useAuthStore.getState().user?.uid ?? '',
        })
        knownAdvisorEditAt.current = Math.max(knownAdvisorEditAt.current, lastAdvisorEditAt)
        pendingRemote.current = {
          data: raw.data,
          updatedAt: tsToMillis(raw.updatedAt),
          byAdvisor,
          heldSince: Date.now(),
        }
        scheduleLiveEval(LIVE_APPLY_DEBOUNCE_MS)
      },
      () => {
        liveDead.current = true
        // Terminal for this listener (a revoked link must not retry-loop).
        // Correctness still holds: the focus refetch and the pre-write probe
        // are untouched. Only impersonation gets a notice — the advisor is the
        // one who can act on it.
        if (useImpersonationStore.getState().client) {
          toast.info('העדכון החי מהחשבון של הלקוח הופסק. צא וחזור ללקוח כדי לחדש אותו.', {
            id: 'live-dead',
            duration: 10000,
            closeButton: true,
            action: {
              label: 'חזרה לחשבון שלי',
              // Same exit boundary as the banner's — clear the persisted lab so
              // the client's context does not rehydrate under the advisor.
              onClick: () => { resetSessionStores(); window.location.assign('/app/advisor') },
            },
          })
        }
      })

    // VIEW mode only: the banner's "load the latest version" button.
    registerLiveRefresh(listenerMode !== 'view' ? null : () => {
      const imp = useImpersonationStore.getState()
      if (!imp.client || imp.mode !== 'view' || imp.client.uid !== targetUid) return
      beginSync()
      loadUserData(targetUid).then(fresh => {
        const now = useImpersonationStore.getState()
        if (!fresh?.data || now.client?.uid !== targetUid || now.mode !== 'view') return
        // start() FIRST: it resets startedAt, which is what suppresses the
        // "view only, nothing is saved" warning that the store writes below
        // (and the 500ms mapping mirror) would otherwise pop right after the
        // advisor clicked refresh. Same ordering rule as entering view mode.
        useImpersonationStore.getState().start(now.client, 'view', fresh.updatedAt)
        viewEditWarned.current = false
        try {
          resetAllStores()
          applySnapshot(fresh.data)
        } catch (err) {
          console.error('[DataSync] view refresh failed:', err)
          toast.error('הטעינה נכשלה, נסה שוב.')
          return
        }
        viewNotifyTs.current = fresh.updatedAt
        useSyncStore.getState().setRemoteActivity(null)
        toast.success('הגרסה החדשה נטענה.', { id: 'live-refreshed' })
      }).catch(() => toast.error('הטעינה נכשלה, נסה שוב.'))
        .finally(() => endSync())
    })

    return () => {
      unsub()
      registerLiveRefresh(null)
      if (liveEvalTimer.current) clearTimeout(liveEvalTimer.current)
      pendingRemote.current = null
      liveEvalRef.current = () => {}
      useSyncStore.getState().setRemoteActivity(null)
    }
  }, [user, hydrated, impUid, impMode, liveRetry, liveMode])

  // ── 2c½. Connection economics: the stream follows the USER, not the tab ──
  // Cheap passive listeners (refs only, zero re-renders); a slow tick decides
  // the mode. Transitions INTO 'live' force one refresh first, so a user
  // returning from 'away' never acts on stale numbers.
  useEffect(() => {
    if (!user || !hydrated) return
    const touch = () => { lastActivityAt.current = Date.now() }
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']
    for (const e of events) window.addEventListener(e, touch, { passive: true })

    const tick = () => {
      const idleFor = Date.now() - lastActivityAt.current
      const hidden = document.visibilityState !== 'visible'
      const next: 'live' | 'idle' | 'away' =
        hidden || idleFor > LIVE_AWAY_AFTER_MS ? 'away'
          : idleFor > LIVE_ACTIVE_WINDOW_MS ? 'idle'
            : 'live'
      setLiveMode(prev => {
        if (prev === next) return prev
        // Coming back from a disconnected state: refresh BEFORE the stream
        // re-attaches, so the first thing the user sees is current.
        if (next === 'live' && prev === 'away') void refetchOnFocus()
        return next
      })
    }
    const interval = setInterval(tick, LIVE_MODE_TICK_MS)
    // React to visibility promptly (the tick alone could lag half a minute).
    document.addEventListener('visibilitychange', tick)
    tick()
    return () => {
      for (const e of events) window.removeEventListener(e, touch)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, hydrated])

  // Idle: one light freshness check per minute instead of a billed read per
  // remote change. refetchOnFocus already carries every safety guard (dirty
  // check, conflict prompt, echo suppression), so it is reused as-is; its own
  // 30s floor is shorter than the poll period, so polls are never swallowed.
  useEffect(() => {
    if (!user || !hydrated || liveMode !== 'idle') return
    const id = setInterval(() => { void refetchOnFocus() }, LIVE_IDLE_POLL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, hydrated, liveMode])

  // ── 2d. Revive a listener that died on a transient error ──
  // Only re-attaches when it actually died, and only on a signal that the
  // connection is likely back — never a retry loop against a revoked link.
  useEffect(() => {
    const revive = () => {
      if (!liveDead.current) return
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      liveDead.current = false
      setLiveRetry(n => n + 1)
    }
    document.addEventListener('visibilitychange', revive)
    window.addEventListener('online', revive)
    window.addEventListener('focus', revive)
    return () => {
      document.removeEventListener('visibilitychange', revive)
      window.removeEventListener('online', revive)
      window.removeEventListener('focus', revive)
    }
  }, [])

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
      const imp = useImpersonationStore.getState()
      if (imp.client) {
        // EDIT mode: mirror the client's in-progress edits to THEIR localStorage
        // key (safe, device-local) but NEVER sendBeacon — /api/save-snapshot
        // derives the uid from the advisor's token, so a POST would write the
        // client's data into the advisor's account. Local backup + the next
        // debounced save (also client-targeted) cover the close.
        // VIEW mode: don't touch anything.
        if (imp.mode === 'edit' && imp.client.uid) {
          const snap = collectSnapshot()
          const json = JSON.stringify(snap)
          if (json !== lastBackupJson.current) {
            writeLocalBackup(imp.client.uid, snap)
            lastBackupJson.current = json
          }
        }
        return
      }
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
        // baseline lets the server refuse a STALE flush (409) instead of
        // clobbering a newer version another device saved meanwhile.
        const payload = JSON.stringify({ token, snapshot: snap, baseline: selfDocBaseline.current })
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
        // The baseline is deliberately NOT advanced: a failed/409 beacon with
        // an advanced baseline would mask the other device's newer data. Our
        // own successful beacon merely shows up as a harmless self-echo on the
        // next focus refetch (applied silently, no toast).
        lastSavedJson.current = json
      } catch { /* worst case, the debounced save on next re-open still fires */ }
    }

    function onPageHide() { flushIfDirty() }
    function onVisibility() {
      if (document.visibilityState === 'hidden') flushIfDirty()
      else if (document.visibilityState === 'visible') void refetchOnFocus()
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
