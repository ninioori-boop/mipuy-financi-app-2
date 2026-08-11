'use client'

// Client document intake: clients upload files to Firebase Storage under their
// own folder; metadata is mirrored to Firestore so the advisor can list and
// review them. Owner-or-advisor access is enforced by storage.rules + firestore.rules.

import {
  ref, uploadBytes, getDownloadURL, deleteObject,
} from 'firebase/storage'
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, serverTimestamp, query, orderBy,
  type Timestamp,
} from 'firebase/firestore'
import { auth, db, storage } from './firebase'
import { intakeQuestionLabel } from './intakeForm'
import { useImpersonationStore } from '@/stores/impersonationStore'

export interface IntakeFile {
  id:            string
  name:          string
  type:          string
  size:          number
  path:          string   // Storage object path
  uploadedAt:    number   // ms
  questionId?:   string    // which questionnaire question this file answers
  questionLabel?: string
}

const mkId = () => Math.random().toString(36).slice(2, 11)
const toMs = (t: unknown): number =>
  t && typeof (t as Timestamp).toMillis === 'function' ? (t as Timestamp).toMillis() : 0

function requireUid(): string {
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('לא מחובר')
  return uid
}

/**
 * WHOSE intake this call is about.
 *
 * Every function here used to resolve `auth.currentUser.uid`, which is always
 * the signed-in account — so an advisor inside a client's account was shown
 * their OWN questionnaire and their OWN uploaded files, while the banner
 * promised "השינויים נשמרים אצל הלקוח" (2026-08-11, reported from production).
 * The advisor could therefore never see whether a client had uploaded anything,
 * which is the entire purpose of the screen for them. The automap screen
 * already resolved the client this way; this file was the one left behind.
 */
function targetUid(): string {
  return useImpersonationStore.getState().client?.uid ?? requireUid()
}

/** True while an advisor is acting inside a client's account. */
export function isActingAsClient(): boolean {
  return !!useImpersonationStore.getState().client
}

/**
 * Writes stay with the owner, always.
 *
 * Not a product choice — both rule files enforce it: `firestore.rules` allows an
 * advisor to READ /intake/{client} but never to write it, and `storage.rules`
 * restricts write/delete to `request.auth.uid == userId`. Without this guard the
 * screen would send a write that lands as a raw permission-denied, or (worse,
 * the old behaviour) silently save the CLIENT's answers into the ADVISOR's own
 * intake document.
 */
function refuseWriteAsAdvisor(): void {
  if (isActingAsClient()) {
    throw new Error('התיק של הלקוח פתוח לצפייה בלבד. העלאה, עריכה ומחיקה נעשות מהחשבון של הלקוח.')
  }
}

/** Upload one file for the current client + write its metadata (optionally
 * tagged with the questionnaire question it answers). */
export async function uploadIntakeFile(file: File, questionId?: string): Promise<void> {
  refuseWriteAsAdvisor()
  const uid = requireUid()
  const user = auth.currentUser!
  const fileId = mkId()
  const path = `intake/${uid}/${fileId}-${file.name}`

  await uploadBytes(ref(storage, path), file, { contentType: file.type || 'application/octet-stream' })

  await setDoc(doc(db, 'intake', uid, 'files', fileId), {
    name: file.name,
    type: file.type || '',
    size: file.size,
    path,
    uploadedAt: serverTimestamp(),
    ...(questionId ? { questionId, questionLabel: intakeQuestionLabel(questionId) } : {}),
  })

  // Summary doc — lets the advisor list clients without scanning subcollections.
  await setDoc(doc(db, 'intake', uid), {
    uid,
    email:       user.email ?? '',
    displayName: user.displayName ?? '',
    updatedAt:   serverTimestamp(),
  }, { merge: true })
}

/** Save the questionnaire's text/choice answers for the current client. */
export async function saveAnswers(answers: Record<string, string>): Promise<void> {
  refuseWriteAsAdvisor()
  const uid = requireUid()
  const user = auth.currentUser!
  await setDoc(doc(db, 'intake', uid), {
    uid,
    email:       user.email ?? '',
    displayName: user.displayName ?? '',
    answers,
    updatedAt:   serverTimestamp(),
  }, { merge: true })
}

/** Saved answers for the account in view (the client when acting as one). */
export async function loadMyAnswers(): Promise<Record<string, string>> {
  const snap = await getDoc(doc(db, 'intake', targetUid()))
  const a = snap.exists() ? (snap.data().answers as unknown) : null
  return a && typeof a === 'object' ? (a as Record<string, string>) : {}
}

async function readFiles(uid: string): Promise<IntakeFile[]> {
  const snap = await getDocs(query(collection(db, 'intake', uid, 'files'), orderBy('uploadedAt', 'desc')))
  return snap.docs.map(d => {
    const x = d.data()
    return {
      id: d.id,
      name: String(x.name ?? ''),
      type: String(x.type ?? ''),
      size: Number(x.size) || 0,
      path: String(x.path ?? ''),
      uploadedAt: toMs(x.uploadedAt),
      ...(x.questionId ? { questionId: String(x.questionId), questionLabel: String(x.questionLabel ?? x.questionId) } : {}),
    }
  })
}

/** Files of the account in view (the client's when acting as one). */
export function listMyIntake(): Promise<IntakeFile[]> {
  return readFiles(targetUid())
}

/** Delete one of the signed-in account's files (Storage object + metadata). */
export async function deleteIntakeFile(f: IntakeFile): Promise<void> {
  refuseWriteAsAdvisor()
  const uid = requireUid()
  try { await deleteObject(ref(storage, f.path)) } catch { /* object may already be gone */ }
  await deleteDoc(doc(db, 'intake', uid, 'files', f.id))
}

/** A temporary download URL for a stored file (owner or advisor). */
export function getFileUrl(path: string): Promise<string> {
  return getDownloadURL(ref(storage, path))
}

/** Whether a Storage summary doc already exists for a uid (cheap existence probe). */
export async function intakeExists(uid: string): Promise<boolean> {
  return (await getDoc(doc(db, 'intake', uid))).exists()
}
