'use client'

// Reading a client's intake questionnaire FOR THE AUTOMAP LAB ONLY.
//
// The questionnaire already exists and is live: src/lib/intakeForm.ts defines 22
// questions, clients answer them into intake/{uid}.answers and upload files to
// Storage under intake/{uid}/, each tagged with the questionId it answers. Seven
// clients have filled it in. Nothing has ever read it back — the client screen
// only ever loads the SIGNED-IN user's own intake, so the advisor has no view of
// it at all. The data has been write-only since the day it shipped.
//
// ⚠️ Why this file exists instead of two exports on intake.ts: that module backs
// the LIVE "העלאת מסמכים" screen every client uses. `readFiles(uid)` is already
// written there but private, and exporting it would be an edit to a live file
// for a lab-only feature. Same call as duplicating ~20 lines in automapBank.ts
// rather than editing the עו"ש tab. Reads only — no writes, no rules change;
// firestore.rules:159 and storage.rules:18 already grant the advisor read access
// through ownsClient(userId).

import { collection, doc, getDoc, getDocs, orderBy, query } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from './firebase'
import { INTAKE_QUESTIONS, type IntakeQuestion } from './intakeForm'

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

// ── routing: what IS each file? ──
//
// This is the reason the questionnaire is worth connecting at all. A file that
// arrived as the answer to "דוח עו\"ש שלושה חודשים אחורה" IS a bank statement —
// known, not guessed. Guessing the file type is exactly what produced the worst
// bug of 2026-08-07: every Excel went through the CREDIT parser, and on a bank
// export a salary deposit was counted as an expense.

export type IntakeRoute = 'bank' | 'credit' | 'document'

const ROUTE_BY_QUESTION: Record<string, IntakeRoute> = {
  oshReports:    'bank',
  creditReports: 'credit',
}

/**
 * Where a file should go. Anything not explicitly a statement becomes a document
 * for the model to read — payslips, loan schedules, credit score, portfolios,
 * insurance and pension reports. Unknown ids land there too: a file we cannot
 * place is still worth showing the model, and must never be dropped.
 */
export function routeForQuestion(questionId?: string): IntakeRoute {
  return (questionId && ROUTE_BY_QUESTION[questionId]) || 'document'
}

// ── the answers block the model receives ──

/** One label per answered question, in the questionnaire's own order. */
export function formatIntakeAnswers(answers: Record<string, string>): string[] {
  const out: string[] = []
  for (const q of INTAKE_QUESTIONS) {
    if (q.type === 'file') continue                 // files travel as files
    const v = (answers[q.id] ?? '').trim()
    if (!v) continue                                 // unanswered says nothing
    out.push(`  - ${q.label}: ${v}`)
  }
  return out
}

/** How many questions the client actually answered — for the banner. */
export function countAnswered(answers: Record<string, string>): number {
  return INTAKE_QUESTIONS.filter(q => q.type !== 'file' && (answers[q.id] ?? '').trim()).length
}

// ── the questionnaire as the lab's INPUT surface ──
//
// The lab used to open with one dropzone: drag everything in, and the model
// works out what each file is. That is backwards — it made the format the
// source of truth for what a file MEANS, and the format cannot carry that.
//
// So the input is the questionnaire itself. Each question is its own slot, and
// a file dropped into a slot is tagged with that question before it is parsed.
// Same 22 questions the client sees; here the advisor fills them in.
//
// Grouping is presentation only, and is DELIBERATELY not exhaustive: a question
// added to intakeForm.ts that nobody listed here lands in the trailing group
// rather than disappearing from the screen. A silently missing question is the
// same failure class as a silently dropped file.

export interface IntakeGroup {
  title:     string
  questions: IntakeQuestion[]
}

/** Ordered display groups, by question id. Ids that don't exist are ignored. */
const GROUP_IDS: { title: string; ids: string[] }[] = [
  { title: 'מי הלקוח',        ids: ['fullNames', 'phone'] },
  { title: 'הכנסות',          ids: ['payslips', 'selfEmployedIncome'] },
  { title: 'חשבונות בנק',     ids: ['bankAccounts', 'oshBalance', 'oshReports', 'bankId'] },
  { title: 'אשראי',           ids: ['creditCardsCount', 'creditLimits', 'creditReports', 'creditScore'] },
  { title: 'הלוואות',         ids: ['hasLoans', 'loanSchedules'] },
  { title: 'חסכונות ונכסים',  ids: ['checkedHarHaKesef', 'harHaKesefReports', 'securitiesPortfolio', 'otherAssets', 'realEstateDetails', 'cryptoDetails'] },
  { title: 'ביטוחים',         ids: ['checkedHarHaBituach', 'harHaBituachReport'] },
]

export function groupIntakeQuestions(questions: IntakeQuestion[] = INTAKE_QUESTIONS): IntakeGroup[] {
  const byId = new Map(questions.map(q => [q.id, q]))
  const used = new Set<string>()
  const groups: IntakeGroup[] = []

  for (const g of GROUP_IDS) {
    const qs = g.ids.map(id => byId.get(id)).filter((q): q is IntakeQuestion => !!q)
    for (const q of qs) used.add(q.id)
    if (qs.length) groups.push({ title: g.title, questions: qs })
  }

  // Anything the lists above never mentioned — including a question added to the
  // live form after this file was written. It must still be askable.
  const rest = questions.filter(q => !used.has(q.id))
  if (rest.length) groups.push({ title: 'נוסף', questions: rest })

  return groups
}
