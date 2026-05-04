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
      <span className="text-xs text-muted-txt flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-yellow-400/70" />
        מצב מקומי — נתונים לא נשמרים
      </span>
    )
  }

  let dotColor = 'bg-muted-txt/50'
  let label    = 'מוכן'

  if (status === 'loading') {
    dotColor = 'bg-blue-400 animate-pulse'
    label    = 'טוען נתונים…'
  } else if (status === 'saving') {
    dotColor = 'bg-gold animate-pulse'
    label    = 'שומר…'
  } else if (status === 'saved') {
    dotColor = 'bg-green-400'
    label    = lastSavedAt ? `נשמר ${timeAgo(lastSavedAt)}` : 'נשמר'
  } else if (status === 'error') {
    dotColor = 'bg-expense'
    label    = errorMessage ?? 'שגיאת שמירה'
  } else if (status === 'offline') {
    dotColor = 'bg-yellow-400'
    label    = 'מצב לא מקוון — שמירה מושהית'
  } else if (lastSavedAt) {
    dotColor = 'bg-green-400/60'
    label    = `נשמר ${timeAgo(lastSavedAt)}`
  }

  return (
    <span
      className="text-xs text-muted-txt flex items-center gap-1.5"
      title={status === 'error' && errorMessage ? errorMessage : undefined}
    >
      <span className={`size-1.5 rounded-full ${dotColor}`} />
      {label}
    </span>
  )
}
