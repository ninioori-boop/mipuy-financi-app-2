import { describe, it, expect, vi } from 'vitest'

// The module reads Firestore/Storage, so importing it initializes the Firebase
// app — which has no API key under test. Same stub the other suites use.
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, storage: {} }))

import { routeForQuestion, formatIntakeAnswers, countAnswered } from '@/lib/automapIntake'
import { INTAKE_QUESTIONS } from '@/lib/intakeForm'

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
