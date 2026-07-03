import {
  doc, getDoc, setDoc, serverTimestamp,
  addDoc, collection, query, orderBy, limit, getDocs, deleteDoc,
} from 'firebase/firestore'
import { db } from './firebase'

/* ── User data ──────────────────────────────────────────────────── */

export async function saveUserData(uid: string, data: unknown): Promise<void> {
  await setDoc(doc(db, 'users', uid), { data, updatedAt: serverTimestamp() }, { merge: true })
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
  // Trim asynchronously — creation succeeds even if trim fails. A stray extra
  // version is harmless; the next createVersion will trim it.
  trimVersions(uid).catch(() => {})
}

async function trimVersions(uid: string): Promise<void> {
  const col  = collection(db, 'users', uid, 'versions')
  // Fetch id + savedAt for ALL versions (no limit) so we can drop everything
  // beyond MAX_VERSIONS in one pass. In practice this is ≤ 21 docs.
  const snap = await getDocs(query(col, orderBy('savedAt', 'desc')))
  const excess = snap.docs.slice(MAX_VERSIONS)
  await Promise.all(excess.map(d => deleteDoc(d.ref)))
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

export async function saveLearnedEntry(key: string, category: string): Promise<void> {
  // Single-field merge — only adds/updates this one key, never replaces the doc.
  await setDoc(doc(db, 'shared', 'learnedDB'), { db: { [key]: category } }, { merge: true })
}
