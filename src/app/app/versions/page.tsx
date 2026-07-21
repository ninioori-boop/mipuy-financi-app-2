'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { useImpersonationStore } from '@/stores/impersonationStore'
import {
  listVersions, getVersion, createVersion,
  type VersionSummary,
} from '@/lib/firestoreService'
import { applySnapshot, collectSnapshot, snapshotSize } from '@/lib/dataSync'

// "Time machine" for the whole app state. Lists the most recent Firestore
// snapshots (up to MAX_VERSIONS = 20, one every ~5 minutes of active work)
// and lets the advisor restore any of them. Before restoring, the CURRENT
// live state is written as a fresh version — so an accidental restore can
// itself be rewound.

function fmtDate(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtSize(bytes: number): string {
  if (!bytes) return '—'
  const kb = bytes / 1024
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`
}

function fmtRelative(ts: number): string {
  if (!ts) return ''
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 60)    return 'לפני פחות מדקה'
  if (sec < 3600)  return `לפני ${Math.floor(sec / 60)} דק׳`
  if (sec < 86400) return `לפני ${Math.floor(sec / 3600)} שע׳`
  return `לפני ${Math.floor(sec / 86400)} ימים`
}

export default function VersionsPage() {
  const user = useAuthStore(s => s.user)
  const [versions, setVersions] = useState<VersionSummary[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)   // id of the version currently being restored
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!user) return
    setError(null)
    try {
      const list = await listVersions(user.uid)
      setVersions(list)
    } catch (e) {
      setError((e as Error)?.message ?? 'שגיאה בטעינת גרסאות')
    }
  }, [user])

  useEffect(() => { reload() }, [reload])

  async function handleRestore(v: VersionSummary) {
    if (!user) return
    // Impersonation guard: "restore" is the one MANUAL save path outside the
    // DataSync auto-save guards. While an advisor is viewing a client, the
    // stores hold the client's data — restoring would write it into the
    // advisor's OWN version history. Block it. (Same class as the auto-save
    // guards in DataSync.tsx.)
    if (useImpersonationStore.getState().client) {
      toast.warning('👁️ אתה במצב צפייה בלבד — שחזור גרסה מושבת כאן.')
      return
    }
    const confirmed = window.confirm(
      `לשחזר את כל הנתונים לגרסה מ-${fmtDate(v.savedAt)}?\n\nהמצב הנוכחי יישמר כגרסה חדשה (אפשר לחזור אליה) לפני השחזור.`
    )
    if (!confirmed) return

    setBusy(v.id)
    try {
      // Snapshot the CURRENT state as a fresh version BEFORE we overwrite it —
      // this is the undo path if the restore turns out to be a mistake.
      const currentSnap = collectSnapshot()
      const size = snapshotSize(currentSnap)
      await createVersion(user.uid, currentSnap, size)

      // Now fetch and apply the chosen version.
      const restored = await getVersion(user.uid, v.id)
      if (!restored) throw new Error('הגרסה לא נמצאה')
      applySnapshot(restored)

      toast.success(`✅ שוחזר לגרסה מ-${fmtDate(v.savedAt)}`, { duration: 6000 })
      // Refresh the list so the "current state" version we just saved appears at the top.
      await reload()
    } catch (e) {
      toast.error(`שגיאה בשחזור: ${(e as Error)?.message ?? 'לא ידוע'}`, { duration: 10000 })
    } finally {
      setBusy(null)
    }
  }

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto p-6 text-center text-muted-txt">
        יש להתחבר כדי לצפות בהיסטוריית הגרסאות.
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-6">
        <h1 className="text-2xl font-bold text-gold mb-1">🕰️ היסטוריית שינויים</h1>
        <p className="text-muted-txt text-sm">
          עד 20 גרסאות אחרונות של כל הנתונים. גרסה חדשה נשמרת אוטומטית כל 5 דקות של עבודה.
          לחיצה על "שחזר" תחזיר את כל הנתונים לגרסה הזו — המצב הנוכחי יישמר כגרסה חדשה לפני כן.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-expense/40 bg-expense/10 p-4 text-sm text-expense">
          {error}
        </div>
      )}

      {versions === null && !error && (
        <div className="rounded-xl border border-line bg-surface2 p-8 text-center text-muted-txt">
          <div className="inline-block size-6 rounded-full border-2 border-gold border-t-transparent animate-spin mb-2" />
          <div>טוען גרסאות...</div>
        </div>
      )}

      {versions !== null && versions.length === 0 && (
        <div className="rounded-xl border border-line bg-surface2 p-8 text-center text-muted-txt">
          <div className="text-4xl mb-2">📭</div>
          <div>אין עדיין גרסאות שמורות.</div>
          <div className="text-xs mt-2">אחרי כמה דקות של עבודה, הגרסה הראשונה תישמר אוטומטית.</div>
        </div>
      )}

      {versions !== null && versions.length > 0 && (
        <div className="rounded-xl border border-line bg-surface2 overflow-hidden">
          <div className="divide-y divide-line">
            {versions.map((v, i) => {
              const isLatest  = i === 0
              const restoring = busy === v.id
              return (
                <div key={v.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface3/40 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-txt">{fmtDate(v.savedAt)}</span>
                      {isLatest && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-gold/40 bg-gold/10 text-gold">
                          העדכנית
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-txt mt-0.5">
                      {fmtRelative(v.savedAt)} · {fmtSize(v.size)}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRestore(v)}
                    disabled={busy !== null}
                    className="text-sm px-4 py-2 rounded-lg border border-gold/40 bg-gold/10 text-gold hover:bg-gold/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {restoring ? 'משחזר...' : 'שחזר'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="text-xs text-muted-txt text-center px-4">
        גרסאות נשמרות ב-Firestore באותה רמת הגנה כמו שאר הנתונים שלך (invite-only, בעלים בלבד).
      </div>

    </div>
  )
}
