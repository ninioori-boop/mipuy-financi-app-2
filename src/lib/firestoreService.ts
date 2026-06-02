import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

/* ── User data ──────────────────────────────────────────────────── */

export async function saveUserData(uid: string, data: unknown): Promise<void> {
  await setDoc(doc(db, 'users', uid), { data, updatedAt: serverTimestamp() }, { merge: true })
}

export async function loadUserData(uid: string): Promise<unknown | null> {
  const snap = await getDoc(doc(db, 'users', uid))
  if (snap.exists() && snap.data().data) return snap.data().data
  return null
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
