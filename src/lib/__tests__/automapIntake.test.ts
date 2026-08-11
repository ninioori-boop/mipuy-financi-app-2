import { describe, it, expect } from 'vitest'

// automapQuestions is the PURE half — no Firebase, no React — so it needs no
// stub. The Firestore/Storage readers live in automapIntake.ts, which re-exports
// everything here; the split exists because the replay script imports this
// under Node with no Firebase config at all.
import {
  routeForQuestion, formatIntakeAnswers, formatIntakeRows, countAnswered,
  groupIntakeQuestions, creditScoreLine, declaredIncomeRows, declaredMonthlyIncome,
  parseTypedNumber, LAB_QUESTIONS, formatIntakeDocs, type LabQuestion,
} from '@/lib/automapQuestions'
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

  // The lab's own list and the live form must agree on these two ids, or a file
  // a client uploaded through the real form stops reaching a parser.
  it('routes ids that exist in BOTH the lab list and the live form', () => {
    const live = new Set(INTAKE_QUESTIONS.map(q => q.id))
    const lab  = new Set(LAB_QUESTIONS.map(q => q.id))
    for (const id of ['oshReports', 'creditReports']) {
      expect(live, `${id} left the live form — a client's upload stops being routed`).toContain(id)
      expect(lab,  `${id} left the lab form — the advisor cannot supply it`).toContain(id)
    }
  })
})

// 2026-08-11: a document is only worth asking for when nothing else can produce
// the number. Everything that was uploaded so a model could read one figure off
// it became a typed field, and the reading step — the part that failed most —
// stopped existing.
describe('what the lab still asks for as a file', () => {
  it('is exactly the three statements that have no typed substitute', () => {
    const files = LAB_QUESTIONS.filter(q => q.type === 'file').map(q => q.id)
    expect(files.sort()).toEqual(['creditReports', 'loanSchedules', 'oshReports'])
  })

  it('no longer asks for a payslip, a credit-score screenshot or הר הביטוח', () => {
    const ids = new Set(LAB_QUESTIONS.map(q => q.id))
    for (const gone of ['payslips', 'creditScore', 'harHaBituachReport',
                        'harHaKesefReports', 'securitiesPortfolio', 'bankId', 'otherAssets']) {
      expect(ids.has(gone), `${gone} is still being asked for`).toBe(false)
    }
  })

  it('replaced each of them with a field that carries the same number', () => {
    const byId = new Map(LAB_QUESTIONS.map(q => [q.id, q]))
    expect(byId.get('incomeMonths')?.type).toBe('rows')          // was: payslips
    expect(byId.get('creditScoreSelf')?.type).toBe('text')       // was: creditScore
    expect(byId.get('harHaKesefProducts')?.type).toBe('rows')    // was: harHaKesefReports
    expect(byId.get('assets')?.type).toBe('rows')                // was: securitiesPortfolio + otherAssets
  })

  it('gives every table its columns, or it renders as nothing', () => {
    for (const q of LAB_QUESTIONS.filter(q => q.type === 'rows')) {
      expect(q.columns?.length, `${q.id} has no columns`).toBeGreaterThan(0)
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
    const out = formatIntakeAnswers({ oshReports: 'משהו', oshBalance: '12,000' })
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('היתרה בעו"ש')
  })

  it('leaves table questions out — those have their own block', () => {
    expect(formatIntakeAnswers({ incomeMonths: 'לא אמור לקרות' })).toEqual([])
  })

  it('keeps the questionnaire order, so the block reads like the form', () => {
    const out = formatIntakeAnswers({
      creditLimits: '30,000', fullNames: 'עדי ואור', bankAccounts: 'שניים',
    })
    const order = out.map(l => LAB_QUESTIONS.findIndex(q => l.includes(q.label)))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  // A client answered it in the live form. The lab stopped ASKING, which is not
  // the same as deciding the answer is worthless — dropping it would throw away
  // something the client actually told us.
  it('still forwards an answer to a question only the live form asks', () => {
    const out = formatIntakeAnswers({ cryptoDetails: '0.4 ביטקוין' })
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('0.4 ביטקוין')
    expect(out[0]).toContain('savings[]')
  })

  it('ignores an id that is no question anywhere', () => {
    expect(formatIntakeAnswers({ removedLongAgo: 'ערך' })).toEqual([])
  })

  it('never lists the same answer twice', () => {
    const out = formatIntakeAnswers({ bankAccounts: 'שניים', cryptoDetails: 'x' })
    expect(new Set(out).size).toBe(out.length)
  })
})

// 🔴 The average is computed in code, over the months actually filled in.
// Handing a model three numbers and "take the average" is the same class of
// mistake that produced ₪59,807 of monthly income from a 3-month window.
describe('declared income', () => {
  const rows = [
    { name: 'שכר אורי', m1: '12,000', m2: '12,500', m3: '12,520' },
    { name: 'קצבה',     m1: '2,100',  m2: '2,100',  m3: '2,100' },
  ]

  it('averages the months for each earner', () => {
    const [salary] = declaredIncomeRows(rows)
    expect(salary.name).toBe('שכר אורי')
    expect(Math.round(salary.monthly)).toBe(12340)
  })

  // Dividing by 3 unconditionally would cut the salary of anyone who filled one
  // month to a third of what they earn.
  it('divides by the months given, not always by three', () => {
    expect(declaredIncomeRows([{ name: 'שכר', m1: '10000' }])[0].monthly).toBe(10000)
    expect(declaredIncomeRows([{ name: 'שכר', m1: '10000', m2: '12000' }])[0].monthly).toBe(11000)
  })

  it('sums the earners into the household figure', () => {
    expect(Math.round(declaredMonthlyIncome({ incomeMonths: rows }))).toBe(14440)
  })

  it('is zero when the table was never filled', () => {
    expect(declaredMonthlyIncome({})).toBe(0)
    expect(declaredMonthlyIncome({ incomeMonths: [] })).toBe(0)
    expect(declaredMonthlyIncome({ incomeMonths: [{ name: 'שכר' }] })).toBe(0)
  })

  it('keeps a row that has amounts but no name, rather than dropping the money', () => {
    const [row] = declaredIncomeRows([{ m1: '5000' }])
    expect(row.monthly).toBe(5000)
    expect(row.name).toBe('הכנסה')
  })

  it('reads a number the way a person types it', () => {
    expect(parseTypedNumber('12,500')).toBe(12500)
    expect(parseTypedNumber('₪12500')).toBe(12500)
    expect(parseTypedNumber('0.5%')).toBe(0.5)
    expect(parseTypedNumber('')).toBeNull()
    expect(parseTypedNumber('לא יודע')).toBeNull()
    expect(parseTypedNumber(undefined)).toBeNull()
  })
})

// Every figure in this block was typed by a person. There is no document to
// weigh it against, so the one failure mode is a number that reaches the model
// and never becomes a row — which is exactly what "רשמתי שיש לי נדל״ן, למה זה
// לא הוסיף את הסכום" was.
describe('formatIntakeRows', () => {
  it('sends the income already averaged, and says not to divide again', () => {
    const out = formatIntakeRows({
      incomeMonths: [{ name: 'שכר אורי', m1: '12,000', m2: '12,500', m3: '12,520' }],
    }).join('\n')
    expect(out).toContain('12,340')
    expect(out).toContain('אל תחשב מחדש')
    expect(out).toContain('income[]')
  })

  it('warns in the same breath that the deposits are the same money', () => {
    const out = formatIntakeRows({ incomeMonths: [{ name: 'שכר', m1: '10000' }] }).join('\n')
    expect(out).toContain('אותו כסף')
  })

  it('maps each fund to its own savings column', () => {
    const out = formatIntakeRows({
      harHaKesefProducts: [{ name: 'קרן השתלמות מנורה', amount: '84000', feeBalance: '0.5', feeDeposit: '1.2' }],
    }).join('\n')
    expect(out).toContain('קרן השתלמות מנורה')
    expect(out).toContain('accumulated')
    expect(out).toContain('feeBalance')
    expect(out).toContain('feeDeposit')
    expect(out).toContain('0.5%')
  })

  it('carries an asset and its note, and asks for one row per portfolio', () => {
    const out = formatIntakeRows({
      assets: [{ name: 'דירה בפתח תקווה', amount: '1800000', note: 'נרכשה 2019' }],
    }).join('\n')
    expect(out).toContain('1,800,000')
    expect(out).toContain('נרכשה 2019')
    expect(out).toContain('אל תפרט אחזקות')
  })

  it('keeps a fund whose balance was left blank rather than hiding the product', () => {
    const out = formatIntakeRows({ harHaKesefProducts: [{ name: 'קרן פנסיה' }] }).join('\n')
    expect(out).toContain('קרן פנסיה')
  })

  it('drops a row nobody typed anything into', () => {
    expect(formatIntakeRows({ assets: [{ name: '', amount: '' }] })).toEqual([])
    expect(formatIntakeRows({})).toEqual([])
  })
})

describe('countAnswered', () => {
  it('counts only answered non-file questions', () => {
    expect(countAnswered({ bankAccounts: 'שניים', oshBalance: '', oshReports: 'x' })).toBe(1)
    expect(countAnswered({})).toBe(0)
  })

  it('counts a table that has anything in it', () => {
    expect(countAnswered({}, { assets: [{ name: 'תיק בבנק' }] })).toBe(1)
    expect(countAnswered({}, { assets: [{ name: '', amount: '  ' }] })).toBe(0)
    expect(countAnswered({}, { assets: [] })).toBe(0)
  })
})

// The questionnaire is the lab's INPUT surface, so its grouping decides what the
// advisor can actually be asked. A question that exists but appears in no group
// would silently vanish from the screen — the same failure class as a silently
// dropped file, and just as invisible.
describe('groupIntakeQuestions', () => {
  const flat = (qs?: LabQuestion[]) => groupIntakeQuestions(qs).flatMap(g => g.questions)

  it('shows every question the lab asks exactly once', () => {
    const shown = flat().map(q => q.id)
    expect([...shown].sort()).toEqual(LAB_QUESTIONS.map(q => q.id).sort())
    expect(new Set(shown).size).toBe(shown.length)
  })

  it('puts a question nobody grouped into a trailing group rather than dropping it', () => {
    const extra: LabQuestion = { id: 'brandNewQuestion', type: 'text', label: 'שאלה חדשה' }
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

  // A payslip can still arrive from a client's live intake. It is no longer an
  // income SOURCE — the questionnaire carries that — so it must be labelled as
  // verification, or the salary gets counted twice.
  it('labels a payslip as verification, not as a second income row', () => {
    const [line] = formatIntakeDocs({ payslips: ['tlush.pdf'] })
    expect(line).toContain('אימות')
    expect(line).toContain('אל תיצור ממנו שורת income נוספת')
  })

  it('still names a question only the live form has', () => {
    const [line] = formatIntakeDocs({ harHaBituachReport: ['bituach.xlsx'] })
    expect(line).toContain('הר הביטוח')
    expect(line).not.toContain('harHaBituachReport')
  })

  // Same rule as routeForQuestion's unknown-id fallback: a file we cannot place
  // is still worth showing the model, and must never disappear silently.
  it('lists a file from an unknown question rather than dropping it', () => {
    const [line] = formatIntakeDocs({ someNewQuestion: ['x.pdf'] })
    expect(line).toContain('x.pdf')
  })

  it('lists each file exactly once', () => {
    const out = formatIntakeDocs({ oshReports: ['a.xlsx'], payslips: ['b.pdf'] })
    expect(out).toHaveLength(2)
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
// The lab list diverged from it on 2026-08-11; the live one did not move.
describe('the live client form is untouched', () => {
  it('still has all 22 questions, including the ones the lab dropped', () => {
    expect(INTAKE_QUESTIONS).toHaveLength(22)
    const live = new Set(INTAKE_QUESTIONS.map(q => q.id))
    for (const id of ['payslips', 'creditScore', 'harHaBituachReport', 'bankId']) {
      expect(live.has(id), `${id} was removed from the LIVE form`).toBe(true)
    }
  })

  it('never gained the lab-only questions', () => {
    const live = new Set(INTAKE_QUESTIONS.map(q => q.id))
    for (const id of ['incomeMonths', 'harHaKesefProducts', 'assets',
                      'creditScoreSelf', 'creditScorePartner']) {
      expect(live.has(id), `${id} leaked into the live client form`).toBe(false)
    }
  })
})
