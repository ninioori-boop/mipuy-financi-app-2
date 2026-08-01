'use client'

import { useEffect, useState } from 'react'
import { useSyncStore } from '@/stores/syncStore'
import { useAuthStore } from '@/stores/authStore'
import { useImpersonationStore } from '@/stores/impersonationStore'
import { timeAgo, timeAgoCoarse } from '@/lib/timeAgo'

// How long a "someone else just saved" signal stays visible. Exported so the
// impersonation banner's chip expires on the same schedule.
export const PRESENCE_SHOW_MS = 5 * 60_000
// Right after a live apply the mapping mirror re-derives monthly rows, which
// flips isDirty for ~2s. Presence outranks it briefly so the pill doesn't
// strobe between "עודכן" and "שינויים לא-שמורים" on every foreign save.
const PRESENCE_PRIORITY_MS = 4_000
// Both sides of every comparison below are LOCAL clock values (lastSavedAt and
// remoteActivity.seenAt). Comparing a local clock against the doc's SERVER
// timestamp would hide the signal completely on a device whose clock runs fast.

export function SaveStatusBar() {
  const status        = useSyncStore(s => s.status)
  const painted       = useSyncStore(s => s.painted)
  const lastSavedAt   = useSyncStore(s => s.lastSavedAt)
  const errorMessage  = useSyncStore(s => s.errorMessage)
  const isDirty       = useSyncStore(s => s.isDirty)
  const remoteActivity = useSyncStore(s => s.remoteActivity)
  // During impersonation the banner owns this signal (with the right wording
  // for who acted), so the header must not contradict it.
  const impersonating = useImpersonationStore(s => !!s.client)
  const user          = useAuthStore(s => s.user)
  const authLoading   = useAuthStore(s => s.loading)

  // tick every 15s so the "last saved … ago" label refreshes
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 15_000)
    return () => clearInterval(id)
  }, [])

  if (authLoading) return null

  if (!user) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-muted-txt px-2.5 py-1 rounded-full border border-warn/30 bg-warn/5">
        <span className="size-2.5 rounded-full bg-warn/80" />
        מצב מקומי, נתונים לא נשמרים
      </span>
    )
  }

  let dotColor   = 'bg-muted-txt/50'
  let pillBg     = ''                           // empty = no pill background (idle/ready)
  let pillBorder = 'border-transparent'
  let textColor  = 'text-muted-txt'
  let label      = 'מוכן'
  // Relative time is split out of the label: it changes on every tick, and a
  // live region that re-announces "לפני 3 דק׳ → 4 דק׳" every 15 seconds makes
  // the app unusable with a screen reader. Rendered aria-hidden.
  let timePart   = ''

  // "Someone else saved" — shown while it is recent AND newer than our own
  // last save. Suppressed during impersonation (the banner says it better).
  const showPresence = !impersonating
    && !!remoteActivity
    && Date.now() - remoteActivity.seenAt < PRESENCE_SHOW_MS
    && remoteActivity.seenAt > (lastSavedAt ?? 0)
  const presenceLabel = remoteActivity?.byAdvisor ? 'היועץ עדכן נתונים' : 'עודכן ממכשיר אחר'
  const presenceTime  = remoteActivity ? timeAgoCoarse(remoteActivity.seenAt) : ''

  if (status === 'loading' && painted) {
    // Cache-first paint: real numbers are on screen, but they came from this
    // device's backup and NO save path is armed until the server copy lands.
    // A grey "loading" pill would read as "almost done" — anything typed in
    // this window is discarded when the server copy replaces the cache, so the
    // pill has to say so rather than imply the app is ready.
    dotColor   = 'bg-warn animate-pulse'
    pillBg     = 'bg-warn/15'
    pillBorder = 'border-warn/40'
    textColor  = 'text-warn'
    label      = 'מסתנכרן… שינויים לא יישמרו עד שיסתיים'
  } else if (status === 'loading') {
    dotColor   = 'bg-muted-txt animate-pulse'
    pillBg     = 'bg-surface3'
    pillBorder = 'border-line'
    textColor  = 'text-muted-txt'
    label      = 'טוען נתונים…'
  } else if (status === 'saving') {
    dotColor   = 'bg-gold animate-pulse'
    pillBg     = 'bg-gold/15'
    pillBorder = 'border-gold/40'
    textColor  = 'text-gold'
    label      = 'שומר…'
  } else if (status === 'error') {
    dotColor   = 'bg-expense'
    pillBg     = 'bg-expense/10'
    pillBorder = 'border-expense/40'
    textColor  = 'text-expense'
    label      = errorMessage ?? 'שגיאת שמירה'
  } else if (status === 'offline') {
    dotColor   = 'bg-warn'
    pillBg     = 'bg-warn/10'
    pillBorder = 'border-warn/30'
    textColor  = 'text-warn'
    label      = 'מצב לא מקוון, השמירה מושהית'
  } else if (showPresence && Date.now() - remoteActivity!.seenAt < PRESENCE_PRIORITY_MS) {
    // Fresh foreign write outranks the derived dirt an apply leaves behind.
    dotColor   = 'bg-gold'
    pillBg     = 'bg-gold/10'
    pillBorder = 'border-gold/30'
    textColor  = 'text-gold'
    label      = presenceLabel
    timePart   = presenceTime
  } else if (isDirty) {
    // Explicit "there are changes waiting to be saved" signal. Kept between
    // the last keystroke and the debounced save landing (up to 2s), and
    // also shown when the user typed more while a save was in flight.
    dotColor   = 'bg-warn animate-pulse'
    pillBg     = 'bg-warn/10'
    pillBorder = 'border-warn/30'
    textColor  = 'text-warn'
    label      = 'שינויים לא-שמורים…'
  } else if (showPresence) {
    dotColor   = 'bg-gold'
    pillBg     = 'bg-gold/10'
    pillBorder = 'border-gold/30'
    textColor  = 'text-gold'
    label      = presenceLabel
    timePart   = presenceTime
  } else if (status === 'saved') {
    dotColor   = 'bg-income'
    pillBg     = 'bg-income/10'
    pillBorder = 'border-income/30'
    textColor  = 'text-income'
    label      = 'נשמר'
    timePart   = lastSavedAt ? timeAgo(lastSavedAt) : ''
  } else if (lastSavedAt) {
    dotColor   = 'bg-income/70'
    pillBg     = 'bg-income/5'
    pillBorder = 'border-income/20'
    textColor  = 'text-income/80'
    label      = 'נשמר'
    timePart   = timeAgo(lastSavedAt)
  }

  return (
    <span
      role="status"
      className={`inline-flex items-center gap-2 min-w-0 max-w-[52vw] sm:max-w-none text-sm font-medium px-2.5 py-1 rounded-full border ${pillBorder} ${pillBg} ${textColor}`}
      title={status === 'error' && errorMessage ? errorMessage : undefined}
    >
      <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${dotColor}`} />
      <span className="truncate">
        {label}{timePart && <span aria-hidden>{' '}{timePart}</span>}
      </span>
    </span>
  )
}
