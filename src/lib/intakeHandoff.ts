'use client'

// Transient, in-memory handoff of files from the advisor's intake-review page
// to the auto-map lab. NOT persisted (File objects can't be serialized to
// localStorage anyway) — it survives only the in-app navigation between the two
// pages, then is consumed once and cleared.

let pending: File[] | null = null
let label = ''

export function setHandoffFiles(files: File[], clientLabel = ''): void {
  pending = files.length ? files : null
  label = clientLabel
}

/** Returns the staged files (and clears them) — call once on the lab's mount. */
export function takeHandoffFiles(): { files: File[]; label: string } | null {
  if (!pending) return null
  const out = { files: pending, label }
  pending = null
  label = ''
  return out
}
