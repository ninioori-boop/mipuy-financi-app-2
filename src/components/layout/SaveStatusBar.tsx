'use client'

import { useEffect, useState } from 'react'
import { useSyncStore } from '@/stores/syncStore'
import { useAuthStore } from '@/stores/authStore'

function timeAgo(ms: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (sec < 5)    return 'הרגע'
  if (sec < 60)   return `לפני ${sec} שנ׳`
  if (sec < 3600) return `לפני ${Math.floor(sec / 60)} דק׳`
  return new Date(ms).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
}

export function SaveStatusBar() {
  const status        = useSyncStore(s => s.status)
  const lastSavedAt   = useSyncStore(s => s.lastSavedAt)
  const errorMessage  = useSyncStore(s => s.errorMessage)
  const isDirty       = useSyncStore(s => s.isDirty)
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
      <span className="inline-flex items-center gap-2 text-sm text-muted-txt px-2.5 py-1 rounded-full border border-yellow-400/30 bg-yellow-400/5">
        <span className="size-2.5 rounded-full bg-yellow-400/80" />
        מצב מקומי — נתונים לא נשמרים
      </span>
    )
  }

  let dotColor   = 'bg-muted-txt/50'
  let pillBg     = ''                           // empty = no pill background (idle/ready)
  let pillBorder = 'border-transparent'
  let textColor  = 'text-muted-txt'
  let label      = 'מוכן'

  if (status === 'loading') {
    dotColor   = 'bg-blue-400 animate-pulse'
    pillBg     = 'bg-blue-400/10'
    pillBorder = 'border-blue-400/30'
    textColor  = 'text-blue-300'
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
    dotColor   = 'bg-yellow-400'
    pillBg     = 'bg-yellow-400/10'
    pillBorder = 'border-yellow-400/30'
    textColor  = 'text-yellow-300'
    label      = 'מצב לא מקוון — שמירה מושהית'
  } else if (isDirty) {
    // Explicit "there are changes waiting to be saved" signal. Kept between
    // the last keystroke and the debounced save landing (up to 2s), and
    // also shown when the user typed more while a save was in flight.
    dotColor   = 'bg-orange-400 animate-pulse'
    pillBg     = 'bg-orange-400/10'
    pillBorder = 'border-orange-400/30'
    textColor  = 'text-orange-300'
    label      = 'שינויים לא-שמורים…'
  } else if (status === 'saved') {
    dotColor   = 'bg-green-400'
    pillBg     = 'bg-green-400/10'
    pillBorder = 'border-green-400/30'
    textColor  = 'text-green-400'
    label      = lastSavedAt ? `נשמר ${timeAgo(lastSavedAt)}` : 'נשמר'
  } else if (lastSavedAt) {
    dotColor   = 'bg-green-400/70'
    pillBg     = 'bg-green-400/5'
    pillBorder = 'border-green-400/20'
    textColor  = 'text-green-400/80'
    label      = `נשמר ${timeAgo(lastSavedAt)}`
  }

  return (
    <span
      className={`inline-flex items-center gap-2 text-sm font-medium px-2.5 py-1 rounded-full border ${pillBorder} ${pillBg} ${textColor}`}
      title={status === 'error' && errorMessage ? errorMessage : undefined}
    >
      <span className={`size-2.5 rounded-full ${dotColor}`} />
      {label}
    </span>
  )
}
