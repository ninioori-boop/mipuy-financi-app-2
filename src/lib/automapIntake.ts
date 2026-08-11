'use client'

// Reading a client's intake from Firestore and Storage, for the automap lab.
//
// ⚠️ This half touches Firebase, so it can only run in the browser. The
// questionnaire ITSELF — the question list, the targets, the formatting — is
// pure and lives in automapQuestions.ts, because the replay script
// (scripts/automap-replay.ts) runs it under Node with no Firebase config at all.
// Importing this module from there would initialise an app with an empty key.
// Everything pure is re-exported below, so the page still has one import.
//
// It began as a mirror of the live client form (src/lib/intakeForm.ts, 22
// questions, answered into intake/{uid} with every file tagged by questionId).
// It is no longer a mirror. Ori's rule, 2026-08-11: **a document is only worth
// asking for when nothing else can produce the number.**
//
// Three documents survive that test, and only three:
//   דוח עו"ש · דוחות אשראי · לוחות סילוקין
// Everything else was a report uploaded so a model could read one number off it
// — the salary, the credit score, the portfolio value, the accumulated pension.
// Reading it back was work, it was the part that failed most, and the number was
// always something a person could simply type. So those questions became typed
// fields, and הר הביטוח was dropped altogether: the premiums are already visible
// as charges in the statements.
//
// ⚠️ intakeForm.ts is LIVE and untouched. Clients still see all 22 questions;
// this list is what the ADVISOR fills in the lab. The two ids that route to a
// parser (oshReports, creditReports) are deliberately the live ones, so a file a
// client uploaded through the real form still lands in the right parser.
//
// ⚠️ Why this file reads intake itself instead of exporting from intake.ts: that
// module backs the live "העלאת מסמכים" screen. `readFiles(uid)` is already there
// but private, and exporting it would be an edit to a live file for a lab-only
// feature. Reads only — no writes, no rules change; firestore.rules:159 and
// storage.rules:18 already grant the advisor read access through ownsClient().

import { collection, doc, getDoc, getDocs, orderBy, query } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from './firebase'

export * from './automapQuestions'

export interface IntakeDoc {
  id:          string
  name:        string
  type:        string
  size:        number
  path:        string
  /** Which questionnaire question this file answers — the whole point. */
  questionId?: string
}

/** The client's typed/chosen answers. Empty object when they filled nothing. */
export async function loadIntakeAnswers(uid: string): Promise<Record<string, string>> {
  if (!uid) return {}
  const snap = await getDoc(doc(db, 'intake', uid))
  const a = snap.exists() ? (snap.data().answers as unknown) : null
  return a && typeof a === 'object' ? (a as Record<string, string>) : {}
}

/** The files the client uploaded, newest first. */
export async function listIntakeDocs(uid: string): Promise<IntakeDoc[]> {
  if (!uid) return []
  const snap = await getDocs(query(collection(db, 'intake', uid, 'files'), orderBy('uploadedAt', 'desc')))
  return snap.docs.map(d => {
    const x = d.data()
    return {
      id:   d.id,
      name: String(x.name ?? ''),
      type: String(x.type ?? ''),
      size: Number(x.size) || 0,
      path: String(x.path ?? ''),
      ...(x.questionId ? { questionId: String(x.questionId) } : {}),
    }
  }).filter(f => f.path)
}

/** Temporary download URL for a stored intake file. */
export function intakeFileUrl(path: string): Promise<string> {
  return getDownloadURL(ref(storage, path))
}


