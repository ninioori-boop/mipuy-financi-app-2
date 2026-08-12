import {
  doc, getDoc, setDoc, serverTimestamp,
  addDoc, collection, query, orderBy, limit, getDocs, deleteDoc,
} from 'firebase/firestore'
import { auth, db } from './firebase'

/* ── User data ──────────────────────────────────────────────────── */

/**
 * mergeFields (NOT merge:true) is load-bearing: merge:true deep-merges nested
 * MAPS, so a key the user DELETED locally (a category budget, a dismissed
 * subscription, a removed recurring rule's posted mark) is never removed from
 * the doc and resurrects on the next load. mergeFields treats `data` as one
 * field path — the whole map is replaced — while sibling top-level fields
 * (meta, lastAdvisorEditAt, …) stay untouched. Matches the v1 app's db.js.
 */
export async function saveUserData(uid: string, data: unknown): Promise<void> {
  await setDoc(doc(db, 'users', uid), { data, updatedAt: serverTimestamp() },
    { mergeFields: ['data', 'updatedAt'] })
}

/**
 * Save a CLIENT's snapshot while an advisor is editing it (view-as-client edit
 * mode). Same shape as saveUserData but also stamps the transparency marker as
 * TOP-LEVEL fields (never inside `data`, so it can't round-trip into the
 * snapshot / version diffs). mergeFields (see saveUserData) replaces `data`
 * wholesale so the client's deletions stick, while every top-level field we do
 * not list stays untouched. The advisor holds the client's FULL snapshot in
 * memory (reset+applySnapshot on entry), so a whole-map replace is correct.
 * The advisor→client WRITE is authorized by the Firestore rule
 * (active link + access=='write').
 */
export async function saveClientDataAsAdvisor(clientUid: string, data: unknown, advisorUid: string): Promise<void> {
  await setDoc(
    doc(db, 'users', clientUid),
    { data, updatedAt: serverTimestamp(), lastAdvisorEditAt: serverTimestamp(), lastAdvisorEditByUid: advisorUid },
    { mergeFields: ['data', 'updatedAt', 'lastAdvisorEditAt', 'lastAdvisorEditByUid'] },
  )
}

export interface LoadedUserData {
  data:      unknown
  updatedAt: number   // epoch ms; 0 if the doc predates serverTimestamp tracking
}

export async function loadUserData(uid: string): Promise<LoadedUserData | null> {
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists() || !snap.data().data) return null
  const raw = snap.data()
  // Server timestamps arrive as Firestore Timestamp objects; convert to ms.
  // Old docs written before this field existed → treat as ancient (0) so any
  // local backup beats it in the restore-prompt comparison.
  const updatedAt = typeof raw.updatedAt?.toMillis === 'function'
    ? raw.updatedAt.toMillis()
    : 0
  return { data: raw.data, updatedAt }
}

/* ── Version history ────────────────────────────────────────────── */
// Rolling per-user backup subcollection: /users/{uid}/versions/{versionId}.
// The debounced save in DataSync creates a version at most once per 5 minutes
// after a successful write; only the last MAX_VERSIONS are kept — anything
// older is deleted. Rules mirror the parent user doc (owner+allowlist).

export const MAX_VERSIONS = 20

export interface VersionSummary {
  id:      string
  savedAt: number  // epoch ms (0 if serverTimestamp hadn't landed yet)
  size:    number  // bytes of the JSON snapshot
}

export async function createVersion(uid: string, snapshot: unknown, size: number): Promise<void> {
  const col = collection(db, 'users', uid, 'versions')
  await addDoc(col, { savedAt: serverTimestamp(), snapshot, size })
  // Trim asynchronously, SERVER-SIDE — creation succeeds even if trim fails;
  // a stray extra version is harmless and the next save retries. Server-side
  // because the browser cannot do this correctly from either seat: an advisor
  // session may only CREATE versions (rules), so a client-side trim failed
  // silently for advisor-managed clients and the backlog grew ~12/editing
  // hour; and the web SDK has no field masks, so trimming from the browser
  // downloaded every full snapshot just to learn the ids.
  trimVersionsServerSide(uid).catch(() => {})
}

async function trimVersionsServerSide(uid: string): Promise<void> {
  const user = auth.currentUser
  if (!user) return
  const idToken = await user.getIdToken()
  await fetch('/api/trim-versions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ uid }),
  })
}

export async function listVersions(uid: string): Promise<VersionSummary[]> {
  const col  = collection(db, 'users', uid, 'versions')
  const snap = await getDocs(query(col, orderBy('savedAt', 'desc'), limit(MAX_VERSIONS)))
  return snap.docs.map(d => {
    const data = d.data()
    const ts   = typeof data.savedAt?.toMillis === 'function' ? data.savedAt.toMillis() : 0
    const size = typeof data.size === 'number' ? data.size : 0
    return { id: d.id, savedAt: ts, size }
  })
}

export async function getVersion(uid: string, versionId: string): Promise<unknown | null> {
  const snap = await getDoc(doc(db, 'users', uid, 'versions', versionId))
  if (!snap.exists()) return null
  return snap.data().snapshot ?? null
}

/* ── Shared category-learning DB ────────────────────────────────── */
// One global doc all signed-in accounts read/write. Holds only generic
// merchant-name → category mappings (no personal/financial data), so a manual
// correction made once silently improves categorization for every client.

export async function loadSharedLearnedDB(): Promise<Record<string, string>> {
  const snap = await getDoc(doc(db, 'shared', 'learnedDB'))
  const data = snap.exists() ? snap.data() : null
  return data && typeof data.db === 'object' && data.db
    ? (data.db as Record<string, string>)
    : {}
}

/**
 * Propose a correction to the shared pool.
 *
 * `subjectUid` names the HOUSEHOLD the correction is evidence about, which is
 * not the signed-in account when an advisor works inside a client's portfolio.
 * The server verifies the advisor→client link before it counts; passing a uid
 * that is not yours is a 403, not a silent no-op. Omit it and the caller's own
 * account is the household, which is what every existing caller wants.
 */
export interface LearnResult {
  /** True when this call actually wrote the shared pool. */
  shared: boolean
  /** Households now backing this answer, and how many are needed. */
  votes?:  number
  needed?: number
}

export async function saveLearnedEntry(
  key: string, category: string, subjectUid?: string,
): Promise<LearnResult> {
  // Browser writes to shared/learnedDB are CLOSED at the rules layer (any
  // signed-in user could overwrite every value, and the hasAll guard meant the
  // doc could never shrink). The pool accepts writes only through /api/learn,
  // which validates the category, drops payment rails, rate-limits per user
  // and enforces the key ceiling — for the web session, authed by the Firebase
  // ID token. Callers treat this as fire-and-forget (.catch), same as before.
  //
  // Resolves with what the server DID, so a caller that wants to tell the user
  // about the shared pool can report the outcome instead of assuming it. Since
  // 2026-08-12 the pool is written only on a second household's agreement, so
  // "we sent it" and "it was learned" are no longer the same event.
  const user = auth.currentUser
  if (!user) throw new Error('learn failed: no session')
  const idToken = await user.getIdToken()
  const res = await fetch('/api/learn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(subjectUid ? { merchant: key, category, subjectUid } : { merchant: key, category }),
  })
  if (!res.ok) {
    // Callers swallow this rejection by design (learning must never block the
    // UI) — so leave at least a console trace. Without it, a 429/403 streak
    // means the shared pool silently stops learning and nobody can tell.
    console.warn(`shared-pool learn failed: ${res.status} for "${key}"`)
    throw new Error(`learn failed: ${res.status}`)
  }
  const body = await res.json().catch(() => ({}))
  return {
    shared: body?.shared === true,
    votes:  typeof body?.votes === 'number' ? body.votes : undefined,
    needed: typeof body?.needed === 'number' ? body.needed : undefined,
  }
}
