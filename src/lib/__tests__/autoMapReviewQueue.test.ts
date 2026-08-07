import { describe, it, expect } from 'vitest'
import { parseGeneratedMapping, type GeneratedMapping, type GenSimpleRow } from '@/lib/autoMap'

// The review queue's selection rule, extracted so it can be pinned without
// mounting the component: show a row only while the model was unsure of it AND
// the advisor hasn't signed it off.
const QUEUE_SECTIONS = ['income', 'fixed', 'variable', 'sub', 'ins'] as const
const queueOf = (r: GeneratedMapping) =>
  QUEUE_SECTIONS.flatMap(key =>
    (r[key] as GenSimpleRow[])
      .map((row, idx) => ({ key, idx, row }))
      .filter(({ row }) => !row.reviewed && (row.confidence === 'low' || row.confidence === 'medium')),
  )

const empty = (): GeneratedMapping => ({
  creditScore: 0, creditCards: [], bankAccounts: [],
  income: [], fixed: [], sub: [], ins: [], variable: [], annual: [],
  debts: [], installments: [], savings: [], assessment: '',
})

describe('review queue selection', () => {
  it('surfaces only what the model was unsure of — the point is a short list', () => {
    const r = empty()
    r.variable = [
      { name: 'סופרמרקטים', amount: 1800, confidence: 'high' },
      { name: 'משלוחים',    amount: 350,  confidence: 'medium' },
      { name: 'בילויים',    amount: 200,  confidence: 'low' },
    ]
    expect(queueOf(r).map(q => q.row.name)).toEqual(['משלוחים', 'בילויים'])
  })

  it('drops a row once the advisor approves it', () => {
    const r = empty()
    r.fixed = [{ name: 'ארנונה', amount: 620, confidence: 'low', reviewed: true }]
    expect(queueOf(r)).toEqual([])
  })

  it('is empty when the model was confident throughout', () => {
    const r = empty()
    r.income = [{ name: 'משכורת', amount: 14000, confidence: 'high' }]
    expect(queueOf(r)).toEqual([])
  })

  it('does not queue a row with no confidence at all — nothing was claimed about it', () => {
    const r = empty()
    r.fixed = [{ name: 'ועד בית', amount: 150 }]
    expect(queueOf(r)).toEqual([])
  })

  it('spans every simple section, and carries the index needed to edit in place', () => {
    const r = empty()
    r.income = [{ name: 'קצבה', amount: 400, confidence: 'low' }]
    r.ins    = [{ name: 'ביטוח', amount: 300, confidence: 'medium' }]
    expect(queueOf(r).map(q => [q.key, q.idx])).toEqual([['income', 0], ['ins', 0]])
  })
})

describe('reviewed flag', () => {
  // It is set locally, never by the model — a draft saved before the field
  // existed must still load, and the model must not be able to pre-approve
  // its own rows.
  it('is not read off the model response', () => {
    const r = parseGeneratedMapping(JSON.stringify({
      fixed: [{ name: 'ארנונה', amount: 620, confidence: 'low', reviewed: true }],
    }))
    expect(r.fixed[0].reviewed).toBeUndefined()
    expect(queueOf(r)).toHaveLength(1)     // still needs a human
  })

  it('leaves an older draft loadable, with everything uncertain still queued', () => {
    const old = empty()
    old.variable = [{ name: 'שונות', amount: 500, confidence: 'medium' }]   // no `reviewed` key
    expect(queueOf(old)).toHaveLength(1)
  })
})
