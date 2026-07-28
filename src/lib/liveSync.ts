/**
 * Pure helpers for the live listener (see DataSync.tsx effect 2c).
 *
 * Why content comparison and not timestamps: in the scenario live sync exists
 * for (advisor and client both saving every few seconds) EVERY foreign write
 * lands inside any sane timestamp window, so a time-based "is this my own
 * echo?" test classifies real changes as echoes and silently clobbers them.
 * The listener holds the full remote document, so it can compare content.
 */

/**
 * JSON.stringify with object keys sorted at every level (arrays keep order).
 * Firestore does not preserve map key insertion order, so a byte-identical
 * document can stringify differently than collectSnapshot()'s output — plain
 * JSON.stringify would report a false difference and open a conflict prompt on
 * the user's own save.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const parts: string[] = []
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key]
    if (v === undefined) continue          // JSON.stringify drops these too
    parts.push(`${JSON.stringify(key)}:${stableStringify(v)}`)
  }
  return `{${parts.join(',')}}`
}

/**
 * Did THIS write come from an advisor editing the account?
 *
 * Not a time window: `lastAdvisorEditAt` / `lastAdvisorEditByUid` are top-level
 * markers that persist forever once an advisor has edited, so "the marker is
 * close to updatedAt" would label the client's own later saves as advisor
 * edits. The marker must have ADVANCED since the last event we evaluated.
 */
export function deriveByAdvisor(opts: {
  lastAdvisorEditAt: number
  lastAdvisorEditByUid: string
  knownAdvisorEditAt: number
  myUid: string
}): boolean {
  return opts.lastAdvisorEditAt > opts.knownAdvisorEditAt
    && !!opts.lastAdvisorEditByUid
    && opts.lastAdvisorEditByUid !== opts.myUid
}

/** Firestore Timestamp | anything → epoch ms (0 when absent/!Timestamp). */
export function tsToMillis(value: unknown): number {
  const t = value as { toMillis?: () => number } | undefined
  return typeof t?.toMillis === 'function' ? t.toMillis() : 0
}
