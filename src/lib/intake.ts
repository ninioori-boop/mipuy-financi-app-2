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

export interface IntakeClient {
  uid:         string
  email:       string
  displayName: string
  updatedAt:   number  // ms
  answers:     Record<string, string>   // text/choice answers, keyed by question id
  files:       IntakeFile[]
}

const mkId = () => Math.random().toString(36).slice(2, 11)
const toMs = (t: unknown): number =>
  t && typeof (t as Timestamp).toMillis === 'function' ? (t as Timestamp).toMillis() : 0

function requireUid(): string {
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('לא מחובר')
  return uid
}

/** Upload one file for the current client + write its metadata (optionally
 * tagged with the questionnaire question it answers). */
export async function uploadIntakeFile(file: File, questionId?: string): Promise<void> {
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

/** Load the current client's saved answers. */
export async function loadMyAnswers(): Promise<Record<string, string>> {
  const snap = await getDoc(doc(db, 'intake', requireUid()))
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

/** Current client's own files. */
export function listMyIntake(): Promise<IntakeFile[]> {
  return readFiles(requireUid())
}

/** Delete one of the current client's files (Storage object + metadata). */
export async function deleteIntakeFile(f: IntakeFile): Promise<void> {
  const uid = requireUid()
  try { await deleteObject(ref(storage, f.path)) } catch { /* object may already be gone */ }
  await deleteDoc(doc(db, 'intake', uid, 'files', f.id))
}

/** Advisor: every client that has an intake, with their files (newest first). */
export async function listAllIntake(): Promise<IntakeClient[]> {
  const snap = await getDocs(collection(db, 'intake'))
  const clients = await Promise.all(snap.docs.map(async (d) => {
    const x = d.data()
    const files = await readFiles(d.id)
    const answers = x.answers && typeof x.answers === 'object' ? (x.answers as Record<string, string>) : {}
    return {
      uid: d.id,
      email:       String(x.email ?? ''),
      displayName: String(x.displayName ?? ''),
      updatedAt:   toMs(x.updatedAt),
      answers,
      files,
    }
  }))
  // Only clients that have uploaded something or answered, newest activity first.
  return clients
    .filter(c => c.files.length > 0 || Object.values(c.answers).some(v => v && v.trim()))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** A temporary download URL for a stored file (owner or advisor). */
export function getFileUrl(path: string): Promise<string> {
  return getDownloadURL(ref(storage, path))
}

/** Whether a Storage summary doc already exists for a uid (cheap existence probe). */
export async function intakeExists(uid: string): Promise<boolean> {
  return (await getDoc(doc(db, 'intake', uid))).exists()
}
