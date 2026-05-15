import * as XLSX from 'xlsx'
import type { AnnualRow, AnnualDebtRow } from '@/stores/annualStore'
import type { MonthData } from '@/stores/monthlyStore'
import { MONTH_IDS } from '@/lib/constants'

type Section = {
  title: string
  rows: AnnualRow[]
}

type DebtSection = {
  title: string
  rows: AnnualDebtRow[]
}

export interface AnnualExportInput {
  year: number
  income: AnnualRow[]
  fixed: AnnualRow[]
  variable: AnnualRow[]
  sub: AnnualRow[]
  savings: AnnualRow[]
  debt: AnnualDebtRow[]
  months: Record<string, MonthData | undefined>
}

const MONTH_LABELS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר']

function rtl(ws: XLSX.WorkSheet) {
  // hint Excel that this sheet is right-to-left
  if (!ws['!views']) ws['!views'] = [{ rightToLeft: true }]
}

function sectionSheet(s: Section) {
  const total = s.rows.reduce((acc, r) => acc + (r.annual || 0), 0)
  const aoa: (string | number)[][] = [
    [s.title],
    [],
    ['פריט', 'שנתי ₪', 'חודשי ₪ (÷12)'],
    ...s.rows.map(r => [r.name || '', Math.round(r.annual || 0), Math.round((r.annual || 0) / 12)]),
    [],
    ['סה"כ', Math.round(total), Math.round(total / 12)],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 16 }]
  rtl(ws)
  return ws
}

function debtSheet(s: DebtSection) {
  const totalAnnual = s.rows.reduce((acc, r) => acc + (r.annual || 0), 0)
  const totalBalance = s.rows.reduce((acc, r) => acc + (r.balance || 0), 0)
  const aoa: (string | number)[][] = [
    [s.title],
    [],
    ['שם הלוואה', 'תשלום שנתי ₪', 'חודשי ₪ (÷12)', 'יתרה לסגירה ₪'],
    ...s.rows.map(r => [
      r.name || '',
      Math.round(r.annual || 0),
      Math.round((r.annual || 0) / 12),
      Math.round(r.balance || 0),
    ]),
    [],
    ['סה"כ', Math.round(totalAnnual), Math.round(totalAnnual / 12), Math.round(totalBalance)],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 16 }]
  rtl(ws)
  return ws
}

function summarySheet(input: AnnualExportInput) {
  const pIncome = input.income.reduce((s, r) => s + (r.annual || 0), 0)
  const pFixed = input.fixed.reduce((s, r) => s + (r.annual || 0), 0)
  const pVariable = input.variable.reduce((s, r) => s + (r.annual || 0), 0)
  const pSub = input.sub.reduce((s, r) => s + (r.annual || 0), 0)
  const pSavings = input.savings.reduce((s, r) => s + (r.annual || 0), 0)
  const pDebt = input.debt.reduce((s, r) => s + (r.annual || 0), 0)
  const pExp = pFixed + pVariable + pSub + pDebt + pSavings
  const pCF = pIncome - pExp

  const acts = MONTH_IDS.map(mid => {
    const d = input.months[mid]
    if (!d) return { income: 0, fixed: 0, variable: 0, sub: 0, debt: 0, savings: 0 }
    return {
      income: d.income.reduce((s, r) => s + (r.actual || 0), 0),
      fixed: d.fixed.reduce((s, r) => s + (r.actual || 0), 0),
      variable: d.variable.reduce((s, r) => s + (r.actual || 0), 0),
      sub: d.sub.reduce((s, r) => s + (r.actual || 0), 0) + d.ins.reduce((s, r) => s + (r.actual || 0), 0),
      debt: d.debts.reduce((s, r) => s + (r.monthly || 0), 0) + d.installments.reduce((s, r) => s + (r.monthly || 0), 0),
      savings: d.savings.reduce((s, r) => s + (r.monthly || 0), 0),
    }
  })
  const sum = (k: keyof typeof acts[number]) => acts.reduce((s, m) => s + m[k], 0)
  const aIncome = sum('income')
  const aFixed = sum('fixed')
  const aVariable = sum('variable')
  const aSub = sum('sub')
  const aDebt = sum('debt')
  const aSavings = sum('savings')
  const aExp = aFixed + aVariable + aSub + aDebt + aSavings
  const aCF = aIncome - aExp

  const aoa: (string | number)[][] = [
    [`תכנון שנתי ${input.year} — סיכום`],
    [],
    ['קטגוריה', 'תכנון שנתי ₪', 'תכנון חודשי ₪', 'ביצוע YTD ₪', 'הפרש ₪'],
    ['💰 הכנסות', Math.round(pIncome), Math.round(pIncome / 12), Math.round(aIncome), Math.round(aIncome - pIncome)],
    ['📌 קבועות', Math.round(pFixed), Math.round(pFixed / 12), Math.round(aFixed), Math.round(pFixed - aFixed)],
    ['🛒 משתנות', Math.round(pVariable), Math.round(pVariable / 12), Math.round(aVariable), Math.round(pVariable - aVariable)],
    ['🔄 מנויים+ביטוח', Math.round(pSub), Math.round(pSub / 12), Math.round(aSub), Math.round(pSub - aSub)],
    ['💳 הלוואות', Math.round(pDebt), Math.round(pDebt / 12), Math.round(aDebt), Math.round(pDebt - aDebt)],
    ['🏦 חיסכון', Math.round(pSavings), Math.round(pSavings / 12), Math.round(aSavings), Math.round(aSavings - pSavings)],
    [],
    ['סה"כ הוצאות', Math.round(pExp), Math.round(pExp / 12), Math.round(aExp), Math.round(pExp - aExp)],
    ['תזרים נטו', Math.round(pCF), Math.round(pCF / 12), Math.round(aCF), Math.round(aCF - pCF)],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }]
  rtl(ws)
  return ws
}

function monthlyBreakdownSheet(input: AnnualExportInput) {
  const pIncome = input.income.reduce((s, r) => s + (r.annual || 0), 0)
  const pFixed = input.fixed.reduce((s, r) => s + (r.annual || 0), 0)
  const pVariable = input.variable.reduce((s, r) => s + (r.annual || 0), 0)
  const pSub = input.sub.reduce((s, r) => s + (r.annual || 0), 0)
  const pSavings = input.savings.reduce((s, r) => s + (r.annual || 0), 0)
  const pDebt = input.debt.reduce((s, r) => s + (r.annual || 0), 0)

  const acts = MONTH_IDS.map(mid => {
    const d = input.months[mid]
    if (!d) return null
    return {
      income: d.income.reduce((s, r) => s + (r.actual || 0), 0),
      fixed: d.fixed.reduce((s, r) => s + (r.actual || 0), 0),
      variable: d.variable.reduce((s, r) => s + (r.actual || 0), 0),
      sub: d.sub.reduce((s, r) => s + (r.actual || 0), 0) + d.ins.reduce((s, r) => s + (r.actual || 0), 0),
      debt: d.debts.reduce((s, r) => s + (r.monthly || 0), 0) + d.installments.reduce((s, r) => s + (r.monthly || 0), 0),
      savings: d.savings.reduce((s, r) => s + (r.monthly || 0), 0),
    }
  })

  const row = (label: string, monthlyPlan: number, key: 'income'|'fixed'|'variable'|'sub'|'debt'|'savings', total: number) => {
    const planArr: (string|number)[] = MONTH_LABELS.flatMap((_, i) => [
      Math.round(monthlyPlan),
      acts[i] ? Math.round(acts[i]![key]) : ('—' as string),
    ])
    const totalAct = acts.reduce((s, m) => s + (m ? m[key] : 0), 0)
    return [label, ...planArr, Math.round(total), Math.round(totalAct)]
  }

  const header1 = ['קטגוריה']
  const header2 = ['']
  MONTH_LABELS.forEach(m => {
    header1.push(m, '')
    header2.push('תכנון', 'ביצוע')
  })
  header1.push('סה"כ שנתי', '')
  header2.push('תכנון', 'ביצוע')

  const aoa: (string|number)[][] = [
    [`פירוט חודשי — ${input.year}`],
    [],
    header1,
    header2,
    row('💰 הכנסות', pIncome / 12, 'income', pIncome),
    row('📌 קבועות', pFixed / 12, 'fixed', pFixed),
    row('🛒 משתנות', pVariable / 12, 'variable', pVariable),
    row('🔄 מנויים+ביטוח', pSub / 12, 'sub', pSub),
    row('💳 הלוואות', pDebt / 12, 'debt', pDebt),
    row('🏦 חיסכון', pSavings / 12, 'savings', pSavings),
  ]

  // Cash-flow row
  const planNetMonthly = (pIncome - pFixed - pVariable - pSub - pDebt - pSavings) / 12
  const cfRow: (string|number)[] = ['📊 תזרים נטו']
  acts.forEach((m) => {
    cfRow.push(Math.round(planNetMonthly))
    if (!m) cfRow.push('—')
    else cfRow.push(Math.round(m.income - m.fixed - m.variable - m.sub - m.debt - m.savings))
  })
  const planNetTotal = pIncome - pFixed - pVariable - pSub - pDebt - pSavings
  const actNetTotal = acts.reduce((s, m) => s + (m ? m.income - m.fixed - m.variable - m.sub - m.debt - m.savings : 0), 0)
  cfRow.push(Math.round(planNetTotal), Math.round(actNetTotal))
  aoa.push(cfRow)

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 18 }, ...Array(24).fill({ wch: 10 }), { wch: 12 }, { wch: 12 }]
  rtl(ws)
  return ws
}

export function exportAnnualXlsx(input: AnnualExportInput) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, summarySheet(input), 'סיכום')
  XLSX.utils.book_append_sheet(wb, sectionSheet({ title: '💰 הכנסות', rows: input.income }), 'הכנסות')
  XLSX.utils.book_append_sheet(wb, sectionSheet({ title: '📌 הוצאות קבועות', rows: input.fixed }), 'קבועות')
  XLSX.utils.book_append_sheet(wb, sectionSheet({ title: '🛒 הוצאות משתנות', rows: input.variable }), 'משתנות')
  XLSX.utils.book_append_sheet(wb, sectionSheet({ title: '🔄 מנויים וביטוחים', rows: input.sub }), 'מנויים')
  XLSX.utils.book_append_sheet(wb, sectionSheet({ title: '🏦 חיסכון', rows: input.savings }), 'חיסכון')
  XLSX.utils.book_append_sheet(wb, debtSheet({ title: '💳 הלוואות וחובות', rows: input.debt }), 'הלוואות')
  XLSX.utils.book_append_sheet(wb, monthlyBreakdownSheet(input), 'פירוט חודשי')

  // RTL workbook hint
  if (!wb.Workbook) wb.Workbook = {}
  wb.Workbook.Views = [{ RTL: true }]

  XLSX.writeFile(wb, `תכנון-שנתי-${input.year}.xlsx`)
}
