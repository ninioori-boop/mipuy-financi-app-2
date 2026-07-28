/** Relative Hebrew time label. Shared by the status pill and the live chips. */
export function timeAgo(ms: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (sec < 5)    return 'הרגע'
  if (sec < 60)   return `לפני ${sec} שנ׳`
  if (sec < 3600) return `לפני ${Math.floor(sec / 60)} דק׳`
  // Beyond an hour a clock time reads better, but it needs the preposition or
  // it runs into the preceding word ("היועץ עדכן 14:32").
  return `בשעה ${new Date(ms).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`
}

/** Coarser form for the impersonation banner (its tick is slower). */
export function timeAgoCoarse(ms: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (sec < 60) return 'עכשיו'
  return timeAgo(ms)
}
