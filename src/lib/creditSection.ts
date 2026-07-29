import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import type { Transaction } from '@/types/transaction'

/**
 * The credit section's own document: users/{uid}/sections/credit.
 *
 * WHY: the transaction list is ~64% of a real portfolio's weight, and the main
 * document has a hard ~1MB cap a long-lived client would eventually hit — at
 * which point they cannot save at all. The heavy fields move here; the small
 * ones (learnedDB, reportMonths) stay in the snapshot.
 *
 * ROLLOUT (phase A, current): SHADOW WRITE ONLY. Every save also writes this
 * document, but all reads still come from the main doc — zero behavior change,
 * and the side copy accumulates as a verified safety net. The read switch
 * (phase B) happens only after two weeks of the verify script showing zero
 * drift. This module is the only place that knows the document exists.
 */

export interface CreditSection {
  transactions: Transaction[]
  uploadedFileNames: string[]
}

export interface LoadedCreditSection extends CreditSection {
  updatedAt: number
}

// Same ceiling as the main doc — the section is subject to the same 1MB cap.
export const CREDIT_MAX_BYTES = 900_000

export function creditSectionSize(section: CreditSection): number {
  try {
    return new TextEncoder().encode(JSON.stringify(section)).length
  } catch {
    return 0
  }
}

const ref = (uid: string) => doc(db, 'users', uid, 'sections', 'credit')

export async function loadCreditSection(uid: string): Promise<LoadedCreditSection | null> {
  const snap = await getDoc(ref(uid))
  if (!snap.exists()) return null
  const raw = snap.data()
  return {
    transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
    uploadedFileNames: Array.isArray(raw.uploadedFileNames) ? raw.uploadedFileNames : [],
    updatedAt: typeof raw.updatedAt?.toMillis === 'function' ? raw.updatedAt.toMillis() : 0,
  }
}

/**
 * mergeFields, not merge:true — the same load-bearing choice as saveUserData:
 * a deep merge would resurrect deleted rows, exactly the production bug we
 * fixed in the main document. Works for both the owner and a write-tier
 * advisor; the rules decide who may write.
 */
export async function saveCreditSection(uid: string, section: CreditSection): Promise<void> {
  await setDoc(ref(uid), {
    transactions: section.transactions,
    uploadedFileNames: section.uploadedFileNames,
    updatedAt: serverTimestamp(),
  }, { mergeFields: ['transactions', 'uploadedFileNames', 'updatedAt'] })
}
