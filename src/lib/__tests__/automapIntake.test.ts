import { describe, it, expect, vi } from 'vitest'

// The module reads Firestore/Storage, so importing it initializes the Firebase
// app — which has no API key under test. Same stub the other suites use.
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, storage: {} }))

import {
  routeForQuestion, formatIntakeAnswers, countAnswered, groupIntakeQuestions,
  creditScoreLine, LAB_QUESTIONS, LAB_EXTRA_QUESTIONS, formatIntakeDocs,
} from '@/lib/automapIntake'
import { INTAKE_QUESTIONS, type IntakeQuestion } from '@/lib/intakeForm'

// The questionnaire tags every uploaded file with the question it answers, so we
// KNOW what each file is instead of guessing. Guessing produced the worst bug of
// 2026-08-07: every Excel went through the credit parser, and on a bank export a
// salary deposit was counted as an expense.

describe('routeForQuestion', () => {
  it('sends a bank statement to the bank parser', () => {
    expect(routeForQuestion('oshReports')).toBe('bank')
  })

  it('sends a credit report to the credit parser', () => {
    expect(routeForQuestion('creditReports')).toBe('credit')
  })

  it.each([
    'payslips', 'loanSchedules', 'creditScore', 'securitiesPortfolio',
    'bankId', 'harHaKesefReports', 'harHaBituachReport', 'otherAssets',
  ])('sends %s to the model as a document', id => {
    expect(routeForQuestion(id)).toBe('document')
  })

  // A file we cannot place is still worth showing the model. Dropping it would
  // lose a client's upload silently, which is worse than routing it loosely.
  it('never drops a file with an unknown or missing question id', () => {
    expect(routeForQuestion('somethingNew')).toBe('document')
    expect(routeForQuestion(undefined)).toBe('document')
    expect(routeForQuestion('')).toBe('document')
  })

  // The routing table is only correct while these ids exist in the live form.
  it('routes ids that actually exist in the questionnaire', () => {
    const ids = new Set(INTAKE_QUESTIONS.map(q => q.id))
    for (const id of ['oshReports', 'creditReports']) {
      expect(ids, `${id} is no longer a question — routing is stale`).toContain(id)
    }
  })
})

describe('formatIntakeAnswers', () => {
  it('labels each answer from the questionnaire itself', () => {
    const out = formatIntakeAnswers({ bankAccounts: 'שניים — יהב ודיסקונט' })
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('כמה חשבונות בנק')
    expect(out[0]).toContain('יהב ודיסקונט')
  })

  it('says nothing about a question the client skipped', () => {
    expect(formatIntakeAnswers({ bankAccounts: '', oshBalance: '   ' })).toEqual([])
    expect(formatIntakeAnswers({})).toEqual([])
  })

  it('leaves file questions out — those travel as files', () => {
    const out = formatIntakeAnswers({ payslips: 'משהו', oshBalance: '12,000' })
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('היתרה בעו"ש')
  })

  it('keeps the questionnaire order, so the block reads like the form', () => {
    const out = formatIntakeAnswers({
      creditLimits: '30,000', fullNames: 'עדי ואור', bankAccounts: 'שניים',
    })
    const order = out.map(l => INTAKE_QUESTIONS.findIndex(q => l.includes(q.label)))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('ignores an id that is no longer a question', () => {
    expect(formatIntakeAnswers({ removedLongAgo: 'ערך' })).toEqual([])
  })
})

describe('countAnswered', () => {
  it('counts only answered non-file questions', () => {
    expect(countAnswered({ bankAccounts: 'שניים', oshBalance: '', payslips: 'x' })).toBe(1)
    expect(countAnswered({})).toBe(0)
  })
})

// The questionnaire is now the lab's INPUT surface, so its grouping decides what
// the advisor can actually be asked. A question that exists in the live form but
// appears in no group would silently vanish from the screen — the same failure
// class as a silently dropped file, and just as invisible.
describe('groupIntakeQuestions', () => {
  const flat = (qs?: IntakeQuestion[]) => groupIntakeQuestions(qs).flatMap(g => g.questions)

  it('shows every question the lab asks exactly once', () => {
    const shown = flat().map(q => q.id)
    expect([...shown].sort()).toEqual(LAB_QUESTIONS.map(q => q.id).sort())
    expect(new Set(shown).size).toBe(shown.length)
  })

  it('includes every question of the live client form', () => {
    const shown = new Set(flat().map(q => q.id))
    for (const q of INTAKE_QUESTIONS) expect(shown.has(q.id)).toBe(true)
  })

  it('puts a question nobody grouped into a trailing group rather than dropping it', () => {
    const extra: IntakeQuestion = { id: 'brandNewQuestion', type: 'text', label: 'שאלה חדשה' }
    const groups = groupIntakeQuestions([...LAB_QUESTIONS, extra])
    expect(flat([...LAB_QUESTIONS, extra]).map(q => q.id)).toContain('brandNewQuestion')
    expect(groups[groups.length - 1].questions.map(q => q.id)).toContain('brandNewQuestion')
  })

  it('never emits an empty group', () => {
    expect(groupIntakeQuestions().every(g => g.questions.length > 0)).toBe(true)
    expect(groupIntakeQuestions([]).length).toBe(0)
  })

  it('keeps a statement next to the question it answers', () => {
    const bank = groupIntakeQuestions().find(g => g.questions.some(q => q.id === 'oshReports'))!
    expect(bank.questions.map(q => q.id)).toContain('bankAccounts')
  })
})

// A household has two people and two credit scores; the mapping carries one
// number. The average is the answer — and the line says it is an average, so
// nobody later mistakes it for one person's real score.
describe('creditScoreLine', () => {
  it('averages a couple and shows both numbers', () => {
    expect(creditScoreLine({ creditScoreSelf: '700', creditScorePartner: '740' }))
      .toBe('  - ציון דירוג אשראי: 720 (ממוצע של 700 ו‑740)')
  })

  it('rounds a half-point average rather than emitting a fraction', () => {
    expect(creditScoreLine({ creditScoreSelf: '700', creditScorePartner: '741' }))
      .toContain('721')
  })

  it('uses the single score when only one person has one', () => {
    expect(creditScoreLine({ creditScoreSelf: '812' })).toBe('  - ציון דירוג אשראי: 812')
    expect(creditScoreLine({ creditScorePartner: '812' })).toBe('  - ציון דירוג אשראי: 812')
  })

  it('reads a score the way a person types it', () => {
    expect(creditScoreLine({ creditScoreSelf: '1,000' })).toContain('1000')
    expect(creditScoreLine({ creditScoreSelf: '720 נקודות' })).toContain('720')
  })

  // A fabricated score is worse than no score: it would be shown to the client
  // as fact and there is no file to check it against.
  it('says nothing when neither was given', () => {
    expect(creditScoreLine({})).toBeNull()
    expect(creditScoreLine({ creditScoreSelf: '', creditScorePartner: '  ' })).toBeNull()
    expect(creditScoreLine({ creditScoreSelf: 'לא יודע' })).toBeNull()
  })
})

// The questionnaire was written to decompose into the mapping's columns: "מה
// היתרה בעו״ש" IS bankAccounts[].balance. Sending "question: answer" and
// leaving the model to work out where it goes is the same guess the whole
// questionnaire exists to remove.
describe('every answer states the column it fills', () => {
  it('names the destination for an answer that has one', () => {
    const lines = formatIntakeAnswers({ oshBalance: '12,000', creditLimits: '30,000' })
    expect(lines.find(l => l.includes('12,000'))).toContain('bankAccounts[].balance')
    expect(lines.find(l => l.includes('30,000'))).toContain('creditCards[].limit')
  })

  it('says nothing about a destination when the answer is only context', () => {
    const line = formatIntakeAnswers({ fullNames: 'אורי וטל' })[0]
    expect(line).toContain('אורי וטל')
    expect(line).toContain('הקשר בלבד')
  })

  it('routes the averaged credit score to creditScore', () => {
    const lines = formatIntakeAnswers({ creditScoreSelf: '700', creditScorePartner: '740' })
    expect(lines.find(l => l.includes('720'))).toContain('creditScore')
  })

  it('never emits a bare arrow with no target', () => {
    for (const l of formatIntakeAnswers({ oshBalance: '1', fullNames: 'x', realEstateDetails: 'y' })) {
      expect(l).not.toMatch(/→\s*$/)
    }
  })
})

// Documents arrive as unlabelled images and PDFs. Without this the model gets
// four screenshots and has to work out what each one is.
describe('formatIntakeDocs', () => {
  it('names the question a file answered and the column it feeds', () => {
    const [line] = formatIntakeDocs({ loanSchedules: ['סילוקין.pdf'] })
    expect(line).toContain('סילוקין.pdf')
    expect(line).toContain('לוח סילוקין')
    expect(line).toContain('debts[].remainingBalance')
  })

  it('tells the model not to re-read a statement that was already parsed', () => {
    expect(formatIntakeDocs({ oshReports: ['osh.xlsx'] })[0]).toContain('אל תקרא אותו שוב')
  })

  // Same rule as routeForQuestion's unknown-id fallback: a file we cannot place
  // is still worth showing the model, and must never disappear silently.
  it('lists a file from an unknown question rather than dropping it', () => {
    const [line] = formatIntakeDocs({ someNewQuestion: ['x.pdf'] })
    expect(line).toContain('x.pdf')
  })

  it('lists a file whose question has no declared target', () => {
    expect(formatIntakeDocs({ harHaKesefReports: ['x.pdf'] })[0]).toContain('x.pdf')
  })

  it('is empty when nothing is attached', () => {
    expect(formatIntakeDocs({})).toEqual([])
  })
})

describe('the answers block carries the score once, averaged', () => {
  it('emits one score line, never the two raw fields', () => {
    const lines = formatIntakeAnswers({ creditScoreSelf: '700', creditScorePartner: '740' })
    expect(lines.filter(l => l.includes('ציון דירוג אשראי'))).toHaveLength(1)
    expect(lines.join('\n')).toContain('720')
    expect(lines.some(l => l.includes('בן/בת הזוג'))).toBe(false)
  })

  it('counts each score field towards the progress meter', () => {
    expect(countAnswered({ creditScoreSelf: '700', creditScorePartner: '740' })).toBe(2)
  })
})

// The live client form must stay exactly as seven clients already filled it.
describe('lab-only questions', () => {
  it('are absent from the live client questionnaire', () => {
    const live = new Set(INTAKE_QUESTIONS.map(q => q.id))
    for (const q of LAB_EXTRA_QUESTIONS) expect(live.has(q.id)).toBe(false)
  })
})
